/**
 * @module composables/useTopmostEscape
 * @description Escape closes the dialog on top, and only that one.
 *
 * Every PrimeVue dialog listens for Escape on the document and closes itself
 * when it hears one, so a dialog opened over another — the provider
 * configuration over the settings, a confirmation over either — takes the
 * one beneath it down too. A dialog that uses this instead of its own
 * listener closes only when it is the topmost dialog on the page, and only
 * for an Escape pressed inside it.
 *
 * The second half is for what opens over a dialog without a mask of its own:
 * a ⋮ menu, a popover, a select's list. PrimeVue puts those on the body,
 * outside the dialog, and they close themselves on the Escape pressed in
 * them before it reaches the document — so by the time it does, they are no
 * longer open to be asked about. Where the key was pressed still says whose
 * it was.
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
 * Escapes pressed on a control whose popup was open — a select's list, a date
 * picker — noted on their way down, before the control shuts it. By the time
 * the key is back up at the document the popup is gone and the control says
 * so; and a select marks every Escape handled, open or not, so that says
 * nothing either.
 * @type {WeakSet<Event>}
 */
const closingPopup = new WeakSet()

/** @param {KeyboardEvent} event */
const notePopup = event => {
  // The page itself, with nothing focused, is a target with no attributes.
  const target = /** @type {Element|null} */ (event.target)
  if (
    event.key === 'Escape' &&
    target?.getAttribute?.('aria-expanded') === 'true' &&
    target.hasAttribute('aria-haspopup')
  ) {
    closingPopup.add(event)
  }
}

if (typeof document !== 'undefined') document.addEventListener('keydown', notePopup, true)

/**
 * Whether the key was pressed on a control with a popup that is shut: a
 * select showing its value. A select stops every Escape pressed on it, its
 * list open or not, so one pressed on a shut one never comes back up to the
 * document, and the dialog takes it on its way down instead.
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
const onShutPopup = event => {
  const target = /** @type {Element|null} */ (event.target)
  return target?.getAttribute?.('aria-expanded') === 'false' && target.hasAttribute('aria-haspopup')
}

/**
 * Whether an Escape was pressed in the dialog behind this mask, rather than
 * in something opened over it: a popup on a control of its own, or a menu on
 * the body. Nothing focused at all — the page itself, after a click on plain
 * text — counts as the dialog's.
 *
 * A field inside the dialog with a use of its own for Escape, such as a name
 * being edited, stops it going further.
 *
 * @param {KeyboardEvent} event
 * @param {Element} mask
 * @returns {boolean}
 */
export function isEscapeFor(event, mask) {
  if (closingPopup.has(event)) return false
  const target = /** @type {Node|null} */ (event.target)
  if (!target || target === document.body || target === document.documentElement) return true
  if (target === document) return true
  return mask.contains(target)
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
  const closeFor = event => {
    if (event.key !== 'Escape' || !visible.value) return
    const own = mask()
    if (own && isTopmostMask(own) && isEscapeFor(event, own)) close()
  }

  /** @param {KeyboardEvent} event */
  const onKeyDown = event => {
    if (!onShutPopup(event)) closeFor(event)
  }

  /** @param {KeyboardEvent} event */
  const onKeyDownFirst = event => {
    if (onShutPopup(event)) closeFor(event)
  }

  const bind = () => {
    document.addEventListener('keydown', onKeyDownFirst, true)
    document.addEventListener('keydown', onKeyDown)
  }
  const unbind = () => {
    document.removeEventListener('keydown', onKeyDownFirst, true)
    document.removeEventListener('keydown', onKeyDown)
  }

  watch(visible, showing => (showing ? bind() : unbind()), { immediate: true })
  onBeforeUnmount(unbind)
}
