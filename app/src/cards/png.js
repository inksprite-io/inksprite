/* global atob */
/**
 * @module cards/png
 * @description The card hidden in a PNG.
 *
 * A character card is an image with its JSON base64-encoded into a text chunk
 * beside the pixels, so that one file is both the portrait people browse and
 * the data an app reads. V1 and V2 put it under the keyword `chara`, V3 under
 * `ccv3`, and a V3 file usually carries both so that older apps still find
 * something — so `ccv3` wins when they disagree.
 *
 * Walking the chunks by hand rather than with a PNG library: a chunk is a
 * length, a four-byte name, the bytes, and a checksum, and that is the whole of
 * what this needs. The pixels are never decoded.
 */

/** Every PNG opens with these eight bytes. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Where a card can be, best first. */
const KEYWORDS = ['ccv3', 'chara']

/**
 * The text chunks in a PNG, by keyword.
 *
 * `tEXt` is Latin-1 and `iTXt` is UTF-8 with a compression flag and language
 * tags in front of the value; both are used in the wild for this. A compressed
 * `iTXt` is skipped rather than inflated — no card writer produces one, and
 * carrying an inflate for a case nobody has met is a cost with no reader.
 *
 * @param {ArrayBuffer|Uint8Array} data - The file
 * @returns {Map<string, string>} Keyword to its text
 */
export function textChunks(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  /** @type {Map<string, string>} */
  const chunks = new Map()

  if (bytes.length < 8 || SIGNATURE.some((byte, at) => bytes[at] !== byte)) {
    throw new Error('That is not a PNG.')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // 8 past the signature, then length + name + body + checksum each time round.
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at)
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    at += 12 + length

    if (name === 'IEND') break
    if (name !== 'tEXt' && name !== 'iTXt') continue

    const split = body.indexOf(0)
    if (split < 0) continue
    const keyword = String.fromCharCode(...body.subarray(0, split))
    if (chunks.has(keyword)) continue

    if (name === 'tEXt') {
      chunks.set(keyword, latin1(body.subarray(split + 1)))
      continue
    }

    // iTXt: keyword \0 compressed \0 method, language \0 translated \0 text
    const rest = body.subarray(split + 1)
    if (rest[0] !== 0) continue
    let from = 2
    for (let skipped = 0; skipped < 2 && from < rest.length; from++) {
      if (rest[from] === 0) skipped++
    }
    chunks.set(keyword, new TextDecoder().decode(rest.subarray(from)))
  }

  return chunks
}

/**
 * The card in a PNG, still in whatever spec version it was written for.
 *
 * @param {ArrayBuffer|Uint8Array} data - The file
 * @returns {any|null} The parsed card, or null if the image carries none
 */
export function cardFromPng(data) {
  const chunks = textChunks(data)

  for (const keyword of KEYWORDS) {
    const value = chunks.get(keyword)
    if (!value) continue
    try {
      return JSON.parse(decodeBase64(value))
    } catch {
      // A chunk under the right keyword that does not parse is a damaged card,
      // not an image that has none — but a V3 file carrying a broken `ccv3`
      // beside a good `chara` should still import, so try the next keyword.
      continue
    }
  }

  return null
}

/**
 * Base64 to a string, as UTF-8.
 *
 * `atob` gives one byte per character, which is Latin-1 — and card text is
 * full of em dashes and smart quotes that would arrive as mojibake. The bytes
 * go back through a UTF-8 decoder to come out as what was written.
 *
 * @param {string} value
 * @returns {string}
 */
function decodeBase64(value) {
  const binary = atob(value.trim())
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Bytes as Latin-1, a slice at a time.
 *
 * Spreading the array into `fromCharCode` is the obvious way and overflows the
 * stack: a card's base64 runs to hundreds of kilobytes once its lorebook is in
 * it, and that many arguments is past what an engine will take. The limit is
 * on the call, not on the string, so slices of it cost nothing.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function latin1(bytes) {
  const SLICE = 8192
  let out = ''
  for (let at = 0; at < bytes.length; at += SLICE) {
    out += String.fromCharCode(...bytes.subarray(at, at + SLICE))
  }
  return out
}
