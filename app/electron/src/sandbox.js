/**
 * Python for the model, run where it can reach nothing of the writer's.
 *
 * The code runs in Pyodide, in a worker of a page of its own (`../sandbox/`),
 * which is fenced in four ways:
 *
 * - **Its own session.** A partition kept in memory, apart from the app's,
 *   with storage of its own: the app's database, its keys and its tokens are
 *   not there to be read.
 * - **No network.** The session answers its own scheme, `sandbox://python/`,
 *   from the sandbox's files and Pyodide's, and turns down every other
 *   request. The page's CSP says the same.
 * - **Its own process**, under Chromium's sandbox, with no Node and no bridge:
 *   its preload hands the page one port to this side, and nothing else.
 * - **A time limit**, the page's to set, or none. A run that goes past it has
 *   its process killed, and the next run starts a new one. What the code had
 *   defined is lost. Memory is WebAssembly's 4 GB at most, and none of ours.
 *
 * Each chat has a Python of its own, kept between its runs (`PythonSessions`),
 * which `bridge.js` runs the page's code in.
 *
 * A run can be handed the chat's project, which Python reads at `/project`
 * and cannot change. The page says what is in it: a text document's text, an
 * imported file by where it is on the disk, or by its size and how to fetch
 * it, when it is still only on the sync server. Python is told only each
 * one's path and size, and reads it from here, a piece at a time as the code
 * reads it, at an address below `project/` that only its own session is told:
 * a large file is never copied whole, one still on the server is fetched only
 * when it is read, and one chat's Python can't ask for another's project.
 *
 * Pyodide is the `pyodide` package. The Python packages offered beside its
 * standard library are wheels fetched into `../python/` by
 * `scripts/fetch-python.mjs`, checked against Pyodide's lock file; nothing is
 * fetched once the app runs.
 */

import { MessageChannelMain, WebContentsView, session } from 'electron'
import { randomBytes } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The sandbox's scheme, which only its own session answers. */
export const SANDBOX_SCHEME = 'sandbox'

/** Where the sandbox's page is. */
const SANDBOX_URL = `${SANDBOX_SCHEME}://python/`

/** The session the sandbox runs in: in memory, and apart from the app's. */
export const SANDBOX_PARTITION = 'sandbox'

/** How long Pyodide may take to start. */
const START_TIMEOUT_MS = 30000

/** The most of a run's output, and of its value, that comes back. */
const MAX_OUTPUT = 20000

/** The scheme as `protocol.registerSchemesAsPrivileged` takes it. */
export const SANDBOX_SCHEME_PRIVILEGES = {
  scheme: SANDBOX_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}

/**
 * What the sandbox's page and worker may load: its own files, and WebAssembly
 * compiled from them. Nothing may be fetched from elsewhere.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "worker-src 'self'",
].join('; ')

/** Content types, by extension, of what the sandbox serves. */
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.whl': 'application/zip',
}

/**
 * The folders the sandbox serves from. Pyodide's is found when the first file
 * is asked for, so that the main process's tests needn't have it installed.
 *
 * @typedef {{page: string, pyodide: string, packages: string}} SandboxRoots
 */

/** @type {SandboxRoots|null} */
let roots = null

/** @returns {SandboxRoots} */
function sandboxRoots() {
  roots ??= {
    page: fileURLToPath(new URL('../sandbox', import.meta.url)),
    pyodide: path.dirname(createRequire(import.meta.url).resolve('pyodide/package.json')),
    packages: fileURLToPath(new URL('../python', import.meta.url)),
  }
  return roots
}

/**
 * The file a request for `pathname` is answered with: the page's own files at
 * the root, and Pyodide's, or a package's wheel, under `pyodide/`. Null for
 * anything else.
 *
 * @param {string} pathname - As in the request's URL, encoded
 * @param {SandboxRoots} [folders]
 * @returns {Promise<string|null>}
 */
export async function sandboxFile(pathname, folders = sandboxRoots()) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const [searched, name] = decoded.startsWith('/pyodide/')
    ? [[folders.pyodide, folders.packages], decoded.slice('/pyodide/'.length)]
    : [[folders.page], decoded.slice(1) || 'index.html']
  for (const folder of searched) {
    const file = path.join(folder, name)
    const relative = path.relative(folder, file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
    if ((await stat(file).catch(() => null))?.isFile()) return file
  }
  return null
}

/**
 * One thing in a run's project, as the page hands it over, its imported
 * files found on the disk: a folder, a text, a file there, or a file still to
 * be fetched, by its size and what brings it to the disk and says where it is
 * then.
 *
 * @typedef {{path: string, folder: true}
 *   | {path: string, id: string, text: string}
 *   | {path: string, id: string, file: string, size: number}
 *   | {path: string, id: string, size: number, fetch: () => Promise<{path: string, size: number}|null>}} ProjectEntry
 */

