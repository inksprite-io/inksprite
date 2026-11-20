/**
 * What is pasted into the terminal, before its shell has it.
 *
 * A shell that tells a paste from typing is shown where one starts and ends
 * by a mark either side of it, and runs nothing in it until Enter. The marks
 * are escape sequences, and the emulator puts them round the text as it
 * comes. Text that held the closing mark itself would end the paste early,
 * and what came after it would be typed, each line run as it ended. So
 * nothing pasted reaches the emulator with a control character in it but a
 * tab and the ends of lines: no escape, no other C0, no delete and no C1.
 *
 * A paste comes two ways. Off a Mac the frame has a key for it and reads the
 * clipboard itself (`frame.js`). Everywhere it also comes as the browser's
 * paste event: the Edit menu's Paste, the right-click menu's, and a middle
 * click where the system pastes on one. The emulator listens for that event
 * on what it draws, and `takePastes` hears it first.
 */

/** A control character other than a tab, a newline and a carriage return. */
const CONTROL = /(?![\t\n\r])\p{Cc}/gu

/**
 * Text as it may be pasted: without its control characters, but for tabs and
 * the ends of lines.
 *
 * @param {unknown} text
 * @returns {string}
 */
export const cleanPaste = text => (typeof text === 'string' ? text.replace(CONTROL, '') : '')

/**
 * Take every paste the browser makes in the terminal: it is stopped before
 * the emulator hears of it, and its text is handed on cleaned.
 *
 * @param {{addEventListener: (type: 'paste', listener: (event: any) => void, capture: boolean) => void}} host -
 *   What the emulator is drawn in
 * @param {(text: string) => void} paste - Pastes text into the terminal
 */
export function takePastes(host, paste) {
  host.addEventListener(
    'paste',
    event => {
      event.preventDefault()
      event.stopPropagation()
      const text = cleanPaste(event.clipboardData?.getData('text/plain'))
      if (text) paste(text)
    },
    true
  )
}
