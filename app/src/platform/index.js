/**
 * @module platform
 * @description What differs between the app in a browser and the app in its
 * desktop window.
 *
 * The desktop app is the same build in a window of its own (Electron, in
 * `app/electron/`). Most of the app cannot tell the difference and should
 * not have to. What can is gathered here, behind functions that do the right
 * thing in either place, so the rest of the app asks for a request or a
 * sign-in rather than for a platform.
 *
 * - **desktop** - Whether the app is in its desktop window, and the bridge
 *   to the native side there
 * - **fetch** - Requests to servers: the page's own in a browser, made from
 *   the native side in the desktop app, where no server can refuse them for
 *   their origin
 * - **signIn** - Where a sign-in comes back to, and, in the desktop window,
 *   a sign-in in the system browser, waited for on localhost
 * - **updates** - In the desktop app, an update looked for and downloaded,
 *   and installed when the writer restarts into it
 * - **open** - Links to other sites, opened in a new tab in a browser and in
 *   the system browser from the desktop window, never in the app's own place
 * - **persistence** - Asking the browser to keep the page's data, and what
 *   the writer is told about how long it will
 *
 * Design: `.llm/desktop_design.md`.
 *
 * @example
 * import { fetch } from '@/platform/fetch.js'
 *
 * const response = await fetch(`${endpoint}/models`, { signal })
 */

export { isDesktop } from './desktop.js'
export { fetch } from './fetch.js'
export { SIGN_IN_PORT, callbackOrigin, signInInBrowser } from './signIn.js'
export { downloadUpdate, installUpdate } from './updates.js'
export { openUrl, openLinkClicked } from './open.js'
export { askToKeepData, storageAdvice } from './persistence.js'
