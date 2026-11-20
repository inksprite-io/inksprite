/* global Blob, TextEncoder */
/**
 * @module utils/tarWriter
 * @description A tar written a piece at a time, as `utils/zipWriter.js`
 * writes a zip: an export handed to another app (`apps/exports.js`), which
 * unpacks it as it arrives with `tar`, there on systems that have no
 * `unzip`.
 *
 * It is POSIX's format (ustar), not compressed. A name too long for a
 * header's hundred bytes, or not plain ASCII, is given in full in a pax
 * record before its entry, which GNU tar and bsdtar both read. A file's
 * bytes go in as the Blob they are, unread.
 */

/** A tar is made of blocks this long. */
const BLOCK = 512

/** The most a header's name holds. */
const NAME_MOST = 100

/** The most a header's size can say: eleven octal digits. */
const SIZE_MOST = 0o77777777777

const encoder = new TextEncoder()

/**
 * @typedef {Object} TarWriter
 * @property {(name: string, text: string) => void} addText
 * @property {(name: string, blob: Blob) => void} addBlob
 * @property {(name: string) => void} addFolder - A directory, for one with
 *   nothing else in it to be there when the tar is unpacked
 * @property {() => Blob} end - The tar, once everything is in it
 */

/**
 * Whether a name goes in a header as it is.
 * @param {string} name
 */
const plain = name => name.length <= NAME_MOST && /^[\x20-\x7e]*$/.test(name)

/**
 * A header: one block saying what follows.
 *
 * @param {string} name - Plain ASCII, a hundred characters at most
 * @param {number} size - How many bytes follow
 * @param {'0'|'5'|'x'} type - A file, a directory, or pax records
 * @param {number} at - When, in seconds
 * @returns {Uint8Array<ArrayBuffer>}
 */
function header(name, size, type, at) {
  const block = new Uint8Array(BLOCK)
  /**
   * @param {string} text
   * @param {number} offset
   */
  const put = (text, offset) => block.set(encoder.encode(text), offset)
  /**
   * A number as a field holds it: octal, then a NUL.
   * @param {number} value
   * @param {number} offset
   * @param {number} length - The field's, its NUL included
   */
  const octal = (value, offset, length) => put(value.toString(8).padStart(length - 1, '0'), offset)

  put(name, 0)
  octal(type === '5' ? 0o755 : 0o644, 100, 8)
  octal(0, 108, 8)
  octal(0, 116, 8)
  octal(size, 124, 12)
  octal(at, 136, 12)
  put(type, 156)
  put('ustar', 257)
  put('00', 263)
  // The sum of the block's bytes, its own field read as spaces: six octal
  // digits, a NUL and a space.
  block.fill(0x20, 148, 156)
  const sum = block.reduce((total, byte) => total + byte, 0)
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

/**
 * A pax record: its own length, a key and a value.
 *
 * @param {string} key
 * @param {string} value
 * @returns {Uint8Array<ArrayBuffer>}
 */
function record(key, value) {
  const rest = encoder.encode(` ${key}=${value}\n`)
  // The length counts its own digits.
  let length = rest.length + String(rest.length).length
  if (String(length).length + rest.length !== length) length = String(length).length + rest.length
  const out = new Uint8Array(length)
  out.set(encoder.encode(String(length)))
  out.set(rest, length - rest.length)
  return out
}

/**
 * What fills the last block of something `size` bytes long.
 * @param {number} size
 */
const padding = size => new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK)

/**
 * Start a tar.
 *
 * @param {number} [at] - The time its entries carry, in seconds: now
 * @returns {TarWriter}
 */
export function tarWriter(at = Math.floor(Date.now() / 1000)) {
  /** @type {BlobPart[]} */
  const parts = []
  let ordinal = 0

  /**
   * Say what comes next.
   *
   * @param {string} name - A path below wherever the tar is unpacked
   * @param {number} size
   * @param {'0'|'5'} type
   * @throws {Error} For a name that would be unpacked anywhere else, or a
   *   file larger than a tar says the size of
   */
  const begin = (name, size, type) => {
    const steps = name.split('/')
    if (!name || name.startsWith('/') || steps.includes('..')) {
      throw new Error(`Not a path inside an archive: ${name}`)
    }
    if (size > SIZE_MOST)
      throw new Error('This is more than a tar file can hold: 8 GB in one file.')
    if (plain(name)) {
      parts.push(header(name, size, type, at))
      return
    }
    // Its name in full, in records of its own; the header after them has a
    // stand-in, for a reader that knows nothing of pax.
    const records = record('path', name)
    const fallback = `${++ordinal}-${name.replace(/[^\x20-\x7e]/g, '_')}`.slice(0, NAME_MOST - 1)
    parts.push(
      header(`PaxHeader/${ordinal}`, records.length, 'x', at),
      records,
      padding(records.length),
      header(type === '5' ? `${fallback}/` : fallback, size, type, at)
    )
  }

  return {
    addFolder(name) {
      begin(name.endsWith('/') ? name : `${name}/`, 0, '5')
    },
    addText(name, text) {
      const bytes = encoder.encode(text)
      begin(name, bytes.length, '0')
      parts.push(bytes, padding(bytes.length))
    },
    addBlob(name, blob) {
      begin(name, blob.size, '0')
      parts.push(blob, padding(blob.size))
    },
    end() {
      // Two empty blocks end it.
      parts.push(new Uint8Array(BLOCK * 2))
      return new Blob(parts, { type: 'application/x-tar' })
    },
  }
}
