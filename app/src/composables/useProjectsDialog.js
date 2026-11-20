/**
 * @module composables/useProjectsDialog
 * @description Where Projects…, the table of every project, is opened from
 * anywhere in the writer.
 *
 * The table sits over the writer, so the thing that shows it lives in the
 * writer's frame, as the settings and the card library do. The outline's
 * menu opens it, and in the desktop app the File menu.
 *
 * One state for the app: every caller shares it.
 */

import { ref } from 'vue'

const visible = ref(false)

/**
 * @returns {{
 *   visible: import('vue').Ref<boolean>,
 *   open: () => void,
 * }}
 */
export function useProjectsDialog() {
  const open = () => {
    visible.value = true
  }

  return { visible, open }
}
