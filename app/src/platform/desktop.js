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
 * @property {() => Promise<string|null>} downloadUpdate
 * @property {() => Promise<void>} installUpdate
 * @property {() => Promise<string|null>} settingsFile - The text of the settings
 *   file a script left in the app's data folder, or null when there is none
 * @property {(save: () => Promise<void>) => void} beforeClosing - What to do
 *   before the window closes or the app quits, which waits for it a while
 * @property {DesktopLibrary} library - The folder the projects are kept in
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
