/**
 * @module platform/updates
 * @description Updates to the desktop app.
 *
 * The native side looks for one in the public repository's releases,
 * downloads it and checks it (`app/electron/src/updates.js`); the page only
 * asks, and says when to install. A browser has none: the page it loads is
 * always the latest.
 */

import { desktop, isDesktop } from './desktop.js'

/**
 * Look for an update and download it, in the desktop app.
 *
 * @returns {Promise<string|null>} The version downloaded, ready to install;
 *   null when the app is up to date, or not the desktop app
 */
export async function downloadUpdate() {
  if (!isDesktop()) return null
  return desktop().downloadUpdate()
}

/**
 * Install the update `downloadUpdate` downloaded, and restart into it. Does
 * not return, unless the install fails.
 *
 * @returns {Promise<void>}
 */
export async function installUpdate() {
  await desktop().installUpdate()
}
