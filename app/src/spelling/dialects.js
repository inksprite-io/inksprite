/**
 * @module spelling/dialects
 * @description The dialects the Language setting offers, and what the
 * settings start on: the dialect of the browser's language, with the
 * checker on; or, for a language Harper doesn't check, the checker off, which
 * leaves spelling to the browser.
 */

/** @typedef {import('./engine.js').Dialect} Dialect */

/** @type {readonly { value: Dialect, label: string }[]} */
export const DIALECTS = [
  { value: 'american', label: 'English (US)' },
  { value: 'british', label: 'English (UK)' },
  { value: 'australian', label: 'English (Australia)' },
  { value: 'canadian', label: 'English (Canada)' },
  { value: 'indian', label: 'English (India)' },
]

/**
 * The dialects by the region of a language tag. The rest of the English
 * speaking world spells as Britain does, nearer than as America does, except
 * where it has a dialect of its own here.
 *
 * @type {Record<string, Dialect>}
 */
const BY_REGION = {
  US: 'american',
  AU: 'australian',
  CA: 'canadian',
  IN: 'indian',
  GB: 'british',
  IE: 'british',
  NZ: 'british',
  ZA: 'british',
}

/**
 * Whether a stored value is one of the dialects.
 *
 * @param {unknown} value
 * @returns {value is Dialect}
 */
export const isDialect = value => DIALECTS.some(dialect => dialect.value === value)

/**
 * The dialect for a language tag, as the browser gives it (`en-GB`). English
 * without a region, or with one not listed, is American; any other language
 * has none.
 *
 * @param {string|undefined} language
 * @returns {Dialect|null}
 */
export function dialectFor(language) {
  const [lang, ...rest] = (language || '').split(/[-_]/)
  if (lang.toLowerCase() !== 'en') return null
  const region = rest.find(part => /^[A-Za-z]{2}$/.test(part))?.toUpperCase()
  return (region && BY_REGION[region]) || 'american'
}

/** The browser's language. */
const browserLanguage = () => globalThis.navigator?.language

/**
 * The dialect the setting starts on, for this browser: American for a
 * language that has none.
 *
 * @returns {Dialect}
 */
export const defaultDialect = () => dialectFor(browserLanguage()) ?? 'american'

/**
 * Whether the checker starts on, for this browser: for English, not for a
 * language Harper doesn't check.
 *
 * @returns {boolean}
 */
export const checksByDefault = () => dialectFor(browserLanguage()) !== null
