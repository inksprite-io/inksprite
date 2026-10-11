/**
 * @module utils/touch
 * @description Whether the writer is typing on a touch screen's keyboard.
 *
 * Asked where Enter would send or save: such a keyboard has no Shift-Enter,
 * so Return is its only way to start a new line, and the field's button does
 * the sending. Told by the main pointer being a finger, not by the width of
 * the window, so a phone on its side still counts and a narrow desktop window
 * does not.
 */

/**
 * @returns {boolean}
 */
export function hasTouchKeyboard() {
  return globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
}

/**
 * Send or save on Enter, except from a touch screen's keyboard, where the
 * Enter is left to start a new line.
 *
 * @param {KeyboardEvent} event
 * @param {() => unknown} action - The sending or saving
 */
export function submitOnEnter(event, action) {
  if (hasTouchKeyboard()) return
  event.preventDefault()
  action()
}
