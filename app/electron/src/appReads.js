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
 */

import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

/** The folder's name, in the app's data folder. */
export const READS_FOLDER = 'app-reads'

/** The most a record may be, written out: a long document's text, and room. */
export const RECORD_MOST = 4 * 1024 * 1024

/** What an id is made of: a connection's, or a document's. */
const ID = /^[A-Za-z0-9_-]{1,100}$/

/** Where the records are: `~/Library/Application Support/inksprite/app-reads` on a Mac. */
export const readsPath = () => path.join(app.getPath('userData'), READS_FOLDER)

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
     * Everything kept for a connection, a record for each document.
     *
     * @param {unknown} connection
     * @returns {Promise<object[]>}
     */
    async all(connection) {
      const dir = dirOf(connection)
      const names = await fs.readdir(dir).catch(() => /** @type {string[]} */ ([]))
      const records = await Promise.all(
        names.filter(name => name.endsWith('.json')).map(name => read(path.join(dir, name)))
      )
      return records.filter(record => record !== null)
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
  }
}
