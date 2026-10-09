/**
 * Updates from the public repository's latest release.
 *
 * electron-updater reads the release's `latest*.yml` (the address is in
 * `electron-builder.yml`, under `publish`), downloads the update for this
 * platform, and checks it against the hash the file gives. On a Mac, the
 * system checks too that the new app is signed by the same developer as this
 * one. The page asks for the download and says when to install it
 * (`src/composables/useUpdates.js`); nothing is installed unasked, not even on
 * quitting. An app run from the checkout never looks.
 */

import { app } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

/** The version downloaded, ready to install. @type {string|null} */
let downloaded = null

/** The look under way, if any. @type {Promise<string|null>|null} */
let looking = null

/**
 * Look for an update and download it.
 *
 * @returns {Promise<string|null>} The version downloaded, or null when the
 *   app is up to date or not a packaged build
 */
export async function downloadUpdate() {
  if (!app.isPackaged) return null
  if (downloaded) return downloaded
  looking ??= look().finally(() => (looking = null))
  return looking
}

/** @returns {Promise<string|null>} */
async function look() {
  const result = await autoUpdater.checkForUpdates()
  if (!result?.isUpdateAvailable) return null
  await autoUpdater.downloadUpdate()
  downloaded = result.updateInfo.version
  return downloaded
}

/**
 * Install the update downloaded, and restart into it: silently, on Windows,
 * where the installer would otherwise show its pages.
 */
export function installUpdate() {
  if (!downloaded) throw new Error('No update has been downloaded.')
  autoUpdater.quitAndInstall(true, true)
}
