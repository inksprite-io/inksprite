/**
 * @module composables/useEditorRequest
 * @description Where the editor is asked for from anywhere in the writer.
 *
 * The editor is a panel on the desktop and a tab on a phone, both of which
 * the writer's frame lays out. Anything deeper that opens a tab in it, such
 * as a chat's settings opening its system prompt, asks here, and the frame
 * shows the editor the way the rail or the tab would.
 *
 * One state for the app: every caller shares the same request.
 */

import { ref } from 'vue'

/** Whether the editor has been asked for since the frame last showed it. */
const requested = ref(false)

/**
 * @returns {{
 *   requested: import('vue').Ref<boolean>,
 *   show: () => void,
 *   take: () => boolean,
 * }}
 */
export function useEditorRequest() {
  const show = () => {
    requested.value = true
  }

  /**
   * Whether the editor was asked for, handed over once.
   * @returns {boolean}
   */
  const take = () => {
    const asked = requested.value
    requested.value = false
    return asked
  }

  return { requested, show, take }
}
