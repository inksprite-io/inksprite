/**
 * Python, in the sandbox page's worker. It starts Pyodide, says it is ready
 * on the port, and answers each `{id, code, filename, project}` there with
 * what the code printed, the `repr` of its last expression, and its traceback
 * if it raised.
 *
 * One namespace is kept for every run, so that what one defines the next can
 * use. The packages a run imports are loaded from the sandbox's own files
 * first.
 *
 * The run's project is at `/project`, read-only: a file system of its own
 * (`projectFS`), made again for every run from what the run says is in it,
 * whose files are read from the sandbox's scheme a piece at a time as the
 * code reads them.
 */

import { loadPyodide } from './pyodide/pyodide.mjs'

/**
 * Runs code in the namespace runs share, and answers `[value, error]`. Defined
 * in a namespace of its own, out of the code's sight. The traceback starts at
 * the code's own frame, not Pyodide's.
 */
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

/** Where the project is. */
const PROJECT = '/project'

/** How much of a file is read at once. */
const PIECE = 4 * 1024 * 1024

/** How many pieces are kept, the one read longest ago let go first. */
const PIECES_KEPT = 16

/**
 * A file system of the project as one run was handed it, in the shape of
 * Emscripten's WORKERFS: every folder and file made as it is mounted, and
 * nothing to be changed.
 *
 * @param {any} FS - Pyodide's
 * @param {{at: string, listing: {path: string, id?: string, size?: number}[]}} project
 */
function projectFS(FS, { at, listing }) {
  const DIR_MODE = 0o40555
  const FILE_MODE = 0o100444
  // EPERM, EIO and EINVAL, as Emscripten numbers them.
  const [EPERM, EIO, EINVAL] = [63, 29, 28]
  /** @type {Map<string, Uint8Array>} */
  const pieces = new Map()
  // One request for every piece: a request holds what it was last answered
  // until it is collected, and a new one for each piece leaves the memory of
  // a large file behind it, while one asked again lets the last go.
  const request = new XMLHttpRequest()

  /**
   * A piece of a file, read now if it isn't kept.
   *
   * @param {{url: string, size: number}} file
   * @param {number} index
   */
  const pieceOf = (file, index) => {
    const key = `${file.url} ${index}`
    let bytes = pieces.get(key)
    if (bytes) {
      pieces.delete(key)
    } else {
      const start = index * PIECE
      const end = Math.min(start + PIECE, file.size)
      request.open('GET', file.url, false)
      request.responseType = 'arraybuffer'
      request.setRequestHeader('Range', `bytes=${start}-${end - 1}`)
      request.send()
      if (request.status !== 206 && request.status !== 200) throw new FS.ErrnoError(EIO)
      bytes = new Uint8Array(request.response)
      if (pieces.size >= PIECES_KEPT) pieces.delete(pieces.keys().next().value)
    }
    pieces.set(key, bytes)
    return bytes
  }

  const refuse = () => {
    throw new FS.ErrnoError(EPERM)
  }

  const node_ops = {
    getattr: node => ({
      dev: 1,
      ino: node.id,
      mode: node.mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: node.size,
      atime: new Date(node.timestamp),
      mtime: new Date(node.timestamp),
      ctime: new Date(node.timestamp),
      blksize: 4096,
      blocks: Math.ceil(node.size / 4096),
    }),
    setattr: refuse,
    lookup: () => {
      throw new FS.ErrnoError(44)
    },
    mknod: refuse,
    rename: refuse,
    unlink: refuse,
    rmdir: refuse,
    symlink: refuse,
    readdir: node => ['.', '..', ...Object.keys(node.contents)],
  }

  const stream_ops = {
    read(stream, buffer, offset, length, position) {
      const file = stream.node.contents
      const end = Math.min(position + length, file.size)
      let at = position
      while (at < end) {
        const index = Math.floor(at / PIECE)
        const bytes = pieceOf(file, index)
        const from = at - index * PIECE
        const count = Math.min(bytes.length - from, end - at)
        if (count <= 0) break
        buffer.set(bytes.subarray(from, from + count), offset + (at - position))
        at += count
      }
      return at - position
    },
    write: refuse,
    llseek(stream, offset, whence) {
      const position =
        whence === 1 ? stream.position + offset : whence === 2 ? stream.node.size + offset : offset
      if (position < 0) throw new FS.ErrnoError(EINVAL)
      return position
    },
  }

  const made = (parent, name, mode, contents, size) => {
    const node = FS.createNode(parent, name, mode)
    node.mode = mode
    node.node_ops = node_ops
    node.stream_ops = stream_ops
    node.timestamp = Date.now()
    node.contents = contents
    node.size = size
    if (parent) parent.contents[name] = node
    return node
  }

  return {
    mount(mount) {
      const root = made(null, '/', DIR_MODE, {}, 4096)
      // Its own before anything is made in it, as what is made takes it from
      // the folder it is made in: an unmount lets go of what is in the mount.
      root.mount = mount
      /** @type {Map<string, any>} */
      const folders = new Map([['', root]])
      const split = (/** @type {string} */ path) => {
        const cut = path.lastIndexOf('/')
        return [cut < 0 ? '' : path.slice(0, cut), path.slice(cut + 1)]
      }
      const folderAt = (/** @type {string} */ path) => {
        let folder = folders.get(path)
        if (folder) return folder
        const [above, name] = split(path)
        folder = made(folderAt(above), name, DIR_MODE, {}, 4096)
        folders.set(path, folder)
        return folder
      }
      for (const { path, id, size } of listing) {
        if (id === undefined) {
          folderAt(path)
          continue
        }
        const [above, name] = split(path)
        made(folderAt(above), name, FILE_MODE, { url: at + encodeURIComponent(id), size }, size)
      }
      return root
    },
  }
}

/**
 * Put the run's project at `/project`, in place of the last run's.
 *
 * @param {any} FS
 * @param {{at: string, listing: {path: string, id?: string, size?: number}[]}} project
 */
function mountProject(FS, project) {
  if (FS.isMountpoint(FS.lookupPath(PROJECT, { follow_mount: false }).node)) FS.unmount(PROJECT)
  FS.mount(projectFS(FS, project), {}, PROJECT)
}

self.addEventListener(
  'message',
  async event => {
    const port = event.ports[0]
    let pyodide
    let run
    try {
      pyodide = await loadPyodide({ indexURL: new URL('./pyodide/', import.meta.url).href })
      const scope = pyodide.globals.get('dict')()
      pyodide.runPython(RUNNER, { globals: scope })
      run = scope.get('run')
      pyodide.FS.mkdir(PROJECT)
    } catch (error) {
      port.postMessage({ error: String(error?.message || error) })
      return
    }

    port.onmessage = async ({ data: { id, code, filename, project } }) => {
      const stdout = []
      const stderr = []
      pyodide.setStdout({ batched: line => stdout.push(line) })
      pyodide.setStderr({ batched: line => stderr.push(line) })
      mountProject(pyodide.FS, project)
      // A package that isn't there is the import's error to report.
      await pyodide
        .loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} })
        .catch(() => {})
      const answer = await run(code, filename)
      const [value, error] = answer.toJs()
      answer.destroy()
      port.postMessage({
        id,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        value: value ?? null,
        error: error ?? null,
      })
    }
    port.postMessage({ ready: true })
  },
  { once: true }
)
