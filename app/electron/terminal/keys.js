/**
 * The keys the terminal doesn't hand its shell as they are.
 *
 * Everything typed goes to the shell, Control with it on every system: it is
 * the shell's interrupt, its end of input, its search. What is taken out is
 * what a terminal is expected to do itself: copying and pasting, clearing,
 * and a new line in a program that sends on Enter. On a Mac the app's own
 * shortcuts are on Command, which the shell never sees, so those are handed
 * back to the page.
 */

/**
 * What Shift-Enter types: Escape and Enter, which a program that reads a
 * line at a time takes for a line break within it.
 */
export const LINE_BREAK = '\x1b\r'

/**
 * @typedef {'lineBreak'|'copy'|'paste'|'selectAll'|'clear'|'browser'|'page'} KeyAction
 * - `lineBreak`: type {@link LINE_BREAK}
 * - `copy`, `paste`, `selectAll`, `clear`: done by the frame
 * - `browser`: left to the window, whose Edit menu copies and pastes
 * - `page`: one of the app's shortcuts, handed to its page
 */

/**
 * What a key pressed in the terminal does other than go to the shell, or
 * null when it goes there.
 *
 * @param {{key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean}} event
 * @param {boolean} mac
 * @returns {KeyAction|null}
 */
export function keyAction(event, mac) {
  const key = event.key?.toLowerCase()
  const { metaKey, ctrlKey, shiftKey, altKey } = event
  if (key === 'enter' && shiftKey && !metaKey && !ctrlKey && !altKey) return 'lineBreak'
  if (mac) {
    if (!metaKey || key === 'meta') return null
    if (!ctrlKey && !altKey && !shiftKey) {
      if (key === 'c' || key === 'v' || key === 'x') return 'browser'
      if (key === 'a') return 'selectAll'
      if (key === 'k') return 'clear'
    }
    return 'page'
  }
  if (ctrlKey && shiftKey && !metaKey && !altKey) {
    if (key === 'c') return 'copy'
    if (key === 'v') return 'paste'
  }
  return null
}
