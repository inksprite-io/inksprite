/**
 * What the page may ask of the native side, answered here: requests to
 * servers, sign-ins in the system browser, links opened outside the app,
 * windows, updates, the settings file a script left, the library its
 * projects are kept in, exports to a folder the writer chooses, and Python
 * for the model to run code in. `preload.cjs` is the page's end of it, and
 * `src/platform/` in the page is what calls it.
 *
 * Only the app's own page is answered: each call is checked for where it came
 * from, whatever the window has loaded.
 */

import { BrowserWindow, ipcMain, net, shell } from 'electron'
import { realpath } from 'node:fs/promises'
import { openable, originOf, webAddress } from './links.js'
import { listen } from './loopback.js'
import { downloadUpdate, installUpdate } from './updates.js'
import { readSettingsFile } from './settingsFile.js'
import { libraryFolder, librarySettings, markMoved } from './library.js'
import { exportFolders } from './exporting.js'
import { bringForward } from './windows.js'
import { PythonSessions } from './sandbox.js'

/** Statuses whose response has no body. */
const NO_BODY = new Set([101, 103, 204, 205, 304])

/**
 * Answer the page's calls.
 *
 * @param {string} origin - The page's origin: `app://inksprite`, or the dev
 *   server's
 * @param {{openWindow: (path: string) => unknown}} windows - Opens a window on
 *   a path of the page (`windows.js`)
 */
export function handleBridge(origin, { openWindow }) {
  /**
   * Answer `channel` with `answer`'s result as `{value}`, or what it threw as
   * `{error}`, which the preload throws again as an Error with that message.
   *
   * @param {string} channel
   * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => any} answer
   */
  const handle = (channel, answer) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromPage(event, origin)) return { error: 'Only the app’s page may ask that.' }
      try {
        return { value: await answer(event, ...args) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })

  /**
   * Listen for `channel`, from the page only.
   *
   * @param {string} channel
   * @param {(event: Electron.IpcMainEvent, ...args: any[]) => void} listener
   */
  const on = (channel, listener) =>
    ipcMain.on(channel, (event, ...args) => {
      if (fromPage(event, origin)) listener(event, ...args)
    })

  // Requests to servers, made here rather than in the page, so that no server
  // refuses them for the page's origin (`src/platform/fetch.js`). They go out
  // through Chromium's network stack, as the page's would: the system's proxy
  // and certificates apply.
  /** @type {Map<string, AbortController>} */
  const requests = new Map()
  handle('fetch', async (event, id, request) => {
    const key = `${event.sender.id}:${id}`
    const controller = new AbortController()
    requests.set(key, controller)
    /** @param {object} part */
    const send = part => {
      if (!event.sender.isDestroyed()) event.sender.send('fetch:body', id, part)
    }
    let response
    try {
      response = await net.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect,
        credentials: 'omit',
        signal: controller.signal,
      })
    } catch (error) {
      requests.delete(key)
      throw error
    }
    stream(response, send).finally(() => requests.delete(key))
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
    }
  })
  on('fetch:abort', (event, id) => requests.get(`${event.sender.id}:${id}`)?.abort())

  // Sign-ins, in the system browser and back (`src/platform/signIn.js`). One
  // is waited for at a time: a sign-in started while another waits takes its
  // place.
  /** @type {{key: string, stop: () => void}|null} */
  let waiting = null
  handle('signIn', async (event, id, { address, port, path }) => {
    if (!webAddress(address)) throw new Error(`Not an address to sign in at: ${address}`)
    waiting?.stop()
    const key = `${event.sender.id}:${id}`
    const listening = await listen(port, path)
    waiting = { key, stop: listening.stop }
    try {
      await shell.openExternal(address)
    } catch (error) {
      listening.stop()
      throw new Error(`The browser could not be opened: ${error.message}`)
    }
    listening.back.then(query => {
      if (waiting?.key === key) waiting = null
      if (query === null || event.sender.isDestroyed()) return
      event.sender.send('signIn:back', id, query)
      BrowserWindow.fromWebContents(event.sender)?.focus()
    })
  })
  on('signIn:stop', (event, id) => {
    if (waiting?.key !== `${event.sender.id}:${id}`) return
    waiting.stop()
    waiting = null
  })

  // Links to other sites (`src/platform/open.js`).
  handle('open', async (_, url) => {
    if (!openable(url)) throw new Error(`Not a link that opens: ${url}`)
    try {
      await shell.openExternal(url)
    } catch (error) {
      throw new Error(`The browser could not be opened: ${error.message}`)
    }
  })

  // Windows (`src/platform/windows.js`): another one on a project, and the
  // one asking brought forward, when another window wants its project. A
  // window opens only on a path of the page (`windows.js`).
  handle('window:open', (_, path) => {
    openWindow(path)
  })
  handle('window:focus', event => bringForward(BrowserWindow.fromWebContents(event.sender)))

  // Updates from the public repository's releases (`updates.js`).
  handle('update:download', () => downloadUpdate())
  handle('update:install', () => installUpdate())

  // The settings file a script left in the app's data folder, read as the
  // page opens (`settingsFile.js`).
  handle('settings:file', () => readSettingsFile())

  // The library the projects are kept in (`library.js`, and
  // `src/storage/library.js` in the page). What is done there is done one
  // call at a time, in the order asked.
  /** @type {{at: string, folder: ReturnType<typeof libraryFolder>}|null} */
  let open = null
  const library = async () => {
    const { path } = await librarySettings()
    if (open?.at !== path) open = { at: path, folder: libraryFolder(await realpath(path)) }
    return open.folder
  }
  /** @type {Promise<unknown>} */
  let doing = Promise.resolve()
  /** @param {(folder: ReturnType<typeof libraryFolder>) => Promise<any>} work */
  const inTurn = work => {
    const done = doing.then(async () => work(await library()))
    doing = done.catch(() => {})
    return done
  }
  handle('library:settings', () => librarySettings())
  handle('library:moved', () => markMoved())
  handle('library:projects', () => inTurn(folder => folder.projects()))
  handle('library:walk', (_, dir) => inTurn(folder => folder.walk(dir)))
  handle('library:read', (_, paths) => inTurn(folder => folder.readTexts(paths)))
  handle('library:list', (_, dir) => inTurn(folder => folder.list(dir)))
  handle('library:readBytes', (_, path) => inTurn(folder => folder.readBytes(path)))
  handle('library:apply', (_, ops) => inTurn(folder => folder.apply(ops)))
  handle('library:reveal', (_, path) => inTurn(folder => folder.reveal(path)))

  // A project or a folder exported to a folder the writer chooses
  // (`exporting.js`), its imported files copied from the library.
  const exports = exportFolders()
  handle('export:choose', (event, name) =>
    exports.choose(BrowserWindow.fromWebContents(event.sender), name)
  )
  handle('export:write', (_, target, entries) =>
    exports.write(target, entries, file => inTurn(folder => folder.locate(file)))
  )

  // Python, a session for each chat, fenced from everything here
  // (`sandbox.js`, and `src/platform/python.js` in the page). The project a
  // run is handed names its imported files by their paths in the library,
  // which are found here, and left out when they aren't there. A file still
  // only on the sync server is the page's to fetch, which it is asked to do
  // when the run reads it, and answers with where it is in the library then.
  const python = new PythonSessions()
  let fetchesAsked = 0
  /** @type {Map<string, (file: string|null) => void>} */
  const fetches = new Map()
  /**
   * @param {Electron.WebContents} page
   * @param {string} session
   * @returns {(id: string) => Promise<string|null>}
   */
  const fetchFrom = (page, session) => id =>
    new Promise(resolve => {
      if (page.isDestroyed()) return resolve(null)
      const request = ++fetchesAsked
      const key = `${page.id}:${request}`
      const closed = () => answered(null)
      const answered = (/** @type {string|null} */ file) => {
        fetches.delete(key)
        page.off('destroyed', closed)
        resolve(file)
      }
      fetches.set(key, answered)
      page.once('destroyed', closed)
      page.send('python:fetchFile', session, request, id)
    })
  on('python:fetched', (event, request, file) =>
    fetches.get(`${event.sender.id}:${request}`)?.(typeof file === 'string' ? file : null)
  )
  handle('python:run', async (event, session, code, options = {}) => {
    const { timeoutMs = null, project = null, filename = null } = options ?? {}
    if (typeof session !== 'string' || typeof code !== 'string') {
      throw new Error('Python runs a string of code, in a session named by a string.')
    }
    if (timeoutMs !== null && !(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
      throw new Error('A run’s time limit is a number of milliseconds, or none.')
    }
    if (filename !== null && typeof filename !== 'string') {
      throw new Error('A run’s file name is a string, or none.')
    }
    if (project !== null && !Array.isArray(project)) {
      throw new Error('A run’s project is a list of what is in it, or none.')
    }
    const locate = (/** @type {string} */ file) => inTurn(folder => folder.locate(file))
    const entries =
      project && (await projectFiles(project, locate, fetchFrom(event.sender, session)))
    return python.run(session, code, { timeoutMs, project: entries, filename })
  })
  on('python:stop', (_, session) => python.stop(session))
}

