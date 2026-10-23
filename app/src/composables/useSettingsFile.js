/**
 * @module composables/useSettingsFile
 * @description In the desktop app, the settings file a script left in the
 * app's data folder, imported as the app opens.
 *
 * A team's script installs the app and leaves `inksprite-settings.json` in
 * its data folder: the connection to their model server, a preset on it,
 * their MCP servers. The app imports it before any store has read a row, so
 * nothing needs reloading, and without asking, since whoever left it there
 * meant it. Only what the file changed since it was last imported goes in,
 * so what the writer did since stands (`utils/settingsFile.js`). A file that
 * couldn't be read is said so once the app is up; one that went in is not.
 *
 * Design: `.llm/settings_import_design.md`.
 */

import { onMounted } from 'vue'
import { settingsFileText } from '@/platform/settingsFile.js'
import { useBackup } from './useBackup.js'
import { useToast } from './useToast.js'

/**
 * Why the file couldn't be imported, to say once the app is up.
 *
 * @type {string|null}
 */
let failure = null

/**
 * Import the settings file a script left, if there is one. Called once, as
 * the app opens, before it mounts. Never throws: a file that can't be read
 * is said so once the app is up, and the app opens as it would without one.
 *
 * @returns {Promise<void>}
 */
export async function importSettingsFile() {
  failure = null
  try {
    const text = await settingsFileText()
    if (text === null) return
    const backup = useBackup()
    await backup.importSettings(await backup.planLeftSettings(text))
  } catch (error) {
    console.error('The settings file could not be imported:', error)
    const reason = error instanceof Error ? error.message : String(error)
    failure = `The settings file couldn't be imported. ${reason}`
  }
}

/**
 * Say why the settings file couldn't be imported, once the app is up.
 * Called by the app, in its setup. It stays until it is closed: the file
 * stays broken until someone fixes it.
 */
export function useSettingsFileNotice() {
  const toast = useToast()
  // Mounted, so that the toasts are there to show it.
  onMounted(() => {
    if (!failure) return
    const message = failure
    failure = null
    toast.showToast({ type: 'error', message, duration: 0 })
  })
}
