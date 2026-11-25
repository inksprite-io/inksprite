/**
 * @module utils/unzip
 * @description A zip opened whole, with a ceiling on what it opens into.
 *
 * A few kilobytes of zip can say they hold gigabytes, and inflating them is
 * the end of the page. Each entry says in the zip's directory how large it
 * is unpacked, and fflate inflates no more of an entry than that, so the
 * sizes the entries taken declare are the most memory opening them can
 * cost: past the reader's ceiling, nothing is inflated at all.
 *
 * What a zip says of itself is checked against its length besides, since
 * fflate goes by it: a directory can claim more entries than the file could
 * hold, which would be walked one by one for minutes, or entries whose
 * compressed parts overlap, each inflated in turn. And an entry named
 * `__proto__` is never taken: fflate keeps entries on a plain object, where
 * that name would make the entry's bytes the object's prototype.
 */

import { unzipSync } from 'fflate'

/** The least an entry takes in a zip's central directory, in bytes. */
const DIRECTORY_ENTRY = 46

/** One mebibyte, for a reader to say its ceiling in. */
export const MIB = 1024 * 1024

/** A zip that would open into more than its reader takes. */
export class TooLargeError extends Error {
  constructor() {
    super('It is too large to open.')
    this.name = 'TooLargeError'
  }
}

/**
 * The entries of a zip that a filter lets in, inflated, unless together they
 * would come to more than `most` bytes.
 *
 * @param {Uint8Array} bytes
 * @param {number} most - Bytes, unpacked
 * @param {(entry: import('fflate').UnzipFileInfo) => boolean} [filter] - Which
 *   entries to take; every one when absent
 * @returns {import('fflate').Unzipped} By path
 * @throws {TooLargeError}
 * @throws {Error} For a zip that says more of itself than its bytes could hold
 */
export function unzipWithin(bytes, most, filter = () => true) {
  let total = 0
  let entries = 0
  let packed = 0
  return unzipSync(bytes, {
    filter: entry => {
      // An entry takes at least this much of the file, in its directory alone.
      entries += 1
      packed += entry.size
      if (entries * DIRECTORY_ENTRY > bytes.length || packed > bytes.length) {
        throw new Error('It isn’t a zip that can be opened.')
      }
      if (entry.name === '__proto__' || !filter(entry)) return false
      // A stored entry is copied by its size in the file, whatever it says
      // it unpacks to.
      total += Math.max(entry.originalSize, entry.size)
      if (total > most) throw new TooLargeError()
      return true
    },
  })
}

/**
 * What a zip says it opens into, in bytes, read from its directory alone,
 * inflating nothing: for a reader that opens it another way to refuse one
 * that says it is too large first. One that understates is not caught.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 * @throws {Error} When it isn't a zip, or says more of itself than its bytes
 *   could hold
 */
export function unzippedSize(bytes) {
  let total = 0
  let entries = 0
  let packed = 0
  unzipSync(bytes, {
    filter: entry => {
      entries += 1
      packed += entry.size
      if (entries * DIRECTORY_ENTRY > bytes.length || packed > bytes.length) {
        throw new Error('It isn’t a zip that can be opened.')
      }
      total += Math.max(entry.originalSize, entry.size)
      return false
    },
  })
  return total
}
