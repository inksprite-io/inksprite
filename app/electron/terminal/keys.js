/**
 * The keys the terminal doesn't hand its shell as they are.
 *
 * Everything typed goes to the shell, Control with it on every system: it is
 * the shell's interrupt, its end of input, its search. What is taken out is
 * what a terminal is expected to do itself: copying and pasting, clearing,
 * and a new line in a program that sends on Enter. On a Mac the app's own
 * shortcuts are on Command, which the shell never sees, so those are handed
 * back to the page. So is Control-`, with Shift or without, on every system:
 * the terminal's own key, as an editor of code has it, for going to a
 * terminal or making one. The page alone takes it: a Mac's menu shows it
 * too, and would do it again.
 */

/**
 * What Shift-Enter types: Escape and Enter, which a program that reads a
 * line at a time takes for a line break within it.
 */
export const LINE_BREAK = '\x1b\r'

/**
 * @typedef {'lineBreak'|'copy'|'paste'|'selectAll'|'clear'|'browser'|'page'|'pageAlone'} KeyAction
 * - `lineBreak`: type {@link LINE_BREAK}
 * - `copy`, `paste`, `selectAll`, `clear`: done by the frame
 * - `browser`: left to the window, whose Edit menu copies and pastes
 * - `page`: one of the app's shortcuts, handed to its page, and left to the
 *   window's menu, which has the app's keys for tabs
 * - `pageAlone`: one of the app's shortcuts handed to its page, and kept
 *   from the window's menu
 */

/**
 * @typedef {Object} PressedKey
 * @property {string} key
 * @property {string} [code]
 * @property {boolean} metaKey
 * @property {boolean} ctrlKey
 * @property {boolean} shiftKey
 * @property {boolean} altKey
 */

/**
 * Whether a key is the terminal's own, Control-` with Shift or without: the
 * key left of 1 by where it is, or by what it types where the keyboard has
 * it elsewhere. The page reads it the same (`terminalKey` in
 * `src/platform/terminal.js`), and a test holds the two to each other.
 *
 * @param {PressedKey} event
 * @returns {boolean}
 */
export const isTerminalKey = ({ key, code, metaKey, ctrlKey, altKey }) =>
  ctrlKey && !metaKey && !altKey && (code === 'Backquote' || key === '`' || key === '~')

/**
 * What a key pressed in the terminal does other than go to the shell, or
 * null when it goes there.
 *
 * @param {PressedKey} event
 * @param {boolean} mac
 * @returns {KeyAction|null}
 */
export function keyAction(event, mac) {
  const key = event.key?.toLowerCase()
  const { metaKey, ctrlKey, shiftKey, altKey } = event
  if (key === 'enter' && shiftKey && !metaKey && !ctrlKey && !altKey) return 'lineBreak'
  if (isTerminalKey(event)) return 'pageAlone'
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
