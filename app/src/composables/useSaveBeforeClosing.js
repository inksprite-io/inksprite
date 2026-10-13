/**
 * @module composables/useSaveBeforeClosing
 * @description In the desktop app, edits saved before the window closes or
 * the app quits.
 */

import { beforeClosing } from '@/platform/closing.js'
import { useSyncStore } from '@/stores/syncStore.js'
import { useEditor } from './useEditor.js'

/**
 * Save what is waiting to be saved before the desktop app's window closes or
 * it quits. Called once, by the app, in its setup. Nothing in a browser.
 */
export function useSaveBeforeClosing() {
  beforeClosing(async () => {
    // Edits wait twice on the way to the database, in the open document and
    // then the store, and closing would lose them: both are saved first.
    useEditor().flush()
    await useSyncStore().processSync()
  })
}
