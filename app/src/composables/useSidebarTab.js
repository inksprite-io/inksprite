/**
 * @module composables/useSidebarTab
 * @description Where a sidebar list is asked for from anywhere in the writer.
 *
 * The sidebar's lists are picked from the rail on the desktop and from the
 * tabs on a phone, both of which live in the writer's frame. Anything deeper,
 * such as a chat's settings pointing at the voices, asks here, and the frame
 * shows the list the way it would for the rail or the tab.
 *
 * One state for the app: every caller shares the same request.
 */

import { ref } from 'vue'

/** @typedef {import('@/components/writer/layout/layout.js').SidebarTab} SidebarTab */

/**
 * The list the last caller asked for, until the frame has shown it.
 * @type {import('vue').Ref<SidebarTab|null>}
 */
const requested = ref(null)

/**
 * @returns {{
 *   requested: import('vue').Ref<SidebarTab|null>,
 *   show: (tab: SidebarTab) => void,
 *   take: () => SidebarTab|null,
 * }}
 */
export function useSidebarTab() {
  /** @param {SidebarTab} tab */
  const show = tab => {
    requested.value = tab
  }

  /**
   * The list asked for, handed over once.
   * @returns {SidebarTab|null}
   */
  const take = () => {
    const tab = requested.value
    requested.value = null
    return tab
  }

  return { requested, show, take }
}
