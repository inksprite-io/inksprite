/**
 * @module composables/useLibraryMove
 * @description In the desktop app, moving the projects the app kept before
 * it had a folder for them into the folder. The page is shut while they go,
 * with a toast that says how far they are (`LibraryMoveToast`), and the app
 * opens again on them once they are there.
 */

import { reactive, readonly } from 'vue'
import { moveIntoLibrary } from '@/storage/open.js'
import { useEditor } from '@/composables/useEditor.js'
import { useSyncStore } from '@/stores/syncStore.js'

/** @typedef {import('@/storage/open.js').MoveProgress} MoveProgress */

const state = reactive({
  /** Whether the projects are moving into the folder. */
  moving: false,
  /** @type {MoveProgress|null} How far they are */
  progress: null,
})

/**
 * Call from a component's setup. A move that fails is tried again the next
 * time the app opens, and needs nothing from the writer.
 */
export function useLibraryMove() {
  /**
   * Save everything still on its way, move the projects into the folder,
   * and open the app again on them there.
   *
   * @returns {Promise<boolean>} Whether it got as far as opening again
   */
  const moveIn = async () => {
    state.moving = true
    state.progress = null
    try {
      // The app opens again on the projects in the folder, and anything
      // unsaved would be in neither.
      useEditor().flush()
      await useSyncStore().processSync()
      await moveIntoLibrary(progress => {
        state.progress = progress
      })
    } catch (error) {
      state.moving = false
      console.warn(
        'The projects could not be moved into their folder. The next start tries again.',
        error
      )
      return false
    }
    window.location.reload()
    return true
  }

  return { state: readonly(state), moveIn }
}
