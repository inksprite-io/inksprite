/**
 * @module source/text
 * @description Whether a file's bytes are text, and the text if they are.
 */

/** How far into a file to look for the marks of a binary one. */
const SNIFF_BYTES = 8000

/** Control characters text has in it: tab, the line ends, form feed, escape. */
const TEXT_CONTROLS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b])

/**
 * The encoding a file's first bytes say it is in, or null when they say it is
 * not text: a NUL, or more than one byte in thirty-two that is some other
 * control character. A UTF-16 file says so with its byte-order mark, and is
 * full of NULs besides.
 *
 * @param {Uint8Array} head
 * @returns {'utf-8'|'utf-16le'|'utf-16be'|null}
 */
function encodingOf(head) {
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le'
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be'
  let controls = 0
  for (const byte of head) {
    if (byte === 0) return null
    if ((byte < 0x20 && !TEXT_CONTROLS.has(byte)) || byte === 0x7f) controls++
  }
  return controls * 32 > head.length ? null : 'utf-8'
}

/**
 * The text in a file's bytes, or null when they are not text: binary near the
 * top, or bytes that are not UTF-8 or UTF-16 with its mark. A byte-order mark
 * is dropped and line ends become `\n`, so a file reads the same whichever
 * system wrote it.
 *
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
export function textOf(bytes) {
  const encoding = encodingOf(bytes.subarray(0, SNIFF_BYTES))
  if (!encoding) return null
  let text
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return text.replace(/\r\n?/g, '\n')
}

/**
 * The text in a file, or null when it is not text. Only the top is read to
 * tell, so a large binary file costs nothing to turn away.
 *
 * @param {Blob} blob
 * @returns {Promise<string|null>}
 */
export async function textOfFile(blob) {
  const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer())
  if (!encodingOf(head)) return null
  return textOf(new Uint8Array(await blob.arrayBuffer()))
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
