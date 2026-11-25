/**
 * @module utils/unzip
 * @description A zip opened whole, with a ceiling on what it opens into.
 *
 * A few kilobytes of zip can say they hold gigabytes, and inflating them is
 * the end of the page. Each entry says in the zip's directory how large it
 * is unpacked, and fflate inflates no more of an entry than that, so the
 * sizes the entries taken declare are the most memory opening them can
 * cost: past the reader's ceiling, nothing is inflated at all.
 */

import { unzipSync } from 'fflate'

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
 */
export function unzipWithin(bytes, most, filter = () => true) {
  let total = 0
  return unzipSync(bytes, {
    filter: entry => {
      if (!filter(entry)) return false
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
 * too large first.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 * @throws {Error} When it isn't a zip
 */
export function unzippedSize(bytes) {
  let total = 0
  unzipSync(bytes, {
    filter: entry => {
      total += Math.max(entry.originalSize, entry.size)
      return false
    },
  })
  return total
}
