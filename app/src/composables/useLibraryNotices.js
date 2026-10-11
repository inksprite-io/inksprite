/**
 * @module composables/useLibraryNotices
 * @description In the desktop app, a word when a file it saved over had been
 * changed somewhere else, and where that version went.
 */

import { onUnmounted } from 'vue'
import { onChangedElsewhere } from '@/storage/open.js'
import { useToast } from './useToast.js'

/**
 * Say so each time the library put a file changed elsewhere in the trash
 * before writing the app's version. Called once, by the app, in its setup;
 * nothing is said in a browser, where there is no library.
 */
export function useLibraryNotices() {
  const toast = useToast()
  const stop = onChangedElsewhere(changed => {
    for (const { title } of changed) {
      // Until closed: it says where the writer's other version is.
      toast.showToast({
        type: 'warn',
        message: `“${title}” was changed outside inksprite. That version is in the Trash.`,
        duration: 0,
      })
    }
  })
  onUnmounted(stop)
}