/**
 * What a document in a run's project is read from: its text, or its file.
 *
 * @typedef {{bytes: Buffer}|{file: string, size: number}} ReadSource
 */

/**
 * What a document in a run's project is read from, or a file to fetch
 * before it is, once however often it is read.
 *
 * @typedef {ReadSource|{size: number, fetch: () => Promise<ReadSource|null>}} ProjectSource
 */

/**
 * What each session's Python may read of its project now, by the token in
 * the address it reads at, then by document.
 *
 * @type {Map<string, Map<string, ProjectSource>>}
 */
const projects = new Map()

/**
 * A run's project as Python is told of it, a path and a size for each
 * document, and what each is read from.
 *
 * @param {ProjectEntry[]} entries
 * @returns {{listing: {path: string, id?: string, size?: number}[], sources: Map<string, ProjectSource>}}
 */
export function projectOf(entries) {
  /** @type {Map<string, ProjectSource>} */
  const sources = new Map()
  const listing = entries.map(entry => {
    if ('folder' in entry) return { path: entry.path }
    /** @type {ProjectSource} */
    const source =
      'file' in entry
        ? { file: entry.file, size: entry.size }
        : 'fetch' in entry
          ? { size: entry.size, fetch: once(entry.fetch) }
          : { bytes: Buffer.from(entry.text) }
    sources.set(entry.id, source)
    return { path: entry.path, id: entry.id, size: sizeOf(source) }
  })
  return { listing, sources }
}

/**
 * A file to fetch, fetched the first time it is asked for: what it is read
 * from then, or null when it couldn't be.
 *
 * @param {() => Promise<{path: string, size: number}|null>} fetch
 * @returns {() => Promise<ReadSource|null>}
 */
const once = fetch => {
  /** @type {Promise<ReadSource|null>|null} */
  let fetched = null
  return () =>
    (fetched ??= fetch().then(
      at => at && { file: at.path, size: at.size },
      () => null
    ))
}

/** @param {ProjectSource} source */
const sizeOf = source => ('bytes' in source ? source.bytes.length : source.size)

/**
 * The part of a document a `Range` header asks for, or all of it.
 *
 * @param {ReadSource} source
 * @param {string|null} range - As in the request, `bytes=start-end`
 * @returns {Promise<Response>}
 */
