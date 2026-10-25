/**
 * Check the Python sandbox (`src/sandbox.js`) against what it has to keep
 * out, in a real Electron: numpy and pandas load from the app's own files, a
 * run's state is kept, the project it is handed is there to read and not to
 * change, and no other session's is, no request reaches a server, the app's
 * database isn't there to read, nothing of Node is in reach, and a run that
 * doesn't end is stopped.
 *
 * After `node scripts/fetch-python.mjs`, in the container, on a display of
 * Xvfb's (`Xvfb :97 &`):
 *
 *   DISPLAY=:97 node_modules/.bin/electron scripts/check-sandbox.js --no-sandbox
 *
 * `--no-sandbox` because Chromium's own sandbox can't start in the container.
 * On a Mac, with the Electron `start-on-mac.sh` fetched, run without it, and
 * the sandbox's process should say it is sandboxed:
 *
 *   ~/Library/Caches/inksprite/electron-v44.7.0-darwin-arm64/Electron.app/Contents/MacOS/Electron scripts/check-sandbox.js
 */

import { BrowserWindow, app, protocol, session } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PythonSandbox, SANDBOX_PARTITION, SANDBOX_SCHEME_PRIVILEGES } from '../src/sandbox.js'

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'sandbox-check-')))
protocol.registerSchemesAsPrivileged([
  SANDBOX_SCHEME_PRIVILEGES,
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
// The checks wait for the app to be ready, which it isn't until this module
// has loaded: awaited here, it would never be.
app.whenReady().then(checkAll)

async function checkAll() {
  /** Every request and upgrade the local server is sent. */
  const hits = []
  const server = http.createServer((request, response) => {
    hits.push(request.url)
    response.end('reached')
  })
  server.on('upgrade', (request, socket) => {
    hits.push(`upgrade ${request.url}`)
    socket.destroy()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port
  const local = `http://127.0.0.1:${port}`

  // A stand-in for the app's page, in the app's session: its database holds a
  // key, and its requests reach the server, as the app's own do.
  protocol.handle(
    'app',
    () =>
      new Response('<!doctype html><title>app</title>', {
        headers: { 'Content-Type': 'text/html' },
      })
  )
  const appWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await appWindow.loadURL('app://inksprite/')
  await appWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
  const request = indexedDB.open('inksprite-check', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('secrets')
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const transaction = request.result.transaction('secrets', 'readwrite')
    transaction.objectStore('secrets').put('sk-check', 'apiKey')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  }
})`)
  await appWindow.webContents.executeJavaScript(
    `fetch('${local}/from-the-app', { mode: 'no-cors' }).then(() => 'ok', () => 'failed')`
  )

  const sandbox = new PythonSandbox()
  /** @type {{name: string, ok: boolean, detail: string}[]} */
  const results = []

  /**
   * Record a check, and print it.
   *
   * @param {{name: string, ok: boolean, detail: string}} result
   */
  function record(result) {
    results.push(result)
    console.log(`${result.ok ? '\u2713' : '\u2717'} ${result.name}`)
    console.log(result.detail.replace(/^/gm, '    '))
  }

  /**
   * Run `code` and record whether `expect` holds of the result.
   *
   * @param {string} name
   * @param {string} code
   * @param {(result: import('../src/sandbox.js').RunResult, ms: number) => boolean} expect
   * @param {import('../src/sandbox.js').RunOptions} [options]
   */
  async function check(name, code, expect, options) {
    const started = Date.now()
    let result
    try {
      result = await sandbox.run(code, options)
    } catch (error) {
      record({ name, ok: false, detail: `threw: ${error.message}` })
      return
    }
    const ms = Date.now() - started
    const shown = [result.value, result.stdout, result.stderr, result.error]
      .filter(Boolean)
      .join('\n')
    record({ name, ok: expect(result, ms), detail: `${ms} ms\n${shown}` })
  }

  await check('starts Python', 'import sys\nsys.version', r => /^'3\.14/.test(r.value ?? ''))

  await check(
    'runs numpy from the app’s files: d20 above 10, advantage and disadvantage',
    `import numpy as np

def exact(gap):
    """Every roll of the dice: keep the highest for advantage, the lowest for disadvantage."""
    dice = abs(gap) + 1
    faces = np.arange(1, 21, dtype=np.int8)
    rolls = np.stack(np.meshgrid(*[faces] * dice)).reshape(dice, -1)
    kept = rolls.max(axis=0) if gap >= 0 else rolls.min(axis=0)
    return (kept > 10).mean()

rng = np.random.default_rng(1)

def simulated(gap, n=200_000):
    rolls = rng.integers(1, 21, size=(abs(gap) + 1, n))
    kept = rolls.max(axis=0) if gap >= 0 else rolls.min(axis=0)
    return (kept > 10).mean()

for gap in range(-4, 5):
    print(f"{gap:+d}  exact {exact(gap):.4f}  simulated {simulated(gap):.4f}")
[round(float(exact(gap)), 6) for gap in range(-4, 5)]`,
    r =>
      r.value === '[0.03125, 0.0625, 0.125, 0.25, 0.5, 0.75, 0.875, 0.9375, 0.96875]' &&
      !hits.some(hit => hit.includes('numpy'))
  )

  await check('keeps what a run defined', 'x = 41', r => r.error === null)
  await check('for the next run', 'x + 1', r => r.value === '42')

  await check(
    'returns stdout and stderr',
    'import sys\nprint("out")\nprint("err", file=sys.stderr)',
    r => r.stdout === 'out' && r.stderr === 'err'
  )

  await check(
    'returns the traceback from the code’s own frame',
    'def f():\n    return 1 / 0\nf()',
    r =>
      /ZeroDivisionError/.test(r.error ?? '') &&
      /File "<code>", line 2/.test(r.error ?? '') &&
      !/_pyodide/.test(r.error ?? '')
  )

  // A project: a text, a table, a file of many pieces, and an empty folder.
  const folder = mkdtempSync(path.join(tmpdir(), 'sandbox-project-'))
  const table = path.join(folder, 'odds.csv')
  writeFileSync(
    table,
    ['skill,difficulty,chance', ...[1, 2, 3, 4, 5].map(n => `${n},3,${n / 10}`)].join('\n')
  )
  const large = path.join(folder, 'large.bin')
  const bytes = randomBytes(20 * 1024 * 1024 + 123)
  writeFileSync(large, bytes)
  /** @type {import('../src/sandbox.js').ProjectEntry[]} */
  const project = [
    { path: 'Rules', folder: true },
    { path: 'Rules/Combat', id: 'doc_1', text: '# Combat\n\nRoll a d20 – über alles.' },
    { path: 'Data/odds.csv', id: 'doc_2', file: table, size: statSync(table).size },
    { path: 'Data/large.bin', id: 'doc_3', file: large, size: bytes.length },
    { path: 'Empty', folder: true },
  ]
  await check(
    'reads the project it is handed',
    `import os
(sorted(os.listdir("/project")), open("/project/Rules/Combat").read())`,
    r => r.value === "(['Data', 'Empty', 'Rules'], '# Combat\\n\\nRoll a d20 – über alles.')",
    { project }
  )
  await check(
    'reads a table with pandas',
    'import pandas as pd\npd.read_csv("/project/Data/odds.csv")["chance"].sum()',
    r => /^(np\.float64\()?1\.5\)?$/.test(r.value ?? ''),
    { project }
  )
  await check(
    'reads a file of many pieces, in pieces',
    `import hashlib, os
digest = hashlib.sha256()
with open("/project/Data/large.bin", "rb") as file:
    file.seek(5)
    head = file.read(3)
    file.seek(0)
    while chunk := file.read(1_000_003):
        digest.update(chunk)
(head.hex(), digest.hexdigest(), os.path.getsize("/project/Data/large.bin"))`,
    r =>
      r.value ===
      `('${bytes.subarray(5, 8).toString('hex')}', '${createHash('sha256').update(bytes).digest('hex')}', ${bytes.length})`,
    { project }
  )
  await check(
    'changes nothing in the project',
    `import os, shutil
outcomes = {}
for name, attempt in {
    "write": lambda: open("/project/Rules/Combat", "w").write("x"),
    "append": lambda: open("/project/Rules/Combat", "a").write("x"),
    "create": lambda: open("/project/new.txt", "w").write("x"),
    "remove": lambda: os.remove("/project/Rules/Combat"),
    "rename": lambda: os.rename("/project/Rules/Combat", "/project/Combat"),
    "mkdir": lambda: os.mkdir("/project/Rules/More"),
    "rmdir": lambda: os.rmdir("/project/Empty"),
    "chmod": lambda: os.chmod("/project/Rules/Combat", 0o777),
    "rmtree": lambda: shutil.rmtree("/project"),
}.items():
    try:
        attempt()
        outcomes[name] = "allowed"
    except OSError as error:
        outcomes[name] = type(error).__name__
(outcomes, open("/project/Rules/Combat").read()[:8])`,
    r => r.error === null && !/allowed/.test(r.value ?? '') && /'# Combat'\)$/.test(r.value ?? ''),
    { project }
  )
  await check(
    'has the next run’s project in place of the last',
    'import os\n(os.listdir("/project"), os.path.exists("/project/Rules/Combat"))',
    r => r.value === '([], False)'
  )

  // Files still on the sync server: one fetched as it is first read, one
  // that can't be.
  const far = path.join(folder, 'far.csv')
  const farText = 'roll,count\n1,5\n20,7\n'
  let fetches = 0
  /** @type {import('../src/sandbox.js').ProjectEntry[]} */
  const elsewhere = [
    {
      path: 'Data/far.csv',
      id: 'doc_4',
      size: Buffer.byteLength(farText),
      fetch: async () => {
        fetches++
        writeFileSync(far, farText)
        return { path: far, size: statSync(far).size }
      },
    },
    { path: 'Data/gone.bin', id: 'doc_5', size: 10, fetch: async () => null },
  ]
  await check(
    'lists a file still on the server without fetching it',
    'import os\n(sorted(os.listdir("/project/Data")), os.path.getsize("/project/Data/far.csv"))',
    r => r.value === `(['far.csv', 'gone.bin'], ${Buffer.byteLength(farText)})` && fetches === 0,
    { project: elsewhere }
  )
  await check(
    'fetches it when it is read, once',
    `import pandas as pd
total = int(pd.read_csv("/project/Data/far.csv")["count"].sum())
(total, open("/project/Data/far.csv").read() == ${JSON.stringify(farText)})`,
    r => r.value === '(12, True)' && fetches === 1,
    { project: elsewhere }
  )
  await check(
    'reads one that couldn’t be fetched as an I/O error',
    `import errno
try:
    open("/project/Data/gone.bin", "rb").read()
except OSError as error:
    outcome = error.errno == errno.EIO
outcome`,
    r => r.value === 'True',
    { project: elsewhere }
  )
  await check(
    'calls a file’s code by the file in its traceback',
    'def f():\n    return 1 / 0\nf()',
    r => /File "\/project\/Sims\/fail\.py", line 2/.test(r.error ?? ''),
    { filename: '/project/Sims/fail.py' }
  )
  const other = new PythonSandbox()
  await other.run('1', { project: [{ path: 'Mine', id: 'doc_9', text: 'theirs' }] })
  await check(
    'can’t read another session’s project',
    `import js
from pyodide.http import pyfetch
answers = []
for url in ["sandbox://python/project/", "sandbox://python/project/x/doc_9", "sandbox://python/project/x/doc_1"]:
    try:
        answers.append((await pyfetch(url)).status)
    except Exception as error:
        answers.append(type(error).__name__)
answers`,
    r => r.value === '[404, 404, 404]',
    { project }
  )
  other.close()

  const hitsBefore = hits.length
  await check(
    'reaches no server',
    `import asyncio
import js
from pyodide.code import run_js
from pyodide.ffi import create_proxy
from pyodide.http import pyfetch

LOCAL = "${local}"
outcomes = {}

async def attempt(name, make):
    try:
        result = make()
        if asyncio.iscoroutine(result) or hasattr(result, "then"):
            result = await result
    except Exception as error:
        outcomes[name] = "refused: " + type(error).__name__
        return
    status = getattr(result, "status", None)
    outcomes[name] = f"answered {status}" if status is not None else "allowed"

async def connect(name, make):
    """A socket or a stream, which says whether it opened in an event."""
    try:
        source = make()
    except Exception as error:
        outcomes[name] = "refused: " + type(error).__name__
        return
    settled = asyncio.get_event_loop().create_future()
    def settle(outcome):
        if not settled.done():
            settled.set_result(outcome)
    source.onopen = lambda event: settle("allowed")
    source.onerror = lambda event: settle("refused: error event")
    try:
        outcomes[name] = await asyncio.wait_for(settled, 2)
    except TimeoutError:
        outcomes[name] = "neither opened nor failed"
    source.close()

def xhr():
    request = js.XMLHttpRequest.new()
    request.open("GET", LOCAL + "/xhr", False)
    request.send()
    return request

await attempt("fetch", lambda: js.fetch(LOCAL + "/fetch"))
await attempt("pyfetch", lambda: pyfetch(LOCAL + "/pyfetch"))
await attempt("sync XHR", xhr)
await connect("WebSocket", lambda: js.WebSocket.new("ws://127.0.0.1:${port}/ws"))
await connect("EventSource", lambda: js.EventSource.new(LOCAL + "/sse"))
await attempt("worker from a server", lambda: js.Worker.new(LOCAL + "/worker.js"))
await attempt("WebTransport", lambda: js.WebTransport.new("https://127.0.0.1:${port}/wt").ready)
await attempt("the web", lambda: js.fetch("https://example.com/"))
await attempt("the app’s page", lambda: js.fetch("app://inksprite/"))
await attempt("a file", lambda: js.fetch("file:///etc/hosts"))
await attempt("the sandbox’s main process", lambda: js.fetch("sandbox://python/../src/main.js"))
await attempt("eval", lambda: run_js("1 + 1"))
await asyncio.sleep(1)
outcomes`,
    r => r.error === null && hits.length === hitsBefore && !/allowed/.test(r.value ?? '')
  )
  console.log(
    `    server hits: ${hits.length - hitsBefore} (the app’s own: ${hits.filter(hit => hit === '/from-the-app').length})`
  )

  // The session turns requests down by itself, whatever the page's CSP says.
  const hitsBeforeSession = hits.length
  const refused = await session
    .fromPartition(SANDBOX_PARTITION)
    .fetch(`${local}/through-the-session`)
    .then(
      response => `answered ${response.status}`,
      error => `refused: ${error.message}`
    )
  record({
    name: 'turns requests down in its session, apart from the CSP',
    ok: refused.startsWith('refused') && hits.length === hitsBeforeSession,
    detail: refused,
  })

  await check(
    'can’t read the app’s database',
    `import asyncio
import js

names = [database.name for database in await js.indexedDB.databases()]
opened = asyncio.get_event_loop().create_future()
request = js.indexedDB.open("inksprite-check")

def settle(outcome):
    if not opened.done():
        opened.set_result(outcome)

request.onupgradeneeded = lambda event: settle("new and empty")
request.onsuccess = lambda event: settle("there: " + ", ".join(request.result.objectStoreNames))
request.onerror = lambda event: settle("error")
(str(js.self.origin), names, await opened)`,
    r => r.value === "('sandbox://python', [], 'new and empty')"
  )

  await check(
    'has nothing of Node or the window in reach',
    `import js
{name: hasattr(js, name) for name in ("require", "process", "module", "Buffer", "electron", "ipcRenderer", "window", "document", "RTCPeerConnection")}`,
    r => r.error === null && !/True/.test(r.value ?? '')
  )

  await check(
    'refuses an array bigger than WebAssembly can hold',
    'import numpy as np\ntry:\n    np.zeros(10**9)\n    outcome = "allocated"\nexcept (MemoryError, ValueError) as error:\n    outcome = type(error).__name__\noutcome',
    r => r.value === "'MemoryError'" || r.value === "'ValueError'"
  )

  const hitsBeforeImport = hits.length
  await check(
    'fetches no package it doesn’t have',
    'import scipy',
    r => /ModuleNotFoundError/.test(r.error ?? '') && hits.length === hitsBeforeImport
  )

  const pidBefore = sandbox.pid
  await check(
    'stops a run that doesn’t end',
    'while True:\n    pass',
    (r, ms) => r.restarted && /Stopped after 3 seconds/.test(r.error ?? '') && ms < 4500,
    { timeoutMs: 3000 }
  )
  await check('starts again without what was defined', 'x', r => /NameError/.test(r.error ?? ''))
  await check('and runs', '1 + 1', r => r.value === '2' && sandbox.pid !== pidBefore)

  const metrics = app.getAppMetrics().find(metric => metric.pid === sandbox.pid)
  record({
    name: 'runs in a process of its own',
    ok:
      sandbox.pid !== null &&
      sandbox.pid !== appWindow.webContents.getOSProcessId() &&
      sandbox.pid !== process.pid,
    detail: `sandbox ${sandbox.pid}, app ${appWindow.webContents.getOSProcessId()}, main ${process.pid}; ${metrics?.type}, sandboxed: ${metrics?.sandboxed ?? 'not reported on this system'}, ${Math.round((metrics?.memory.workingSetSize ?? 0) / 1024)} MB`,
  })

  const failed = results.filter(result => !result.ok).length
  console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`)
  sandbox.close()
  server.close()
  rmSync(folder, { recursive: true })
  app.exit(failed ? 1 : 0)
}
