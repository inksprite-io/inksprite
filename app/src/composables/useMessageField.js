import { ref, watch, onBeforeUnmount } from 'vue'

/**
 * @module composables/useMessageField
 * @description Keep the chat's message field fitted to the draft it holds.
 */

/**
 * Whether the draft fits on the one line its buttons leave beside it.
 *
 * Measured by laying the row out that way for a moment — nothing wrapping,
 * the field at the width beside the buttons and at its one-row height — and
 * asking whether the draft overflows it. It is measured at that width however
 * the row is laid out at the time, because that is the only width the answer
 * is stable at: a draft that just fills one line on its own would fit beside
 * the buttons on two, and measured where it was it would say something
 * different every frame.
 *
 * Heights are whole pixels and a line of text need not be, so one line can
 * measure a pixel over its own box. Another line is a lot more than that.
 *
 * @param {HTMLElement} row - The flex row the field shares with its buttons
 * @param {HTMLElement} field - The textarea
 * @returns {boolean}
 */
function fitsBeside(row, field) {
  row.style.flexWrap = 'nowrap'
  field.style.flexBasis = '0'
  field.style.height = 'auto'
  const fits = field.scrollHeight - field.clientHeight <= 1
  row.style.flexWrap = ''
  field.style.flexBasis = ''
  return fits
}

/**
 * Keep a message field fitted to its draft: as tall as the draft needs, up to
 * the cap its class sets, and beside its buttons only while the draft fits
 * there on one line. Past that the field takes the whole row and the buttons
 * drop under it, so a paragraph is not written in the column a row of buttons
 * leaves.
 *
 * The field is borderless, and sized here rather than by auto-resize: both
 * follow from scrollHeight leaving borders out. A bordered field is set two
 * pixels short of its own content and sits permanently scrolled; a borderless
 * one is set exactly, which is the one case auto-resize can never shrink again.
 *
 * @param {import('vue').Ref<HTMLElement|null>} field - The textarea
 * @param {import('vue').Ref<HTMLElement|null>} row - The flex row it shares with its buttons
 * @param {import('vue').Ref<string>} draft - What it holds
 * @returns {{ beside: import('vue').Ref<boolean> }} Whether the buttons sit beside it
 */
export function useMessageField(field, row, draft) {
  const beside = ref(true)

  /**
   * Size the field to the draft, past the cap of which the rest of the draft
   * is behind a scrollbar.
   */
  const fit = () => {
    const el = field.value
    // A field that isn't laid out measures zero, and collapsing it to nothing
    // is worse than leaving it alone until the panel shows it again.
    if (!el?.offsetParent || !row.value) return
    beside.value = fitsBeside(row.value, el)
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  // Typing is only one of the ways the draft changes: sending clears it and a
  // failed command puts it back, and the field should fit either. Post-flush
  // so the text is in the DOM by the time it is measured.
  watch(draft, fit, { flush: 'post' })

  // The other half is the field's own size. A narrower panel rewraps the
  // draft, the buttons dropping under the field widen it, and settings takes
  // the whole field away and builds a new one on the way back, so the observer
  // follows the element rather than the component. Its first callback is what
  // sizes a field to the draft already waiting in it, and comes at once.
  //
  // The rest come from the panel changing size, which while its edge is being
  // dragged is every frame — and fitting the field means laying the page out,
  // twice, and a long chat is a lot of page. Fitting on every frame is what
  // made a drag stutter beside a chat of any length. So those wait for the
  // resizing to settle, the draft's wrapping a moment behind the panel while
  // it moves.
  /** @type {ReturnType<typeof setTimeout>|null} */
  let settling = null
  let seen = false
  const resize = new ResizeObserver(() => {
    if (!seen) {
      seen = true
      requestAnimationFrame(fit)
      return
    }
    if (settling) clearTimeout(settling)
    settling = setTimeout(fit, 100)
  })
  watch(field, el => {
    resize.disconnect()
    seen = false
    if (el) resize.observe(el)
  })
  onBeforeUnmount(() => {
    resize.disconnect()
    if (settling) clearTimeout(settling)
  })

  return { beside }
}
