/* global Blob */
/**
 * @module utils/backupArchive
 * @description A backup as a zip, for anything that can hold files: a
 * whole backup, a selection, a project.
 *
 * A backup used to be one JSON file, files' bytes in it as base64. A string
 * in a browser can't be longer than about 512 MB, so past that the backup
 * could neither be written nor read back, and base64 made every file a third
 * larger on the way. In a zip, each file's bytes are an entry of their own,
 * stored as they are; the rows are JSON, a table in one entry or several,
 * compressed; and `backup.json` is the envelope a JSON backup has, its
 * `tables` naming the entries that hold each table's rows. A file's row
 * names the entry holding its bytes (`entry`) where a JSON backup has them
 * as `data`.
 *
 * Read back, an archive is the same envelope as a JSON backup, but for the
 * rows that carry bytes: those hold a Blob (`blob`), cut from the file
 * picked without reading it. The zip is read from its central directory, so
 * nothing in a file's bytes can be taken for where an entry ends.
 *
 * Without ZIP64, an archive holds at most 4 GB and 65,535 entries; one
 * larger is refused rather than written wrong.
 *
 * Design: the backup's format is `utils/backup.js`.
 */

import { inflateSync } from 'fflate'
import { zipWriter } from './zipWriter.js'

/** The envelope's entry. */
export const MANIFEST = 'backup.json'

/** The tables whose rows carry bytes, and where a row keeps them. */
const BYTES = { files: 'blob', cardFiles: 'image' }

/** How much JSON text an entry holds before the next is begun. */
const ENTRY_CHARS = 32 * 1024 * 1024

/**
 * Write a backup as a zip. Its byte-carrying rows hold Blobs: `blob` for a
 * file's, `image` for a library card's, as storage keeps them.
 *
 * @param {import('./backup.js').Backup} backup
 * @param {{entryChars?: number}} [options] - How much JSON an entry holds, for tests
 * @returns {Promise<Blob>}
 * @throws {Error} When it is too large for a zip to hold
 */
export async function writeArchive(backup, { entryChars = ENTRY_CHARS } = {}) {
  const zip = zipWriter('This is more than a backup file can hold yet: 4 GB, or 65,535 files.')
  const { tables, ...envelope } = backup
  /** @type {Record<string, string[]>} */
  const named = {}
  let files = 0
  for (const [table, rows] of Object.entries(tables)) {
    const carries = /** @type {Record<string, string>} */ (BYTES)[table]
    named[table] = []
    /** @type {string[]} */
    let pieces = []
    let length = 0
    const close = () => {
      const name = `tables/${table}/${named[table].length + 1}.json`
      zip.addText(name, `[${pieces.join(',')}]`)
      named[table].push(name)
      pieces = []
      length = 0
    }
    for (const row of rows) {
      let kept = row
      if (carries && row?.[carries] instanceof Blob) {
        const { [carries]: blob, ...rest } = row
        const entry = `files/${++files}`
        await zip.addBlob(entry, blob)
        kept = { ...rest, mime: blob.type, entry }
      }
      const json = JSON.stringify(kept)
      if (pieces.length > 0 && length + json.length > entryChars) close()
      pieces.push(json)
      length += json.length
    }
    if (pieces.length > 0 || named[table].length === 0) close()
  }
  zip.addText(MANIFEST, JSON.stringify({ ...envelope, archive: 1, tables: named }, null, 2))
  return zip.end()
}

/**
 * An entry of a zip, as its central directory gives it.
 * @typedef {Object} ZipEntry
 * @property {string} name
 * @property {number} method - 0 stored, 8 deflated
 * @property {number} size - As stored
 * @property {number} offset - Of its local header
 */

/**
 * Whether a file is a zip with a backup in it, rather than a JSON backup or
 * some other zip (a Scrivener project's).
 *
 * @param {Blob} file
 */
export async function isArchive(file) {
  if (!(await isZip(file))) return false
  try {
    return (await entriesOf(file)).some(entry => entry.name === MANIFEST)
  } catch {
    return false
  }
}

/** @param {Blob} file */
async function isZip(file) {
  const start = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return start.length === 4 && view(start).getUint32(0, true) === 0x04034b50
}

/**
 * Read a backup from a zip: its envelope, with each table's rows, and the
 * byte-carrying rows' bytes as Blobs cut from the file.
 *
 * @param {Blob} file
 * @returns {Promise<any>} The envelope, unchecked
 * @throws {Error} If it is not a backup's zip, saying why
 */
