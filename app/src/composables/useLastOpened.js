/**
 * @module composables/useLastOpened
 * @description Keeps which project the writer was last in, which is the one
 * the app opens on at its root (`projectViewsStore.lastOpened`): when a
 * project opens in this window, and when this window comes forward with one
 * open, so that of two windows it is the one used last.
 */

import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useProjectViewsStore } from '@/stores/projectViewsStore.js'

/**
 * @param {() => string} storyId - The project open in this window, or '' with none
 */
export function useLastOpened(storyId) {
  const views = useProjectViewsStore()

  const mark = () => {
    const open = storyId()
    if (open) views.markOpened(open)
  }

  watch(storyId, mark)
  onMounted(() => window.addEventListener('focus', mark))
  onBeforeUnmount(() => window.removeEventListener('focus', mark))
}
