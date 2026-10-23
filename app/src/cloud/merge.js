/**
 * @module cloud/merge
 * @description One row as two devices changed it, merged: against the base,
 * the row as both last had it from the server, where there is one.
 *
 * A document's text is merged three ways, line by line, and within lines
 * both sides changed, word by word. Lines both put in at one place are kept
 * both, this device's first. Where the two changed the same words, they
 * **clash**, and this device's stand: it is the one syncing later. The
 * other's whole text is handed back, to be kept as a version, so nothing
 * either wrote is lost. A clash of a paragraph or two leaves the rest merged;
 * a larger one, as after a long time offline, leaves this device's text
 * whole, since half of one rewrite around the other's edits reads worse
 * than either. The text is merged as text, marks and all: comment marks are
 * in it, and a comment made on one device is kept by a merge with the other.
 *
 * The other fields of a document, and a story's and a chat's, are merged one
 * by one, a document's threads and pictures by their ids: a field changed
 * on one side takes that side's, and one changed on both takes the newer
 * row's. Messages and files have no base kept, and the newer wins.
 *
 * Without a base, as on a device's first sync of a project another device
 * has too, the newer row wins, and a text document whose text differs hands
 * back the other's as a large clash.
 *
 * Design: `.llm/sync_design.md`, "Merging".
 */

import { diff3 } from '@/utils/diff.js'
import { countWords } from '@/utils/wordCount.js'
import { stableJson } from './crypto.js'

/**
 * The text that lost a clash: the other device's, whole.
 *
 * @typedef {Object} Lost
 * @property {string} content
 * @property {boolean} large - More than a paragraph or two clashed, and
 *   nothing of it was merged in
 */

/**
 * @typedef {Object} Merged
 * @property {any} row - The row as both are to have it
 * @property {Lost|null} lost - The text that lost a clash, to be kept as a
 *   version, or null when everything was merged
 */

/** Past this many changed lines or words on a side, the text clashes whole. */
const MAX_EDITS = 5000

/** How many paragraphs can clash and leave the rest merged. */
export const SMALL_CLASH = 2

/** Fields that are the device's own count, never compared. */
const OWN = new Set(['version'])

/** Fields of a document merged by their ids. */
const BY_ID = new Set(['comments', 'pictures'])

/** A word, a run of spaces, or any other character. */
const WORDS = /\s+|[\p{L}\p{N}\p{M}_'’]+|[^]/gu

/**
 * @param {unknown} a
 * @param {unknown} b
 */
const same = (a, b) => a === b || stableJson(a) === stableJson(b)

/**
 * A row without the fields that are the device's own.
 * @param {any} row
 */
export function comparable(row) {
  if (!row || typeof row !== 'object') return row
  return Object.fromEntries(Object.entries(row).filter(([key]) => !OWN.has(key)))
}

/**
 * A row as this device and the server have it, merged.
 *
 * @param {string} table
 * @param {any|null} base - As both last had it, if that was kept
 * @param {any} mine - As this device has it
 * @param {any} theirs - As the server has it
 * @returns {Merged}
 */
export function mergeRow(table, base, mine, theirs) {
  if (same(comparable(mine), comparable(theirs))) return { row: theirs, lost: null }
  const newer = (mine.updated ?? 0) > (theirs.updated ?? 0) ? mine : theirs
  if (table === 'messages' || table === 'files' || table === 'versions') {
    return { row: newer, lost: null }
  }
  if (!base) return withoutBase(table, mine, theirs, newer)

  /** @type {Record<string, unknown>} */
  const row = {}
  /** @type {Lost|null} */
  let lost = null
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (OWN.has(key)) {
      if (key in mine) row[key] = mine[key]
      continue
    }
    if (table === 'documents' && key === 'content' && mine.type !== 'folder') {
      const settled = settleText(base.content ?? '', mine.content ?? '', theirs.content ?? '')
      row.content = settled.text
      lost = settled.lost
      continue
    }
    const value =
      table === 'documents' && BY_ID.has(key)
        ? mergeById(base[key], mine[key], theirs[key], newer === mine)
        : mergeValue(base[key], mine[key], theirs[key], newer === mine)
    if (value !== undefined) row[key] = value
  }
  if (mine.updated !== undefined || theirs.updated !== undefined) {
    row.updated = Math.max(mine.updated ?? 0, theirs.updated ?? 0)
  }
  if (table === 'documents' && row.type !== 'folder' && 'content' in row) {
    row.wordCount = countWords(/** @type {string} */ (row.content))
  }
  return { row, lost }
}

/**
 * Two rows with nothing to compare them against: the newer stands, and a
 * text document whose text differs hands back the other's.
 *
 * @param {string} table
 * @param {any} mine
 * @param {any} theirs
 * @param {any} newer
 * @returns {Merged}
 */