export async function projectResponse(source, range) {
  const size = sizeOf(source)
  const asked = range?.match(/^bytes=(\d+)-(\d*)$/)
  if (!asked) return new Response(await piece(source, 0, size), { headers: projectHeaders(size) })
  const start = Number(asked[1])
  const end = Math.min(asked[2] ? Number(asked[2]) + 1 : size, size)
  if (start >= end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const body = await piece(source, start, end)
  return new Response(body, {
    status: 206,
    headers: {
      ...projectHeaders(body.length),
      'Content-Range': `bytes ${start}-${start + body.length - 1}/${size}`,
    },
  })
}

/** @param {number} length */
const projectHeaders = length => ({
  'Content-Type': 'application/octet-stream',
  'Content-Length': String(length),
  'Accept-Ranges': 'bytes',
  'Content-Security-Policy': CSP,
})

/**
 * The bytes of a document from `start` up to `end`: fewer, if its file has
 * shrunk since.
 *
 * @param {ReadSource} source
 * @param {number} start
 * @param {number} end
 * @returns {Promise<Uint8Array>}
 */
async function piece(source, start, end) {
  if ('bytes' in source) return source.bytes.subarray(start, end)
  const handle = await open(source.file, 'r')
  try {
    const buffer = Buffer.alloc(end - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * What a request to the sandbox's scheme is answered with: a piece of a
 * document in a session's project, or one of the sandbox's own files.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function answer(request) {
  const url = new URL(request.url)
  if (url.host !== 'python') return new Response(null, { status: 404 })
  const [, top, token, id] = url.pathname.split('/')
  if (top === 'project') {
    const found = projects.get(token)?.get(decodeURIComponent(id ?? ''))
    const source = found && ('fetch' in found ? await found.fetch() : found)
    if (!source) return new Response(null, { status: 404 })
    return projectResponse(source, request.headers.get('Range')).catch(
      () => new Response(null, { status: 404 })
    )
  }
  const file = await sandboxFile(url.pathname)
  if (!file) return new Response(null, { status: 404 })
  return new Response(await readFile(file), {
    headers: {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
    },
  })
}

/**
 * Whether the sandbox's session lets a request through: only its own files.
 *
 * @param {string} url
 */
export function sandboxAllows(url) {
  return url.startsWith(SANDBOX_URL)
}

/** @type {Electron.Session|null} */
let sandboxSession = null

/** The sandbox's session, made the first time it is asked for. */
function getSession() {
  if (sandboxSession) return sandboxSession
  const ses = session.fromPartition(SANDBOX_PARTITION, { cache: false })
  ses.protocol.handle(SANDBOX_SCHEME, answer)
  ses.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !sandboxAllows(details.url) })
  )
  ses.setPermissionRequestHandler((_, __, grant) => grant(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
  ses.on('will-download', event => event.preventDefault())
  sandboxSession = ses
  return ses
}

/**
 * What a run comes back with.
 *
 * @typedef {Object} RunResult
 * @property {string} stdout - What the code printed
 * @property {string} stderr - What it wrote to stderr
 * @property {string|null} value - The `repr` of its last expression, if that
 *   had a value
 * @property {string|null} error - The traceback, if the code raised, or why
 *   the run was stopped
 * @property {boolean} restarted - Whether the run was stopped and Python
 *   started again, losing what earlier runs had defined
 */

/**
 * How a run is run.
 *
 * @typedef {Object} RunOptions
 * @property {number|null} [timeoutMs] - How long it may take; none for as
 *   long as it takes
 * @property {ProjectEntry[]|null} [project] - What Python finds at
 *   `/project` while it runs; an empty folder for none
 * @property {string|null} [filename] - What its traceback calls the code,
 *   when it was read from a file: `<code>` otherwise
 */

/**
 * A Python session: one interpreter, kept between runs, so that what one run
 * defines the next can use. Started on its first run; started again after a
 * run is stopped.
 */
export class PythonSandbox {
  /** @type {WebContentsView|null} */
  #view = null
  /** @type {Promise<Electron.MessagePortMain>|null} */
  #ready = null
  /** @type {Promise<unknown>} */
  #queue = Promise.resolve()
  #nextId = 1
  #running = false
  /** What the address Python reads its project at has in it, for no other session to know. */
  #token = randomBytes(16).toString('hex')

  /**
   * Run `code`, after any runs before it.
   *
   * @param {string} code
   * @param {RunOptions} [options]
   * @returns {Promise<RunResult>}
   */
  run(code, options = {}) {
    const run = this.#queue.then(() => this.#runNow(code, options))
    this.#queue = run.catch(() => {})
    return run
  }

  /** The renderer's process id, while Python is running: for the checks. */
  get pid() {
    return this.#view?.webContents.getOSProcessId() ?? null
  }

  /** Whether code is running now, rather than waiting for the next run. */
  get running() {
    return this.#running
  }

  /** Stop Python, and what it was doing. */
  close() {
    const view = this.#view
    this.#view = null
    this.#ready = null
    projects.delete(this.#token)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.forcefullyCrashRenderer()
      view.webContents.close()
    }
  }

  /**
   * @param {string} code
   * @param {RunOptions} options
   * @returns {Promise<RunResult>}
   */
  async #runNow(code, { timeoutMs = null, project = null, filename = null }) {
    let port
    try {
      port = await this.#start()
    } catch (error) {
      return { stdout: '', stderr: '', value: null, error: error.message, restarted: true }
    }
    const id = this.#nextId++
    const view = this.#view
    this.#running = true
    return new Promise(resolve => {
      const finish = (/** @type {RunResult} */ result) => {
        this.#running = false
        clearTimeout(timer)
        port.off('message', onMessage)
        view?.webContents.off('render-process-gone', onGone)
        resolve(result)
      }
      // Finished before the process is killed, which would otherwise say it
      // went unexpectedly.
      const stopped = (/** @type {string} */ error) => {
        finish({ stdout: '', stderr: '', value: null, error, restarted: true })
        this.close()
      }
      const timer = timeoutMs
        ? setTimeout(() => stopped(`Stopped after ${duration(timeoutMs)}.`), timeoutMs)
        : undefined
      const onGone = () => stopped('Python stopped unexpectedly.')
      /** @param {Electron.MessageEvent} event */
      const onMessage = ({ data }) => {
        if (data?.id !== id) return
        finish({
          stdout: clip(data.stdout),
          stderr: clip(data.stderr),
          value: data.value == null ? null : clip(data.value),
          error: data.error == null ? null : clip(data.error),
          restarted: false,
        })
      }
      const { listing, sources } = projectOf(project ?? [])
      projects.set(this.#token, sources)
      port.on('message', onMessage)
      view?.webContents.once('render-process-gone', onGone)
      port.postMessage({
        id,
        code,
        filename: filename ?? '<code>',
        project: { at: `${SANDBOX_URL}project/${this.#token}/`, listing },
      })
    })
  }

  /**
   * Python's port, once it has started.
   *
   * @returns {Promise<Electron.MessagePortMain>}
   */
  #start() {
    if (this.#ready) return this.#ready
    const view = new WebContentsView({
      webPreferences: {
        session: getSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: fileURLToPath(new URL('../sandbox/preload.cjs', import.meta.url)),
        spellcheck: false,
        backgroundThrottling: false,
        webgl: false,
        navigateOnDragDrop: false,
      },
    })
    const { webContents } = view
    webContents.on('will-navigate', event => event.preventDefault())
    webContents.on('will-attach-webview', event => event.preventDefault())
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.#view = view

    this.#ready = new Promise((resolve, reject) => {
      const { port1, port2 } = new MessageChannelMain()
      const timer = setTimeout(() => {
        this.close()
        reject(new Error('Python did not start.'))
      }, START_TIMEOUT_MS)
      port1.once('message', ({ data }) => {
        clearTimeout(timer)
        if (data?.ready) resolve(port1)
        else {
          this.close()
          reject(new Error(data?.error || 'Python did not start.'))
        }
      })
      port1.start()
      webContents.once('did-finish-load', () => webContents.postMessage('port', null, [port2]))
      webContents.loadURL(SANDBOX_URL).catch(error => {
        clearTimeout(timer)
        this.close()
        reject(error)
      })
    })
    // A start that failed is tried again on the next run.
    this.#ready.catch(() => {})
    return this.#ready
  }
}

/**
 * How long a chat's Python is kept with nothing run in it: long enough to
 * read what a run found and ask the next thing.
 */
const IDLE_MS = 60 * 60 * 1000

/** How many chats' Pythons are kept at once. */
const MAX_SESSIONS = 4

/**
 * A Python for each chat, by a key the page gives (the chat's id), kept
 * between its runs. One not run in for IDLE_MS is closed, and past
 * MAX_SESSIONS the one run in longest ago is, unless it is running.
 */
export class PythonSessions {
  /** @type {Map<string, {sandbox: PythonSandbox, idle?: ReturnType<typeof setTimeout>}>} */
  #sessions = new Map()
  /** The sessions closed since they last ran, whose next run starts afresh. */
  #ended = new Set()
  #make

  /** @param {() => PythonSandbox} [make] - Makes a session's Python */
  constructor(make = () => new PythonSandbox()) {
    this.#make = make
  }

  /**
   * Run `code` in the session's Python, started if it has none. A session
   * closed since its last run says that it started again.
   *
   * @param {string} key
   * @param {string} code
   * @param {RunOptions} [options]
   * @returns {Promise<RunResult>}
   */
  run(key, code, options) {
    const fresh = !this.#sessions.has(key) && this.#ended.delete(key)
    const entry = this.#take(key)
    const run = entry.sandbox
      .run(code, options)
      .then(result => (fresh ? { ...result, restarted: true } : result))
    run
      .finally(() => {
        if (this.#sessions.get(key) !== entry) return
        entry.idle = setTimeout(() => this.close(key), IDLE_MS)
      })
      .catch(() => {})
    return run
  }

  /**
   * Stop the session's run, if one is under way, and its Python with it. One
   * waiting for its next run keeps what it had defined.
   *
   * @param {string} key
   */
  stop(key) {
    const entry = this.#sessions.get(key)
    if (entry?.sandbox.running) this.close(key)
  }

  /**
   * Close the session's Python.
   *
   * @param {string} key
   */
  close(key) {
    const entry = this.#sessions.get(key)
    if (!entry) return
    clearTimeout(entry.idle)
    this.#sessions.delete(key)
    this.#ended.add(key)
    entry.sandbox.close()
  }

  /** The keys of the sessions kept, the one run in longest ago first. */
  get keys() {
    return [...this.#sessions.keys()]
  }

  /**
   * The session's entry, made if it has none, and moved to the end as the
   * one run in last.
   *
   * @param {string} key
   */
  #take(key) {
    const entry = this.#sessions.get(key) ?? { sandbox: this.#make() }
    clearTimeout(entry.idle)
    this.#sessions.delete(key)
    this.#sessions.set(key, entry)
    for (const [other, { sandbox }] of this.#sessions) {
      if (this.#sessions.size <= MAX_SESSIONS) break
      if (other !== key && !sandbox.running) this.close(other)
    }
    return entry
  }
}

/**
 * A time limit in words: "10 minutes", "1 hour", "90 seconds".
 *
 * @param {number} ms
 */
export function duration(ms) {
  const [amount, unit] =
    ms % 3600000 === 0
      ? [ms / 3600000, 'hour']
      : ms % 60000 === 0
        ? [ms / 60000, 'minute']
        : [Math.round(ms / 1000), 'second']
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`
}

/**
 * `text`, cut to MAX_OUTPUT, saying so if it was.
 *
 * @param {unknown} text
 */
function clip(text) {
  const string = typeof text === 'string' ? text : ''
  if (string.length <= MAX_OUTPUT) return string
  return `${string.slice(0, MAX_OUTPUT)}\n… (${string.length - MAX_OUTPUT} more characters)`
}
