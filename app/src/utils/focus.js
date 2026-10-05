/**
 * @module utils/focus
 * @description Whether the writer is typing somewhere already.
 *
 * A document opening takes the caret, so that the next keystroke goes into
 * it — unless the writer is in the middle of typing somewhere else: naming
 * the document in the tree, asking the chat something, filling in a field.
 * Then the caret stays where it is, and the document waits its turn.
 */

/**
 * Whether the element with the focus is a field the writer types into.
 * @param {Element|null} [element] - Defaults to whatever has the focus
 * @returns {boolean}
 */
export function isTextField(element = document.activeElement) {
  if (!element) return false
  if (element.tagName === 'TEXTAREA') return true
  if (element.tagName === 'INPUT') {
    const type = element.getAttribute('type') || 'text'
    return !['button', 'checkbox', 'radio', 'submit', 'range', 'color', 'file'].includes(type)
  }
  return 'isContentEditable' in element && element.isContentEditable === true
}
