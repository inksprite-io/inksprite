/**
 * What the app has ready for a connected app to fetch: a document or a
 * folder exported for it (`app/src/apps/exports.js`), held here until the
 * app's own shell downloads it by the link the tool answered with
 * (`appServer.js`).
 *
 * The link is all it takes to fetch one, so it is made to be worth little:
 * its id is random and long, it works once, and for a few minutes. An app's
 * model is handed the link and not the connection's token, which opens
 * every project ticked for it, to write in, for as long as it is kept: the
 * link is seen wherever a command is (a transcript, a shell's history, a
 * list of processes), and the token never is.
 *
 * They are kept in memory, a few for each connection, and gone when the app
 * quits.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** How long a link works. */
export const LIFE = 5 * 60 * 1000

/** How many are held for a connection: one more takes the oldest's place. */
export const HELD_MOST = 4

/** The most one may be. */
export const BYTES_MOST = 256 * 1024 * 1024

/** The longest name one is given. */
const NAME_MOST = 255

/** @param {string} text */
const digest = text => createHash('sha256').update(text).digest()

/**
 * Something to fetch.
 *
 * @typedef {Object} Offered
 * @property {string} name - What its file is called
 * @property {Buffer} bytes
 */

/**
 * @param {Object} [options]
 * @param {number} [options.life] - How long a link works, in milliseconds
 */
export function appExports({ life = LIFE } = {}) {
  /** @type {Map<string, Offered & {connection: string, timer: NodeJS.Timeout}>} */
  const held = new Map()

  /** @param {string} id */
  const drop = id => {
    clearTimeout(held.get(id)?.timer)
    held.delete(id)
  }

  return {
    /**
     * Hold something for a connection's app to fetch.
     *
     * @param {unknown} connection - The connection's id
     * @param {any} file - Its name and its bytes
     * @returns {{id: string}} What its link ends in
     * @throws {Error} For anything but a named file of a size that can be held
     */
    offer(connection, file) {
      if (typeof connection !== 'string' || !connection) throw new Error('No such connection.')
      const name = file?.name
      if (typeof name !== 'string' || !name || name.length > NAME_MOST || /[/\\\0]/.test(name)) {
        throw new Error('An export is a file with a name.')
      }
      if (!(file.bytes instanceof Uint8Array)) throw new Error('An export is a file with a name.')
      if (file.bytes.length > BYTES_MOST) throw new Error('That is more than can be handed over.')

      const mine = [...held].filter(([, one]) => one.connection === connection)
      for (const [id] of mine.slice(0, Math.max(0, mine.length - HELD_MOST + 1))) drop(id)

      const id = randomBytes(32).toString('base64url')
      const timer = setTimeout(() => held.delete(id), life)
      // Nothing waits on a link's running out, the app's quitting least of all.
      timer.unref()
      held.set(id, { connection, name, bytes: Buffer.from(file.bytes), timer })
      return { id }
    },

    /**
     * What a link is for, the once it is asked: null for one used, run out,
     * or never made. Every id held is compared, each in the same time.
     *
     * @param {string} id
     * @returns {Offered|null}
     */
    take(id) {
      const given = digest(id)
      /** @type {string|null} */
      let found = null
      for (const key of held.keys()) {
        if (timingSafeEqual(given, digest(key))) found = key
      }
      const one = found === null ? null : held.get(found)
      if (found === null || !one) return null
      drop(found)
      return { name: one.name, bytes: one.bytes }
    },

    /**
     * Let go of what is held for a connection: it has been removed.
     * @param {string} connection
     */
    forget(connection) {
      for (const [id, one] of [...held]) if (one.connection === connection) drop(id)
    },

    /** Let go of everything. */
    clear() {
      for (const id of [...held.keys()]) drop(id)
    },

    /** How many are held. */
    get size() {
      return held.size
    },
  }
}

/** @typedef {ReturnType<typeof appExports>} AppExports */
