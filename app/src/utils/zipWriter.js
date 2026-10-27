/* global Blob */
/**
 * @module utils/zipWriter
 * @description A zip written a piece at a time, so that neither a file in
 * it nor the whole has to be one string or one buffer: a backup's
 * (`utils/backupArchive.js`) and an export's (`files/exportDocument.js`).
 *
 * Text is compressed. A file's bytes are stored as they are, read from its
 * Blob a slice at a time, since what goes in whole (a PDF, a picture) is
 * mostly compressed already. What is written is gathered into Blobs, which
 * a browser may keep on disk rather than in memory.
 *
 * Without ZIP64, a zip holds at most 4 GB and 65,535 entries; one larger is
 * refused rather than written wrong.
 */

import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate'

/** How much of a file is read at a time as it is written in. */
const SLICE = 4 * 1024 * 1024

/** How much of what is written is gathered before it is let go to a Blob. */
const GATHER = 64 * 1024 * 1024

/** What a zip without ZIP64 can hold. */
const MOST_BYTES = 0xffffffff
const MOST_ENTRIES = 0xffff

/**
 * @typedef {Object} ZipWriter
 * @property {(name: string, text: string) => void} addText - Compressed
 * @property {(name: string, blob: Blob) => Promise<void>} addBlob - Stored as it is
 * @property {(name: string) => void} addFolder - A directory, `name/`, for
 *   one with nothing else in it to be there when the zip is opened
 * @property {() => Blob} end - The zip, once everything is in it
 */

/**
 * Start a zip.
 *
 * @param {string} tooLarge - What the error says when it would hold more
 *   than a zip can
 * @returns {ZipWriter}
 * @throws {Error} From any of its calls, when it would hold more than a zip can
 */
export function zipWriter(tooLarge) {
  /** @type {Blob[]} */
  const written = []
  /** @type {Uint8Array[]} */
  let gathered = []
  let gatheredBytes = 0
  let total = 0
  let entries = 0
  /** @type {Error|null} */
  let failed = null

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failed = error
      return
    }
    gathered.push(chunk)
    gatheredBytes += chunk.length
    total += chunk.length
    if (gatheredBytes >= GATHER || final) {
      written.push(new Blob(/** @type {BlobPart[]} */ (gathered)))
      gathered = []
      gatheredBytes = 0
    }
  })

  /** @param {string} name */
  function counted(name) {
    if (++entries >= MOST_ENTRIES) throw new Error(tooLarge)
    return name
  }

  return {
    addText(name, text) {
      const entry = new ZipDeflate(counted(name), { level: 6 })
      zip.add(entry)
      entry.push(strToU8(text), true)
    },

    async addBlob(name, blob) {
      const entry = new ZipPassThrough(counted(name))
      zip.add(entry)
      if (blob.size === 0) entry.push(new Uint8Array(0), true)
      for (let at = 0; at < blob.size; at += SLICE) {
        const piece = new Uint8Array(await blob.slice(at, at + SLICE).arrayBuffer())
        entry.push(piece, at + SLICE >= blob.size)
        if (total > MOST_BYTES) throw new Error(tooLarge)
      }
    },

    addFolder(name) {
      const entry = new ZipPassThrough(counted(`${name.replace(/\/+$/, '')}/`))
      zip.add(entry)
      entry.push(new Uint8Array(0), true)
    },

    end() {
      zip.end()
      if (failed) throw failed
      if (total > MOST_BYTES) throw new Error(tooLarge)
      return new Blob(written, { type: 'application/zip' })
    },
  }
}
