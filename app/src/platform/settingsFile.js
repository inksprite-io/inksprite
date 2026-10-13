/**
 * @module platform/settingsFile
 * @description In the desktop app, the settings file a script may leave in
 * the app's data folder for it to import as it opens. See
 * `composables/useSettingsFile.js`.
 */

import { desktop, isDesktop } from './desktop.js'

/**
 * The settings file's text, or null when there is none, or no folder to
 * leave one in: in a browser.
 *
 * @returns {Promise<string|null>}
 */
export async function settingsFileText() {
  if (!isDesktop()) return null
  return desktop().settingsFile()
}