/**
 * A run's project as the page handed it, each imported file found in the
 * library, each one still on the sync server to be fetched as it is read,
 * and anything not as a project's entries are left out.
 *
 * @param {unknown[]} project
 * @param {(file: string) => Promise<{path: string, size: number}|null>} locate -
 *   Where a file in the library is on the disk, and how large
 * @param {(id: string) => Promise<string|null>} fetchFile - Has the page fetch
 *   a file into the library, and says where it is there
 * @returns {Promise<import('./sandbox.js').ProjectEntry[]>}
 */
export async function projectFiles(project, locate, fetchFile) {
  const found = await Promise.all(
    project.map(async (/** @type {any} */ entry) => {
      if (typeof entry?.path !== 'string' || !entry.path) return null
      if (entry.folder === true) return { path: entry.path, folder: /** @type {const} */ (true) }
      if (typeof entry.id !== 'string') return null
      const { path, id } = entry
      if (typeof entry.text === 'string') return { path, id, text: entry.text }
      if (entry.onServer === true) {
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) return null
        const fetch = async () => {
          const file = await fetchFile(id)
          return file ? locate(file) : null
        }
        return { path, id, size: /** @type {number} */ (entry.size), fetch }
      }
      if (typeof entry.file !== 'string') return null
      const at = await locate(entry.file).catch(() => null)
      return at && { path, id, file: at.path, size: at.size }
    })
  )
  return found.filter(entry => entry !== null)
}

/**
 * Hand a response's body to the page as it comes, and say when it has all
 * come, or failed.
 *
 * @param {Response} response
 * @param {(part: {chunk?: Uint8Array, done?: true, error?: string}) => void} send
 * @returns {Promise<void>}
 */
async function stream(response, send) {
  if (!response.body || NO_BODY.has(response.status)) {
    send({ done: true })
    return
  }
  try {
    for await (const chunk of response.body) send({ chunk })
    send({ done: true })
  } catch (error) {
    send({ error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Whether a call came from the app's page, in the window's top frame.
 *
 * @param {Electron.IpcMainEvent|Electron.IpcMainInvokeEvent} event
 * @param {string} origin
 * @returns {boolean}
 */
function fromPage(event, origin) {
  const frame = event.senderFrame
  return Boolean(frame && !frame.parent) && originOf(frame.url) === origin
}
