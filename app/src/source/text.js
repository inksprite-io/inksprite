/**
 * @module source/text
 * @description Whether a file's bytes are text, and the text if they are.
 */

/** How far into a file to look for a NUL, the mark of a binary file. */
const SNIFF_BYTES = 8000

/**
 * The text in a file's bytes, or null when they are not text: a NUL near the
 * top, or bytes that are not UTF-8. A byte-order mark is dropped and line
 * ends become `\n`, so a file reads the same whichever system wrote it.
 *
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
export function textOf(bytes) {
  const sniff = Math.min(bytes.length, SNIFF_BYTES)
  for (let i = 0; i < sniff; i++) if (bytes[i] === 0) return null
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
  return text.replace(/\r\n?/g, '\n')
}

/**
 * How many lines a text has. A last line with no newline after it counts;
 * an empty text has none.
 *
 * @param {string} text
 * @returns {number}
 */
export function lineCount(text) {
  if (!text) return 0
  let lines = 1
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lines++
  return text.endsWith('\n') ? lines - 1 : lines
}
