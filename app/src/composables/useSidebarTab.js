/**
 * @module composables/useSidebarTab
 * @description Where a sidebar list is asked for from anywhere in the writer.
 *
 * The sidebar's lists are picked from the rail on the desktop and from the
 * tabs on a phone, both of which live in the writer's frame. Anything deeper,
 * such as a chat's settings pointing at the voices, asks here, and the frame
 * shows the list the way it would for the rail or the tab. A list asked for
 * with `open: false` is shown only where the sidebar already is: a closed
 * sidebar stays closed, and a phone stays on the tab it is on.
 *
 * One state for the app: every caller shares the same request.
 */

import { ref } from 'vue'

/** @typedef {import('@/components/writer/layout/layout.js').SidebarTab} SidebarTab */

/**
 * A list asked for, and whether the sidebar opens for it.
 *
 * @typedef {{tab: SidebarTab, open: boolean}} SidebarRequest
 */

/**
 * The list the last caller asked for, until the frame has shown it.
 * @type {import('vue').Ref<SidebarRequest|null>}
 */
const requested = ref(null)

/**
 * @returns {{
 *   requested: import('vue').Ref<SidebarRequest|null>,
 *   show: (tab: SidebarTab, options?: {open?: boolean}) => void,
 *   take: () => SidebarRequest|null,
 * }}
 */
export function useSidebarTab() {
  /**
   * @param {SidebarTab} tab
   * @param {{open?: boolean}} [options] - `open: false` leaves a closed sidebar closed
   */
  const show = (tab, { open = true } = {}) => {
    requested.value = { tab, open }
  }

  /**
   * The list asked for, handed over once.
   * @returns {SidebarRequest|null}
   */
  const take = () => {
    const request = requested.value
    requested.value = null
    return request
  }

  return { requested, show, take }
}
