/**
 * @module utils/partialJson
 * @description Read the strings out of JSON that has not finished arriving.
 *
 * A tool call streams as a JSON object one token at a time, and the prose the
 * model is writing into it is a string value that may run for minutes before
 * its closing quote. `JSON.parse` has nothing to say until then. This does:
 * every string field that has fully arrived, plus the one still being written,
 * as far as it has got.
 */

/**
 * A JSON string's body: anything but a quote or a backslash, or a backslash
 * and whatever it escapes.
 */
const STRING_BODY = String.raw`(?:[^"\\]|\\.)*`

/**
 * `"key": "value"` where the value is closed by a quote or by the end of the
 * text — which may fall on a backslash that has not yet said what it escapes.
 */
const FIELD = new RegExp(String.raw`"(${STRING_BODY})"\s*:\s*"(${STRING_BODY})(?:(")|\\?$)`, 'g')

/**
 * Decode a JSON string body, tolerating an escape cut off at the end.
 *
 * @param {string} body
 * @returns {string}
 */
function decode(body) {
  // A `\u12` or lone `\` at the end is the start of an escape that has not
  // finished arriving; it means nothing yet.
  const whole = body.replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, '')
  try {
    return JSON.parse(`"${whole}"`)
  } catch {
    return whole
  }
}

/**
 * The string fields of a JSON object text, complete or not, keyed by name.
 * Nested objects are read through: their string fields count, with their own
 * keys. A later field with the same key wins.
 *
 * @param {string|null|undefined} text - JSON, or the front part of some
 * @returns {Record<string, string>}
 */
export function partialStrings(text) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, field] of Object.entries(partialFields(text))) out[key] = field.value
  return out
}

/**
 * A string field of JSON still arriving: as far as it has got, and whether
 * its closing quote has come.
 *
 * @typedef {{value: string, done: boolean}} PartialField
 */

/**
 * The string fields of a JSON object text, complete or not, each saying
 * whether it is: a path is worth looking up only once the whole of it has
 * come. Read as `partialStrings` reads them.
 *
 * @param {string|null|undefined} text - JSON, or the front part of some
 * @returns {Record<string, PartialField>}
 */
export function partialFields(text) {
  /** @type {Record<string, PartialField>} */
  const out = {}
  if (!text) return out
  for (const match of text.matchAll(FIELD)) {
    out[decode(match[1])] = { value: decode(match[2]), done: match[3] === '"' }
  }
  return out
}
