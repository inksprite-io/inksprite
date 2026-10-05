/**
 * @module composables/useJobsToast
 * @description The jobs toast: the one view of the long jobs, open or not.
 *
 * Starting a job opens it; the rail's Jobs button opens and closes it; its
 * own close button closes it. The jobs run on whether it shows or not.
 */

import { reactive } from 'vue'

/** @type {{open: boolean}} */
const state = reactive({ open: false })

export function useJobsToast() {
  return {
    state,
    /** Show the toast; a job was started. */
    show() {
      state.open = true
    },
    /** Show it, or put it away: the rail's Jobs button. */
    toggle() {
      state.open = !state.open
    },
    /** It was closed from its own button. */
    closed() {
      state.open = false
    },
  }
}
