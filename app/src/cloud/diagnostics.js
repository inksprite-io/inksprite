/**
 * @module cloud/diagnostics
 * @description What the sync engine counts of how syncing goes, for the
 * sync server: rounds and their failures, records and bytes each way,
 * conflicts and clashes, trees repaired, rows the start-up check found
 * unsent, the outbox's length, files fetched. Counts and fixed tags only:
 * never text, titles, names, ids or error messages, so the report tells the
 * server nothing it doesn't see already.
 *
 * `useCloudSync` sends a report every quarter of an hour and when the page
 * is hidden, unless the writer turned them off or the server wants none.
 *
 * Design: `.llm/sync_design.md`, "Hosted", "Seeing what happens".
 */

import { CloudError } from './api.js'

/** What the report's shape is, should it change. */
const VERSION = 1

/**
 * @typedef {Object} Diagnostics
 * @property {(key: string, by?: number) => void} count
 * @property {(tag: string) => void} error
 * @property {(ms: number) => void} took - A round's time
 * @property {(length: number, oldestMs: number) => void} outbox - Its length after a
 *   round, and how long its oldest entry has waited
 * @property {(about: Record<string, string|number>) => object|null} take - The report
 *   since the last, which starts the next; null when there is nothing to say
 */

/** Counts nothing, for an engine nobody reads. @type {Diagnostics} */
export const UNCOUNTED = {
  count: () => {},
  error: () => {},
  took: () => {},
  outbox: () => {},
  take: () => null,
}

/**
 * @param {{now?: () => number}} [options]
 * @returns {Diagnostics}
 */
export function createDiagnostics({ now = Date.now } = {}) {
  /** @type {Record<string, number>} */
  let counts = {}
  /** @type {Record<string, number>} */
  let errors = {}
  let [roundMsMax, roundMsTotal, most, oldestMs] = [0, 0, 0, 0]
  let from = now()

  return {
    count(key, by = 1) {
      if (by) counts[key] = (counts[key] ?? 0) + by
    },
    error(tag) {
      errors[tag] = (errors[tag] ?? 0) + 1
    },
    took(ms) {
      roundMsMax = Math.max(roundMsMax, Math.round(ms))
      roundMsTotal += Math.round(ms)
    },
    outbox(length, oldest) {
      most = Math.max(most, length)
      oldestMs = Math.max(oldestMs, Math.round(oldest))
    },
    take(about) {
      if (Object.keys(counts).length === 0 && Object.keys(errors).length === 0) return null
      const report = {
        v: VERSION,
        ...about,
        from,
        to: now(),
        counts,
        errors,
        timing: { roundMsMax, roundMsTotal },
        outbox: { most, oldestMs },
      }
      counts = {}
      errors = {}
      ;[roundMsMax, roundMsTotal, most, oldestMs] = [0, 0, 0, 0]
      from = now()
      return report
    },
  }
}

/**
 * What kind of failure an error is, as a tag of our own: the server's
 * status, offline, a record that couldn't be opened, storage full, or the
 * error's class. Never its message.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function errorTag(error) {
  if (error instanceof CloudError) return error.status === 0 ? 'offline' : `http:${error.status}`
  const name = /** @type {any} */ (error)?.name
  if (name === 'OperationError') return 'decrypt'
  if (name === 'QuotaExceededError') return 'storage'
  return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'other'
}