export async function readArchive(file) {
  const entries = new Map((await entriesOf(file)).map(entry => [entry.name, entry]))
  const manifest = entries.get(MANIFEST)
  if (!manifest) throw new Error('This zip holds no inksprite backup.')
  const envelope = JSON.parse(await textOf(file, manifest))
  if (!envelope || typeof envelope !== 'object' || typeof envelope.tables !== 'object') {
    throw new Error('This zip holds no inksprite backup.')
  }
  /** @type {Record<string, any[]>} */
  const tables = {}
  for (const [table, names] of Object.entries(envelope.tables)) {
    const carries = /** @type {Record<string, string>} */ (BYTES)[table]
    const rows = []
    for (const name of /** @type {string[]} */ (names)) {
      const entry = entries.get(name)
      if (!entry) throw new Error(`This backup is missing part of itself (${name}).`)
      for (const row of JSON.parse(await textOf(file, entry))) {
        if (carries && row?.entry) {
          const bytes = entries.get(row.entry)
          if (!bytes) throw new Error(`This backup is missing a file (${row.entry}).`)
          const { entry: _entry, mime, ...rest } = row
          rows.push({ ...rest, [carries]: await blobOf(file, bytes, mime || '') })
        } else rows.push(row)
      }
    }
    tables[table] = rows
  }
  const { archive: _archive, ...rest } = envelope
  return { ...rest, tables }
}

/**
 * The entries a zip's central directory lists.
 * @param {Blob} file
 * @returns {Promise<ZipEntry[]>}
 */
async function entriesOf(file) {
  // The end record is the last 22 bytes, but for a comment of up to 64 KB.
  const tailStart = Math.max(0, file.size - 22 - 0xffff)
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer())
  let end = -1
  for (let at = tail.length - 22; at >= 0; at--) {
    if (view(tail).getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('This is not a zip that can be read.')
  const record = view(tail)
  const count = record.getUint16(end + 10, true)
  const length = record.getUint32(end + 12, true)
  const offset = record.getUint32(end + 16, true)
  if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) {
    throw new Error('This zip is larger than inksprite can read.')
  }
  const directory = view(new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()))
  /** @type {ZipEntry[]} */
  const entries = []
  const decoder = new TextDecoder()
  for (let at = 0, read = 0; read < count; read++) {
    if (directory.getUint32(at, true) !== 0x02014b50) {
      throw new Error('This is not a zip that can be read.')
    }
    const nameLength = directory.getUint16(at + 28, true)
    const extraLength = directory.getUint16(at + 30, true)
    const commentLength = directory.getUint16(at + 32, true)
    entries.push({
      method: directory.getUint16(at + 10, true),
      size: directory.getUint32(at + 20, true),
      offset: directory.getUint32(at + 42, true),
      name: decoder.decode(
        new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength)
      ),
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Where an entry's bytes begin: after its local header, whose name and extra
 * field may differ in length from the central directory's.
 * @param {Blob} file
 * @param {ZipEntry} entry
 */
async function dataStart(file, entry) {
  const header = view(
    new Uint8Array(await file.slice(entry.offset, entry.offset + 30).arrayBuffer())
  )
  if (header.getUint32(0, true) !== 0x04034b50) throw new Error('This zip is damaged.')
  return entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true)
}

/**
 * An entry's bytes, as a Blob cut from the file: stored, never read.
 * @param {Blob} file
 * @param {ZipEntry} entry
 * @param {string} type
 */
async function blobOf(file, entry, type) {
  const start = await dataStart(file, entry)
  if (entry.method === 0) return file.slice(start, start + entry.size, type)
  return new Blob([await bytesOf(file, entry, start)], { type })
}

/**
 * An entry's bytes, read and inflated.
 * @param {Blob} file
 * @param {ZipEntry} entry
 * @param {number} [from] - Where its data begins, if known
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function bytesOf(file, entry, from) {
  const start = from ?? (await dataStart(file, entry))
  const stored = new Uint8Array(await file.slice(start, start + entry.size).arrayBuffer())
  if (entry.method === 0) return stored
  if (entry.method === 8) return /** @type {Uint8Array<ArrayBuffer>} */ (inflateSync(stored))
  throw new Error(`This zip uses a compression inksprite can't read (${entry.method}).`)
}

/**
 * @param {Blob} file
 * @param {ZipEntry} entry
 */
async function textOf(file, entry) {
  return new TextDecoder().decode(await bytesOf(file, entry))
}

/** @param {Uint8Array} bytes */
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
