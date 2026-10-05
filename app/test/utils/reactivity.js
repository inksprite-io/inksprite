/**
 * Utilities for testing Vue reactivity
 */

import { nextTick, isRef, isReactive, isProxy } from 'vue'
import { flushPromises } from '@vue/test-utils'

/**
 * Wait for Vue reactivity to complete
 * @returns {Promise<void>}
 */
export async function waitForReactivity() {
  await nextTick()
  await flushPromises()
}

/**
 * Check if a value is reactive (ref, reactive, or proxy)
 * @param {*} value - Value to check
 * @returns {boolean}
 */
export function isReactiveValue(value) {
  return isRef(value) || isReactive(value) || isProxy(value)
}
