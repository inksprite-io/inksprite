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
