/**
 * @module composables/useCardLibraryPanel
 * @description Where the card library is opened from anywhere in the writer.
 *
 * The library is app-wide and sits over the writer, so the thing that shows
 * it lives in the writer's frame. The rail opens it to browse; a folder's
 * Import › Character card… opens it to pick a card for that folder.
 *
 * One state for the app: every caller shares it.
 */

import { ref } from 'vue'

const visible = ref(false)

/**
 * The folder a card is being picked for, or null when the library was opened
 * to browse.
 * @type {import('vue').Ref<string|null>}
 */
const into = ref(null)

/**
 * @returns {{
 *   visible: import('vue').Ref<boolean>,
 *   into: import('vue').Ref<string|null>,
 *   open: (options?: {into?: string|null}) => void,
 *   close: () => void,
 * }}
 */
export function useCardLibraryPanel() {
  /**
   * Show the library, picking for a folder when one is named.
   * @param {{into?: string|null}} [options]
   */
  const open = ({ into: folderId = null } = {}) => {
    into.value = folderId
    visible.value = true
  }

  const close = () => {
    visible.value = false
    into.value = null
  }

  return { visible, into, open, close }
}
