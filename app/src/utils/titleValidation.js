/**
 * @module utils/titleValidation
 * @description Utilities for validating and normalizing titles
 */

/**
 * Normalize a title by trimming whitespace
 * @param {string|null|undefined} title - The title to normalize
 * @returns {string} The normalized title (empty string if null/undefined)
 */
export const normalizeTitle = title => {
  if (title == null) return ''
  return title.trim()
}

/**
 * Check if a title should be updated
 * @param {string|null|undefined} newTitle - The new title value
 * @param {string|null|undefined} currentTitle - The current title value
 * @returns {boolean} True if the title should be updated
 */
export const shouldUpdateTitle = (newTitle, currentTitle) => {
  const normalizedNew = normalizeTitle(newTitle)
  const normalizedCurrent = normalizeTitle(currentTitle)
  return normalizedNew !== normalizedCurrent
}

/**
 * Check if a title is considered custom (non-empty after trimming)
 * @param {string|null|undefined} title - The title to check
 * @returns {boolean} True if the title is custom
 */
export const isCustomTitle = title => {
  return normalizeTitle(title) !== ''
}

/**
 * Get placeholder text for title inputs
 * @param {string} type - The type of item ('part', 'scene', 'draft')
 * @param {number} position - The position/index of the item
 * @returns {string} Placeholder text
 */
export const getTitlePlaceholder = (type, position) => {
  switch (type) {
    case 'part':
      return `Leave empty for "Act ${position}"`
    case 'scene':
      return `Leave empty for "Chapter ${position}"`
    case 'draft':
      return `Leave empty for "Draft ${position}"`
    default:
      return 'Enter title'
  }
}

/**
 * A project name no other project has: `name` itself when it is free, and
 * otherwise numbered past the copies already there — `Lighthouse (2)`, then
 * `Lighthouse (3)`, the original being the first, as a document's copies are
 * (see `freeTitle` in utils/documentPath.js). A name that is already a
 * numbered copy counts on from its own number rather than gaining a second
 * one, so importing `Lighthouse (2)` beside itself gives `Lighthouse (3)`.
 * Names are compared without the spaces round them and whatever their case.
 *
 * @param {string[]} taken - The names of the other projects
 * @param {string} name
 * @returns {string}
 */
export const freeProjectName = (taken, name) => {
  const key = (/** @type {string} */ value) => value.trim().toLowerCase()
  const keys = new Set(taken.map(key))
  if (!keys.has(key(name))) return name

  const numbered = /^(.*?)\s*\((\d+)\)$/
  const base = (numbered.exec(name.trim())?.[1] ?? name).trim()
  let highest = 1
  for (const other of taken) {
    const copy = numbered.exec(other.trim())
    if (copy && key(copy[1]) === key(base)) highest = Math.max(highest, Number(copy[2]))
  }
  return `${base} (${highest + 1})`
}
