/**
 * The harness's Python, in a worker thread: one chat's session, as the
 * desktop app's sandbox worker (`electron/sandbox/worker.js`) is one. It
 * starts Pyodide, says it is ready, and answers each `{id, code, filename,
 * project}` with what the code printed, the `repr` of its last expression,
 * and its traceback if it raised.
 *
 * The run's project is at `/project`, made again for every run from the
 * entries it is handed, and left read-only.
 */

import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'

const { pyodide: PYODIDE, wheels: WHEELS } = workerData

/** As the sandbox worker's, which says why. */
const RUNNER = `
import traceback
from pyodide.code import eval_code_async

namespace = {"__name__": "__main__"}

def format_error(error, filename):
    tb = error.__traceback__
    while tb is not None and tb.tb_frame.f_code.co_filename != filename:
        tb = tb.tb_next
    return "".join(traceback.format_exception(type(error), error, tb))

async def run(code, filename):
    try:
        value = await eval_code_async(code, namespace, filename=filename)
    except BaseException as error:
        return [None, format_error(error, filename)]
    return [None if value is None else repr(value), None]
`

const PROJECT = '/project'

const { loadPyodide } = await import(pathToFileURL(`${PYODIDE}/pyodide.mjs`).href)
// The packages the desktop app offers are the wheels beside it. One that
// isn't there would be fetched, and the sandbox has no network.
const pyodide = await loadPyodide({ indexURL: `${PYODIDE}/`, packageCacheDir: `${WHEELS}/` })
globalThis.fetch = async () => {
  throw new Error('There is no network here.')
}
const scope = pyodide.globals.get('dict')()
pyodide.runPython(RUNNER, { globals: scope })
const run = scope.get('run')
const { FS } = pyodide
FS.mkdir(PROJECT)

/**
 * Put the run's project at `/project`, in place of the last run's: its
 * folders and texts, read-only. An imported file's bytes are in no library
 * on disk here, so the page hands none, only the text read out of it.
 *
 * @param {Array<{path: string, folder?: true, text?: string}>} project
 */
function mountProject(project) {
  if (FS.isMountpoint(FS.lookupPath(PROJECT, { follow_mount: false }).node)) FS.unmount(PROJECT)
  FS.mount(FS.filesystems.MEMFS, {}, PROJECT)
  /** @type {string[]} */
  const folders = []
  const folderAt = (/** @type {string} */ path) => {
    const cut = path.lastIndexOf('/')
    if (cut < 0) return
    const above = path.slice(0, cut)
    if (folders.includes(above)) return
    folderAt(above)
    FS.mkdir(`${PROJECT}/${above}`)
    folders.push(above)
  }
  /** @type {string[]} */
  const files = []
  for (const entry of project) {
    if (entry.folder) {
      folderAt(`${entry.path}/`)
    } else if (typeof entry.text === 'string') {
      folderAt(entry.path)
      FS.writeFile(`${PROJECT}/${entry.path}`, entry.text)
      files.push(entry.path)
    }
  }
  for (const file of files) FS.chmod(`${PROJECT}/${file}`, 0o444)
  for (const folder of folders) FS.chmod(`${PROJECT}/${folder}`, 0o555)
  FS.chmod(PROJECT, 0o555)
}

parentPort.on('message', async ({ id, code, filename, project }) => {
  const stdout = []
  const stderr = []
  pyodide.setStdout({ batched: line => stdout.push(line) })
  pyodide.setStderr({ batched: line => stderr.push(line) })
  mountProject(project)
  await pyodide
    .loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} })
    .catch(() => {})
  const answer = await run(code, filename)
  const [value, error] = answer.toJs()
  answer.destroy()
  parentPort.postMessage({
    id,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
    value: value ?? null,
    error: error ?? null,
  })
})
parentPort.postMessage({ ready: true })
