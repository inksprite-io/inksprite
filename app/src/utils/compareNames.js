/**
 * @module utils/compareNames
 * @description Names in the order a person expects: "Chapter 2" before
 * "Chapter 10". Everything listed by name sorts this way, so the outline, the
 * project picker, what the model is shown and the folders on disk agree.
 */

const collator = new Intl.Collator(undefined, { numeric: true })

/**
 * Compare two names, reading runs of digits as numbers.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareNames(a, b) {
  return collator.compare(a, b)
}