function withoutBase(table, mine, theirs, newer) {
  const older = newer === mine ? theirs : mine
  const differs =
    table === 'documents' &&
    newer.type === 'text' &&
    (older.content ?? '') !== '' &&
    older.content !== newer.content
  return { row: newer, lost: differs ? { content: older.content, large: true } : null }
}

/**
 * One field merged three ways: what changed on one side takes that side's,
 * and what changed on both takes the newer's, a value kept over one removed.
 *
 * @param {unknown} base
 * @param {unknown} mine
 * @param {unknown} theirs
 * @param {boolean} mineNewer
 */
function mergeValue(base, mine, theirs, mineNewer) {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  if (mine === undefined) return theirs
  if (theirs === undefined) return mine
  return mineNewer ? mine : theirs
}

/**
 * A field that holds things by their ids, merged id by id.
 *
 * @param {Record<string, unknown>|undefined} base
 * @param {Record<string, unknown>|undefined} mine
 * @param {Record<string, unknown>|undefined} theirs
 * @param {boolean} mineNewer
 */
function mergeById(base, mine, theirs, mineNewer) {
  /** @type {Record<string, unknown>} */
  const out = {}
  const ids = new Set([...Object.keys(mine ?? {}), ...Object.keys(theirs ?? {})])
  for (const id of ids) {
    const value = mergeValue(base?.[id], mine?.[id], theirs?.[id], mineNewer)
    if (value !== undefined) out[id] = value
  }
  return Object.keys(out).length > 0 || mine || theirs ? out : undefined
}

/**
 * A text as this device and the server have it, settled: merged, and where
 * it clashed, what lost. A small clash leaves the rest merged; a large one
 * keeps this device's text whole.
 *
 * @param {string} base
 * @param {string} mine
 * @param {string} theirs
 * @returns {{text: string, lost: Lost|null}}
 */
export function settleText(base, mine, theirs) {
  const merged = mergeText(base, mine, theirs)
  if (!merged.clashed) return { text: merged.text, lost: null }
  const large = merged.clashes > SMALL_CLASH
  return { text: large ? mine : merged.text, lost: { content: theirs, large } }
}

/**
 * A text as this device and the server have it, merged against the one
 * both came from, and how many places clashed, this device's words standing
 * in each. A text too changed on a side to merge clashes everywhere.
 *
 * @param {string} base
 * @param {string} mine
 * @param {string} theirs
 * @returns {{text: string, clashed: boolean, clashes: number}}
 */
export function mergeText(base, mine, theirs) {
  if (mine === theirs || theirs === base) return { text: mine, clashed: false, clashes: 0 }
  if (mine === base) return { text: theirs, clashed: false, clashes: 0 }
  const [b, m, t] = [lines(base), lines(mine), lines(theirs)]
  const chunks = diff3(b, m, t, { maxEdits: MAX_EDITS })
  if (!chunks) return { text: mine, clashed: true, clashes: Infinity }
  /** @type {string[]} */
  const out = []
  let clashes = 0
  for (const chunk of chunks) {
    const bs = b.slice(...chunk.base)
    const ms = m.slice(...chunk.mine)
    const ts = t.slice(...chunk.theirs)
    if (chunk.stable || sameLines(ts, bs)) out.push(...ms)
    else if (sameLines(ms, bs) || sameLines(ms, ts)) out.push(...ts)
    else if (bs.length === 0) out.push(...ms, ...ts)
    else {
      const words = mergeWords(bs.join(''), ms.join(''), ts.join(''))
      if (words === null) clashes++
      out.push(words ?? ms.join(''))
    }
  }
  return { text: out.join(''), clashed: clashes > 0, clashes }
}

/**
 * Lines both sides changed, merged word by word; null where the same words
 * were changed differently.
 *
 * @param {string} base
 * @param {string} mine
 * @param {string} theirs
 * @returns {string|null}
 */
function mergeWords(base, mine, theirs) {
  const [b, m, t] = [base, mine, theirs].map(text => text.match(WORDS) ?? [])
  const chunks = diff3(b, m, t, { maxEdits: MAX_EDITS })
  if (!chunks) return null
  let out = ''
  for (const chunk of chunks) {
    const bs = b.slice(...chunk.base).join('')
    const ms = m.slice(...chunk.mine).join('')
    const ts = t.slice(...chunk.theirs).join('')
    if (chunk.stable || ts === bs) out += ms
    else if (ms === bs || ms === ts) out += ts
    else return null
  }
  return out
}

/**
 * A text's lines, each with the newline that ends it.
 * @param {string} text
 * @returns {string[]}
 */
const lines = text => (text === '' ? [] : text.split(/(?<=\n)/))

/**
 * @param {string[]} a
 * @param {string[]} b
 */
const sameLines = (a, b) => a.length === b.length && a.every((line, i) => line === b[i])
