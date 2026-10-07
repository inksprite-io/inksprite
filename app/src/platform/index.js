/**
 * @module platform
 * @description What differs between the app in a browser and the app in its
 * desktop window.
 *
 * The desktop app is the same build in a native window (Tauri, in
 * `app/src-tauri/`). Most of the app cannot tell the difference and should
 * not have to. What can is gathered here, behind functions that do the right
 * thing in either place, so the rest of the app asks for a request or a
 * sign-in rather than for a platform.
 *
 * - **desktop** - Whether the app is in its desktop window
 * - **fetch** - Requests to servers: the page's own in a browser, made from
 *   the native side in the desktop app, where no server can refuse them for
 *   their origin
 * - **signIn** - Where a sign-in comes back to, and, in the desktop window,
 *   a sign-in in the system browser, waited for on localhost
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
