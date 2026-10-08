/**
 * @module platform/updates
 * @description Updates to the desktop app.
 *
 * The native side looks for one in the public repository's releases,
 * downloads it and checks its signature (`src-tauri/src/update.rs`); the page
 * only asks, and says when to install. A browser has none: the page it loads
 * is always the latest.
 */

import { isDesktop } from './desktop.js'

/**
 * Look for an update and download it, in the desktop app.
 *
 * @returns {Promise<string|null>} The version downloaded, ready to install;
 *   null when the app is up to date, or not the desktop app
 */
export async function downloadUpdate() {
  if (!isDesktop()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return /** @type {Promise<string|null>} */ (invoke('download_update').catch(rejectAsError))
}

/**
 * Install the update `downloadUpdate` downloaded, and restart into it. Does
 * not return, unless the install fails.
 *
 * @returns {Promise<void>}
 */
export async function installUpdate() {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('install_update').catch(rejectAsError)
}

/**
 * The native side says what went wrong as a plain string.
 *
 * @param {unknown} error
 * @returns {never}
 */
function rejectAsError(error) {
  throw typeof error === 'string' ? new Error(error) : error
}
