/**
 * @module platform/desktop
 * @description Whether the app is running in its desktop window, and the
 * bridge to the native side there.
 */

/**
 * What the native side is asked for a request: the page's `Request`, read
 * out.
 *
 * @typedef {Object} DesktopRequest
 * @property {string} url
 * @property {string} method
 * @property {[string, string][]} headers
 * @property {Uint8Array|null} body
 * @property {RequestRedirect} redirect
 */

/**
 * A response's status and headers, without its body.
 *
 * @typedef {Object} DesktopResponse
 * @property {number} status
 * @property {string} statusText
 * @property {[string, string][]} headers
 */

/**
 * A piece of a response's body: a chunk of it, or word that it has all come,
 * or that it failed.
 *
 * @typedef {{chunk: Uint8Array}|{done: true}|{error: string}} DesktopBodyPart
 */

/**
 * What the desktop app's native side offers the page (`app/electron/src/
 * preload.cjs`). Calls that go wrong reject with an Error saying what did.
 *
 * @typedef {Object} DesktopBridge
 * @property {(id: number, request: DesktopRequest, onBody: (part: DesktopBodyPart) => void) => Promise<DesktopResponse>} fetch
 *   Make a request, with an id of the page's choosing for `abortFetch`
 * @property {(id: number) => void} abortFetch
 * @property {(id: number, request: {address: string, port: number, path: string}, onReturn: (query: string) => void) => Promise<void>} signIn
 *   Open `address` in the system browser and wait on `port` for the browser
 *   to come back to `path`; `onReturn` gets the query it came back with
 * @property {(id: number) => void} stopSignIn
 * @property {(url: string) => Promise<void>} openInBrowser
 * @property {(path: string) => Promise<void>} openWindow - Open another window,
 *   on a path of the page
 * @property {() => Promise<void>} focusWindow - Bring this window to the front
 * @property {() => Promise<string|null>} downloadUpdate
 * @property {() => Promise<void>} installUpdate
 * @property {() => Promise<string|null>} settingsFile - The text of the settings
 *   file a script left in the app's data folder, or null when there is none
 * @property {(save: () => Promise<void>) => void} beforeClosing - What to do
 *   before the window closes or the app quits, which waits for it a while
 * @property {DesktopLibrary} library - The folder the projects are kept in
 * @property {DesktopPython} [python] - Python for the model to run code in,
 *   a session for each chat. Missing from a desktop app older than the page
 *   it loads.
 * @property {DesktopExportFolder} [exportFolder] - Exports written to a
 *   folder the writer chooses. Missing from a desktop app older than the
 *   page it loads.
 */

/**
 * One thing in an export written to a folder, by its path in the export, the
 * export's own folder first: a directory, a text, a file's bytes, or a file
 * in the library to copy.
 *
 * @typedef {{path: string, folder: true}
 *   | {path: string, text: string}
 *   | {path: string, bytes: Uint8Array}
 *   | {path: string, file: string}} DesktopExportEntry
 */

/**
 * Exports written to a folder of the writer's (`app/electron/src/exporting.js`).
 *
 * @typedef {Object} DesktopExportFolder
 * @property {(name: string) => Promise<string|null>} choose - Ask where, with
 *   a folder of this name to start with; null when the writer cancelled
 * @property {(target: string, entries: DesktopExportEntry[]) => Promise<void>} write -
 *   Write an export where the writer chose, in place of what is there
 */

/**
 * What a run of Python came back with (`app/electron/src/sandbox.js`).
 *
 * @typedef {Object} PythonRun
 * @property {string} stdout - What the code printed
 * @property {string} stderr - What it wrote to stderr
 * @property {string|null} value - The `repr` of its last expression, if that
 *   had a value
 * @property {string|null} error - The traceback, if the code raised, or why
 *   the run was stopped
 * @property {boolean} restarted - Whether Python was started again, losing
 *   what the session's earlier runs had defined
 */

/**
 * One thing in the project a run of Python reads at `/project`, by its path
 * there: a folder, a text, an imported file by its path in the library, which
 * the main process reads it from, or one still only on the sync server, by
 * its size, which the run's `fetchFile` brings into the library when the code
 * reads it.
 *
 * @typedef {{path: string, folder: true}
 *   | {path: string, id: string, text: string}
 *   | {path: string, id: string, file: string}
 *   | {path: string, id: string, size: number, onServer: true}} PythonProjectEntry
 */

/**
 * How a run of Python is run.
 *
 * @typedef {Object} PythonRunOptions
 * @property {number|null} [timeoutMs] - Stopped after this long; never for none
 * @property {PythonProjectEntry[]|null} [project] - What it finds at
 *   `/project`, which it can't change; an empty folder for none
 * @property {string|null} [filename] - What its traceback calls the code, when
 *   it was read from a file
 */

/**
 * Python, a session for each name the page gives.
 *
 * @typedef {Object} DesktopPython
 * @property {(session: string, code: string, options?: PythonRunOptions, fetchFile?: (id: string) => Promise<string|null>) => Promise<PythonRun>} run -
 *   Run code in the session, after any of its runs before; `fetchFile` brings
 *   a file of its project still on the sync server into the library, and
 *   says where it is there, or null when it couldn't
 * @property {(session: string) => void} stop - Stop the session's run under
 *   way, and its Python with it
 */

/**
 * Where the library is, and whether the window's own projects have been
 * moved into it.
 *
 * @typedef {{path: string, moved: boolean}} LibrarySettings
 */

/**
 * The library: where it is, and the files in it, by paths below it. What is
 * done there is `LibraryDisk` in `storage/library.js`.
 *
 * @typedef {import('../storage/library.js').LibraryDisk & {
 *   settings: () => Promise<LibrarySettings>,
 *   markMoved: () => Promise<void>,
 *   reveal: (path?: string) => Promise<void>,
 * }} DesktopLibrary
 */

/** Where the bridge is, in the page. */
const BRIDGE = '__INKSPRITE_DESKTOP__'

/**
 * Whether the app is running in its desktop window.
 *
 * Decided at runtime, not when the app is built: in development the browser
 * tab and the window load the same bundle from the same server.
 *
 * @returns {boolean}
 */
export const isDesktop = () => BRIDGE in globalThis

/**
 * The bridge to the native side, in the desktop window.
 *
 * @returns {DesktopBridge}
 */
export function desktop() {
  const bridge = globalThis[BRIDGE]
  if (!bridge) throw new Error('This is not the desktop app.')
  return bridge
}
