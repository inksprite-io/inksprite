/**
 * @module utils/versions
 * @description When a text document's version is due, which versions go as
 * they age, and what each says it was taken before. See
 * `stores/versionsStore.js` and `.llm/versions_design.md`.
 */

/** @typedef {import('../types/models.js').Version} Version */
/** @typedef {import('../types/models.js').VersionBy} VersionBy */

/** How long a document goes unchanged before the text it was left at is kept: 10 minutes. */
export const PAUSE_MS = 10 * 60_000

/** How long a stretch of editing goes before a version is kept anyway: an hour. */
export const STRETCH_MS = 60 * 60_000

const DAY_MS = 24 * 60 * 60_000

/** How long one version of each day is kept, before one of each week is. */
const DAILY_FOR_MS = 30 * DAY_MS

/**
 * The day a moment is in, by the clock here.
 * @param {number} at
 */
const dayOf = at => {
  const day = new Date(at)
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
}

/**
 * The week a moment is in, by the Monday it starts on, by the clock here.
 * @param {number} at
 */
const weekOf = at => {
  const monday = new Date(at)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return `week ${dayOf(monday.getTime())}`
}

/**
 * The versions of a document to let go of as they age. A named one stays.
 * Of the rest, every one from the last day stays; then the newest of each
 * day, for 30 days; then the newest of each week.
 *
 * @param {Version[]} versions - One document's
 * @param {number} [now]
 * @returns {string[]} Their ids
 */
export function thinned(versions, now = Date.now()) {
  /** @type {Set<string>} */
  const kept = new Set()
  /** @type {string[]} */
  const out = []
  for (const version of [...versions].sort((a, b) => b.at - a.at)) {
    const age = now - version.at
    if (version.name || age < DAY_MS) continue
    const span = age < DAILY_FOR_MS ? dayOf(version.at) : weekOf(version.at)
    if (kept.has(span)) out.push(version.id)
    else kept.add(span)
  }
  return out
}

/** The name a clash's lost text is kept under. */
export const CLASHED = 'Clashed with an edit from another device'

/** The name a Google Doc's text is kept under when words of it gave way to its document's. */
export const DOC_CLASHED = 'The Google Doc’s text, which clashed with this one'

/** What a version says it was taken before, by what was about to change the text. */
export const TAKEN_BEFORE = /** @type {Record<VersionBy, string>} */ ({
  model: 'Before the model’s edits',
  drive: 'Before syncing with Google Docs',
  sync: 'Before merging edits from another device',
  restore: 'Before restoring a version',
  import: 'Before re-importing the card',
})
