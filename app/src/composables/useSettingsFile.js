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
 * so what the writer did since stands (`utils/settingsFile.js`). Once the app
 * is up, a toast says what changed, if anything did, or why the file
 * couldn't be read.
 *
 * Design: `.llm/settings_import_design.md`.
 */

import { onMounted } from 'vue'
import { settingsFileText } from '@/platform/settingsFile.js'
import { changesAnything, describeImport } from '@/utils/settingsFile.js'
import { useBackup } from './useBackup.js'
import { useToast } from './useToast.js'

/**
 * What the app has to say about the file once it is up.
 *
 * @type {{type: 'success'|'error', message: string}|null}
 */
let notice = null

/**
 * Import the settings file a script left, if there is one. Called once, as
 * the app opens, before it mounts. Never throws: a file that can't be read
 * is said so once the app is up, and the app opens as it would without one.
 *
 * @returns {Promise<void>}
 */
export async function importSettingsFile() {
  notice = null
  try {
    const text = await settingsFileText()
    if (text === null) return
    const backup = useBackup()
    const plan = await backup.planLeftSettings(text)
    await backup.importSettings(plan)
    if (changesAnything(plan)) {
      notice = {
        type: 'success',
        message: `Settings imported. ${describeImport(plan, { done: true })}`,
      }
    }
  } catch (error) {
    console.error('The settings file could not be imported:', error)
    const reason = error instanceof Error ? error.message : String(error)
    notice = { type: 'error', message: `The settings file couldn't be imported. ${reason}` }
  }
}

/**
 * Say what importing the settings file did, once the app is up. Called by
 * the app, in its setup. A failure stays until it is closed: the file stays
 * broken until someone fixes it.
 */
export function useSettingsFileNotice() {
  const toast = useToast()
  // Mounted, so that the toasts are there to show it.
  onMounted(() => {
    if (!notice) return
    const { type, message } = notice
    notice = null
    toast.showToast({ type, message, duration: type === 'error' ? 0 : 10000 })
  })
}
