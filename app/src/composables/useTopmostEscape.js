/**
 * @module composables/useTopmostEscape
 * @description Escape closes the dialog on top, and only that one.
 *
 * Every PrimeVue dialog listens for Escape on the document and closes itself
 * when it hears one, so a dialog opened over another — the provider
 * configuration over the settings, a confirmation over either — takes the
 * one beneath it down too. A dialog that uses this instead of its own
 * listener closes only when it is the topmost dialog on the page.
 */

import { onBeforeUnmount, watch } from 'vue'

/** Every dialog mask on the page, in the order they were opened. */
const MASK_SELECTOR = '.p-dialog-mask'

/**
 * Whether the mask given is the last one on the page: nothing has been
 * opened over it.
 * @param {Element|null|undefined} mask
 * @returns {boolean}
 */
export function isTopmostMask(mask) {
  if (!mask) return false
  const masks = document.querySelectorAll(MASK_SELECTOR)
  return masks[masks.length - 1] === mask
}

/**
 * Close a dialog on Escape, but only while nothing is open over it.
 *
 * The dialog should be given `:close-on-escape="false"`, so that this is the
 * one listener deciding. `mask` finds the dialog's own mask when asked, once
 * the dialog is showing.
 *
 * @param {import('vue').Ref<boolean>} visible - Whether the dialog is showing
 * @param {() => Element|null|undefined} mask - The dialog's own mask element
 * @param {() => void} close
 */
export function useTopmostEscape(visible, mask, close) {
  /** @param {KeyboardEvent} event */
  const onKeyDown = event => {
    if (event.key !== 'Escape' || !visible.value) return
    if (isTopmostMask(mask())) close()
  }

  const bind = () => document.addEventListener('keydown', onKeyDown)
  const unbind = () => document.removeEventListener('keydown', onKeyDown)

  watch(visible, showing => (showing ? bind() : unbind()), { immediate: true })
  onBeforeUnmount(unbind)
}
