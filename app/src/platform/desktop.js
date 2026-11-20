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
 * @property {(listener: ((command: string, detail?: number) => void)|null) => void} [onMenuCommand] -
 *   What to do when the menu asks something of the page, or null for nothing.
 *   Missing from a desktop app older than the page it loads.
 * @property {DesktopLibrary} library - The folder the projects are kept in
 * @property {DesktopPython} [python] - Python for the model to run code in,
 *   a session for each chat. Missing from a desktop app older than the page
 *   it loads.
 * @property {DesktopExportFolder} [exportFolder] - Exports written to a
 *   folder the writer chooses. Missing from a desktop app older than the
 *   page it loads.
 * @property {DesktopPdf} [pdf] - The page as it prints, saved as a PDF.
 *   Missing from a desktop app older than the page it loads.
 * @property {DesktopApps} [apps] - Other apps on this computer let into the
 *   writer's projects. Missing from a desktop app older than the page it
 *   loads.
 * @property {DesktopTerminals} [terminals] - Terminals, each a shell of the
 *   writer's. Missing from a desktop app older than the page it loads.
 */

/**
 * What every window's page is told of a terminal: it was made in a project,
 * the program in it named it, it rang, it was looked at since, or it is gone,
 * `failed` when its shell never started.
 *
 * @typedef {{type: 'made', project: string}
 *   | {type: 'title', title: string}
 *   | {type: 'bell'}
 *   | {type: 'seen'}
 *   | {type: 'exit', failed?: true}} TerminalEvent
 */

/**
 * The app's terminals, each a project's (`app/electron/src/terminals.js`). A
 * page makes and ends them; it is not what types in them.
 *
 * @typedef {Object} DesktopTerminals
 * @property {(project: string) => Promise<string>} create - Make one in a
 *   project, and say its id
 * @property {() => Promise<{id: string, project: string, title: string, rang: boolean}[]>} list -
 *   Every one, in whichever project
 * @property {(id: string) => Promise<void>} close
 * @property {(id: string) => Promise<void>} seen - One that rang has been
 *   looked at
 * @property {(listener: (id: string, event: TerminalEvent) => void) => void} onEvent
 */

/**
 * One app's way into the writer's projects (`app/electron/src/apps.js`).
 *
 * @typedef {Object} AppConnection
 * @property {string} id
 * @property {string} name - What the writer calls it
 * @property {string} token - What its requests carry
 * @property {string[]} projects - The projects ticked for it, by their ids
 * @property {boolean} readOnly - Whether it only reads: it is offered no tool
 *   that changes anything
 * @property {number} created
 */

/**
 * The connections, and whether their apps can get in.
 *
 * @typedef {Object} AppsState
 * @property {number} port - The port apps reach inksprite on
 * @property {boolean} enabled - Whether apps are let in at all
 * @property {AppConnection[]} connections
 * @property {boolean} listening - Whether the port is listened on, which it
 *   is only while apps are let in and there is a connection
 * @property {string|null} problem - Why it isn't, though it should be
 * @property {Record<string, number>} called - When each connection last asked
 *   something, by its id, since the app started
 */

/**
 * What a page says to an app's request: its answer, or that another window
 * is to be asked, and why (`app/electron/src/appCalls.js`).
 *
 * @typedef {{response: object}|{pass: 'elsewhere'|'behind'|'unready'}} AppAnswer
 */

/**
 * The connections other apps come in by (`app/electron/src/apps.js`), and
 * the way this window answers what they ask.
 *
 * @typedef {Object} DesktopApps
 * @property {() => Promise<AppsState>} list
 * @property {(name: string) => Promise<AppConnection>} add - Make one, with a
 *   token of its own and no project ticked
 * @property {(id: string, patch: Partial<Pick<AppConnection, 'name'|'projects'|'readOnly'>>) => Promise<AppConnection>} update
 * @property {(id: string) => Promise<void>} remove
 * @property {(port: number) => Promise<AppsState>} setPort - Listen on
 *   another port, from now
 * @property {(enabled: boolean) => Promise<AppsState>} setEnabled - Let apps
 *   in, or none
 * @property {(connection: string, document: string) => Promise<object|null>} [read] -
 *   What a connection last read or wrote of a document, as `keep` was handed
 *   it, or null. Missing, with `reads` and `keep`, from a desktop app from
 *   before they were kept.
 * @property {(connection: string) => Promise<object[]>} [reads] - Everything
 *   kept for a connection
 * @property {(connection: string, document: string, record: object) => Promise<void>} [keep] -
 *   Keep what a connection now has of a document
 * @property {(connection: string, file: {name: string, bytes: Uint8Array}) => Promise<{id: string}>} offer -
 *   Hold a file for a connection's app to fetch, once and within a few
 *   minutes, at `/export/<id>` of the address it reaches this computer by
 * @property {(answer: (connection: Omit<AppConnection, 'token'|'created'> & {address: string}, message: object, onStop: (stop: () => void) => void) => Promise<AppAnswer>) => void} answer -
 *   Say what answers an app's request in this window. `address` is where
 *   the app reaches this computer, and `onStop` takes what stops the
 *   request, should the app give up on it.
 */

/**
 * The page as it prints, saved as a PDF (`app/electron/src/printing.js`).
 *
 * @typedef {Object} DesktopPdf
 * @property {(name: string) => Promise<boolean>} save - Ask where, with a file
 *   of this name to start with, and save it there; false when the writer
 *   cancelled
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
