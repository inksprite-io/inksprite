/**
 * @module composables/useUpdates
 * @description In the desktop app, updates downloaded as soon as there are
 * any, and a toast to restart into one.
 */

import { onMounted, onUnmounted } from 'vue'
import { isDesktop } from '@/platform/desktop.js'
import { downloadUpdate, installUpdate } from '@/platform/updates.js'
import { useSyncStore } from '@/stores/syncStore.js'
import { useEditor } from './useEditor.js'
import { useToast } from './useToast.js'

/** How often the app looks for an update again, after it opens. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * Look for an update as the app opens, and every hour after, and offer it
 * once it is downloaded. Called once, by the app, in its setup. Nothing in a
 * browser.
 */
export function useUpdates() {
  if (!isDesktop()) return
  const toast = useToast()

  /**
   * The version offered, if any. Each is offered once while the app is
   * open; closed without a restart, it is offered again the next time.
   * @type {string|null}
   */
  let offered = null
  /** @type {number|undefined} */
  let timer

  const restart = async () => {
    // Edits wait twice on the way to the database, in the open document and
    // then the store, and a restart would lose them: both are saved first.
    useEditor().flush()
    await useSyncStore().processSync()
    try {
      await installUpdate()
    } catch (error) {
      toast.error(`The update couldn't be installed: ${error.message}`)
    }
  }

  const look = async () => {
    try {
      const version = await downloadUpdate()
      if (!version || version === offered) return
      offered = version
      toast.action(
        `inksprite ${version} is ready.`,
        { label: 'Restart', command: restart },
        { duration: 0 }
      )
    } catch (error) {
      // Offline, most often. The next look tries again.
      console.warn('No update:', error)
    }
  }

  onMounted(() => {
    look()
    timer = window.setInterval(look, UPDATE_CHECK_MS)
  })
  onUnmounted(() => window.clearInterval(timer))
}
