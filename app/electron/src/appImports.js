/**
 * What a connected app is to send the app: a file it is bringing into a
 * project (`app/src/apps/imports.js`), waited for here until the app's own
 * shell sends it by the link the tool answered with (`appServer.js`), and
 * held from then until the window's page that answers takes it.
 *
 * The link is all it takes, as an export's is (`appExports.js`), and is made
 * to be worth as little: its id is random and long, it takes one file, and
 * works for a few minutes. What it is for, where the file goes, is the
 * page's to say and the page's to check again as it takes the file: here it
 * is kept as it was given and handed back with the file.
 *
 * Kept in memory, a few for each connection, and gone when the app quits.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** How long a link works, and how long a file sent by one waits for a page. */
export const LIFE = 5 * 60 * 1000

/** How many links are held for a connection: one more takes the oldest's place. */
export const HELD_MOST = 4

/** The most a file sent may be. */
export const BYTES_MOST = 256 * 1024 * 1024

/** The most what a link is for may be, written out. */
const ABOUT_MOST = 4096

/** @param {string} text */
const digest = text => createHash('sha256').update(text).digest()

/**
 * What a page said a link is for: plain values, kept as they were given.
 * @typedef {Record<string, unknown>} About
 */

/**
 * @param {Object} [options]
 * @param {number} [options.life] - How long a link works, in milliseconds
 */
export function appImports({ life = LIFE } = {}) {
  /**
   * The links held, each with what it is for, the file once it has come, and
   * while one is on its way, what stops its reading.
   * @type {Map<string, {connection: string, about: About, bytes: Buffer|null, sending: boolean, stop: (() => void)|null, timer: NodeJS.Timeout}>}
   */
  const held = new Map()

  /** @param {string} id */
  const drop = id => {
    const one = held.get(id)
    held.delete(id)
    if (!one) return
    clearTimeout(one.timer)
    one.stop?.()
  }

  /** @param {string} id */
  const expire = id => {
    const timer = setTimeout(() => drop(id), life)
    // Nothing waits on a link's running out, the app's quitting least of all.
    timer.unref()
    return timer
  }

  /**
   * The id held that is this one, compared with each in the same time.
   * @param {unknown} id
   * @returns {string|null}
   */
  const find = id => {
    if (typeof id !== 'string' || !id) return null
    const given = digest(id)
    /** @type {string|null} */
    let found = null
    for (const key of held.keys()) {
      if (timingSafeEqual(given, digest(key))) found = key
    }
    return found
  }

  return {
    /** The most a file sent may be. */
    most: BYTES_MOST,

    /**
     * Wait for a file from a connection's app.
     *
     * @param {unknown} connection - The connection's id
     * @param {unknown} about - What it is for, as the page will want it back
     * @returns {{id: string}} What its link ends in
     * @throws {Error} For what isn't a small object of plain values
     */
    open(connection, about) {
      if (typeof connection !== 'string' || !connection) throw new Error('No such connection.')
      const written = about && typeof about === 'object' ? JSON.stringify(about) : null
      if (!written || written.length > ABOUT_MOST || Array.isArray(about)) {
        throw new Error('An import must say what it is for.')
      }

      const mine = [...held].filter(([, one]) => one.connection === connection)
      for (const [id] of mine.slice(0, Math.max(0, mine.length - HELD_MOST + 1))) drop(id)

      const id = randomBytes(32).toString('base64url')
      held.set(id, {
        connection,
        about: JSON.parse(written),
        bytes: null,
        sending: false,
        stop: null,
        timer: expire(id),
      })
      return { id }
    },

    /**
     * Hold a link for a file on its way, before any of it is read: false for
     * a link used, run out or never made, or with a file already on its way
     * by it. So nothing is kept of what is sent to a link that isn't
     * waiting, and only one file comes by one at a time. `stop` is called if
     * the link is let go before the file has come.
     *
     * @param {string} id
     * @param {() => void} [stop] - Stops reading what is on its way
     * @returns {boolean}
     */
    claim(id, stop) {
      const found = find(id)
      const one = found === null ? null : held.get(found)
      if (!one || one.bytes !== null || one.sending) return false
      one.sending = true
      one.stop = stop ?? null
      return true
    },

    /**
     * Whether a link is still there, held for a file on its way by it.
     *
     * @param {string} id
     * @returns {boolean}
     */
    holds(id) {
      const found = find(id)
      return found !== null && held.get(found)?.sending === true
    },

    /**
     * Let a link that was held for a file wait again: the file never came
     * whole.
     *
     * @param {string} id
     */
    release(id) {
      const found = find(id)
      const one = found === null ? null : held.get(found)
      if (one) {
        one.sending = false
        one.stop = null
      }
    },

    /**
     * A file sent by a link: null for a link used, run out or never made.
     * One file to a link: a second is refused. The file then waits for a page
     * as long again as a link works.
     *
     * @param {string} id
     * @param {Buffer} bytes
     * @returns {{connection: string, about: About}|null}
     */
    arrive(id, bytes) {
      const found = find(id)
      const one = found === null ? null : held.get(found)
      if (found === null || !one || one.bytes !== null) return null
      clearTimeout(one.timer)
      one.bytes = bytes
      one.sending = false
      one.stop = null
      one.timer = expire(found)
      return { connection: one.connection, about: one.about }
    },

    /**
     * The file sent by a link, the once, for the connection it was made for:
     * null before one has been sent, after it was taken, or for any other.
     *
     * @param {unknown} connection
     * @param {unknown} id
     * @returns {{about: About, bytes: Buffer}|null}
     */
    take(connection, id) {
      const found = find(id)
      const one = found === null ? null : held.get(found)
      if (found === null || !one || one.connection !== connection || one.bytes === null) return null
      drop(found)
      return { about: one.about, bytes: one.bytes }
    },

    /**
     * Let go of a link and what was sent by it: the page that was asked is
     * done, whether or not it took it.
     * @param {string} id
     */
    done(id) {
      const found = find(id)
      if (found !== null) drop(found)
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

/** @typedef {ReturnType<typeof appImports>} AppImports */
