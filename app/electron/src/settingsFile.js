/**
 * The settings file a script may leave in the app's data folder, for the
 * page to import as it opens (`src/composables/useSettingsFile.js`): a
 * team's connections, presets and MCP servers, put in place by whatever
 * installed the app. The page decides what to take from it; it is only read
 * here, and left where it is, so a script can write a newer one over it.
 */

import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Its name: what Export saves for settings, without the date. */
export const SETTINGS_FILE = 'inksprite-settings.json'

/** Where it is left: `~/Library/Application Support/inksprite/` on a Mac. */
export const settingsFilePath = () => path.join(app.getPath('userData'), SETTINGS_FILE)

/**
 * The file's text, or null when there is none.
 *
 * @returns {Promise<string|null>}
 */
export async function readSettingsFile() {
  try {
    return await fs.readFile(settingsFilePath(), 'utf8')
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null
    throw error
  }
}
