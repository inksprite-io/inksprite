/**
 * @module composables/useLibraryMove
 * @description In the desktop app, moving the projects into the folder they
 * are kept in, or back into the app. The page is shut while they go, with a
 * toast that says how far they are (`LibraryMoveToast`), and the app opens
 * again on them once they are there.
 */

import { reactive, readonly } from 'vue'
import { keepProjectsInApp, moveIntoLibrary } from '@/storage/open.js'
import { storage } from '@/storage/index.js'
import { useEditor } from '@/composables/useEditor.js'
import { useSyncStore } from '@/stores/syncStore.js'
import { useToast } from '@/composables/useToast.js'

/** @typedef {import('@/storage/open.js').MoveProgress} MoveProgress */

const state = reactive({
  /** @type {'in'|'out'|null} Which way the projects are going, while they are */
  moving: null,
  /** @type {MoveProgress|null} How far they are, going into the folder */
  progress: null,
})

/**
 * Call from a component's setup: a move that fails is told in a toast.
 */
export function useLibraryMove() {
  const toast = useToast()

  /**
   * Save everything still on its way, do the move, and open the app again
   * on the projects where they went.
   *
   * @param {'in'|'out'} direction
   * @param {() => Promise<void>} work
   * @param {string} failed - What could not be done, should it fail
   * @returns {Promise<boolean>} Whether it got as far as opening again
   */
  const move = async (direction, work, failed) => {
    state.moving = direction
    state.progress = null
    try {
      // The app opens again on the projects where they are moved to, and
      // anything unsaved would be in neither.
      useEditor().flush()
      await useSyncStore().processSync()
      await work()
    } catch (error) {
      state.moving = null
      toast.error(`${failed}: ${/** @type {Error} */ (error).message}`)
      return false
    }
    window.location.reload()
    return true
  }

  /** Move the projects into the folder, and keep them there from now on. */
  const moveIn = () =>
    move(
      'in',
      () =>
        moveIntoLibrary(progress => {
          state.progress = progress
        }),
      "The projects couldn't be moved into a folder"
    )

  /** Move the projects back into the app, and keep them there from now on. */
  const moveOut = () =>
    move(
      'out',
      () => keepProjectsInApp(storage),
      "The projects couldn't be moved back into the app"
    )

  return { state: readonly(state), moveIn, moveOut }
}
