/**
 * What each connected app last read or wrote of each document, kept for the
 * page (`src/apps/revisions.js`), which answers "what changed since" from
 * it. Kept here, in files in the app's data folder beside `apps.json`, and
 * not in the page's database: it is this computer's alone and goes with its
 * connection, and a table for it there would raise the schema every synced
 * device has to be on.
 *
 * A record is whatever the page hands over, a file for each connection and
 * document: `app-reads/<connection>/<document>.json`. The page's ids are
 * the names, so only an id that could be one is taken.
 *
 * A record holds a document's text, so it is let go of when what it is of
 * goes: with its connection, with a project unticked for it, and with a
 * document or a project deleted for good (`apps.js`).
 */

import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

/** The folder's name, in the app's data folder. */
const READS_FOLDER = 'app-reads'

/** The most a record may be, written out: a long document's text, and room. */
export const RECORD_MOST = 4 * 1024 * 1024

/** What an id is made of: a connection's, or a document's. */
const ID = /^[A-Za-z0-9_-]{1,100}$/

/** Where the records are: `~/Library/Application Support/inksprite/app-reads` on a Mac. */
const readsPath = () => path.join(app.getPath('userData'), READS_FOLDER)

/**
 * @param {unknown} id
 * @returns {string}
 * @throws {Error} For anything that isn't an id
 */
function idOf(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Not an id a record is kept under.')
  return id
}

/**
 * The records of one app's connections, kept in a folder.
 *
 * @param {string} [folder] - Where; the app's own by default
 */
export function appReads(folder = readsPath()) {
  /** @param {unknown} connection */
  const dirOf = connection => path.join(folder, idOf(connection))
  /**
   * @param {unknown} connection
   * @param {unknown} document
   */
  const fileOf = (connection, document) => path.join(dirOf(connection), `${idOf(document)}.json`)

  /**
   * @param {string} file
   * @returns {Promise<object|null>} Null for none, or one that can't be read
   */
  const read = async file => {
    try {
      const record = JSON.parse(await fs.readFile(file, 'utf8'))
      return record && typeof record === 'object' ? record : null
    } catch {
      return null
    }
  }

  /**
   * The folders of the connections asked of: the one named, or every one
   * that has anything kept.
   *
   * @param {unknown} [connection]
   * @returns {Promise<string[]>}
   */
  const dirsOf = async connection => {
    if (connection != null) return [dirOf(connection)]
    const names = await fs.readdir(folder).catch(() => /** @type {string[]} */ ([]))
    return names.filter(name => ID.test(name)).map(name => path.join(folder, name))
  }

  /**
   * The records' files in a connection's folder.
   * @param {string} dir
   * @returns {Promise<string[]>}
   */
  const filesIn = async dir => {
    const names = await fs.readdir(dir).catch(() => /** @type {string[]} */ ([]))
    return names.filter(name => name.endsWith('.json'))
  }

  return {
    /**
     * What a connection last had of a document, or null.
     *
     * @param {unknown} connection
     * @param {unknown} document
     * @returns {Promise<object|null>}
     */
    get: async (connection, document) => read(fileOf(connection, document)),

    /**
     * Keep what a connection now has of a document, in place of what it had.
     *
     * @param {unknown} connection
     * @param {unknown} document
     * @param {unknown} record
     * @returns {Promise<void>}
     * @throws {Error} For a record that isn't one, or is too large
     */
    async put(connection, document, record) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('A record is an object.')
      }
      const text = JSON.stringify(record)
      if (text.length > RECORD_MOST) throw new Error('That record is too large to keep.')
      const file = fileOf(connection, document)
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      const draft = `${file}.${process.pid}.tmp`
      await fs.writeFile(draft, text, { mode: 0o600 })
      await fs.rename(draft, file)
    },

    /**
     * Everything kept for a connection, a record for each document: whole,
     * or only the fields named, for a caller that wants to know which
     * documents there are without being handed the text of each.
     *
     * @param {unknown} connection
     * @param {unknown} [fields]
     * @returns {Promise<object[]>}
     * @throws {Error} For fields that aren't a list of names
     */
    async all(connection, fields) {
      if (fields != null && !(Array.isArray(fields) && fields.every(f => typeof f === 'string'))) {
        throw new Error('The fields asked for are a list of their names.')
      }
      const wanted = /** @type {string[]|null} */ (fields ?? null)
      const dir = dirOf(connection)
      /** @type {Array<Record<string, any>>} */
      const records = []
      // One at a time: each is read whole, text and all, to be cut down.
      for (const name of await filesIn(dir)) {
        const record = /** @type {Record<string, any>|null} */ (await read(path.join(dir, name)))
        if (!record) continue
        records.push(
          wanted
            ? Object.fromEntries(
                wanted.filter(field => Object.hasOwn(record, field)).map(f => [f, record[f]])
              )
            : record
        )
      }
      return records
    },

    /**
     * Forget everything kept for a connection: it was removed.
     *
     * @param {unknown} connection
     * @returns {Promise<void>}
     */
    async forget(connection) {
      await fs.rm(dirOf(connection), { recursive: true, force: true })
    },

    /**
     * Forget what was kept of some documents: one connection's, or every
     * connection's where none is named, as for documents deleted for good.
     *
     * @param {unknown} documents - Their ids. One that no record could be
     *   kept under is passed over: the rest are still forgotten.
     * @param {unknown} [connection]
     * @returns {Promise<void>}
     * @throws {Error} For anything that isn't a list
     */
    async forgetDocuments(documents, connection) {
      if (!Array.isArray(documents)) throw new Error('Not a list of documents.')
      const gone = new Set(
        documents
          .filter(document => typeof document === 'string' && ID.test(document))
          .map(document => `${document}.json`)
      )
      for (const dir of await dirsOf(connection)) {
        for (const name of await filesIn(dir)) {
          if (gone.has(name)) await fs.rm(path.join(dir, name), { force: true })
        }
      }
    },

    /**
     * Forget the records a test picks out: one connection's, or every
     * connection's where none is named. Each is read to be asked of.
     *
     * @param {(record: Record<string, any>) => boolean} matches
     * @param {unknown} [connection]
     * @returns {Promise<void>}
     */
    async forgetWhere(matches, connection) {
      for (const dir of await dirsOf(connection)) {
        for (const name of await filesIn(dir)) {
          const file = path.join(dir, name)
          const record = /** @type {Record<string, any>|null} */ (await read(file))
          if (record && matches(record)) await fs.rm(file, { force: true })
        }
      }
    },
  }
}
