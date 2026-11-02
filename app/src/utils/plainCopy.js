/**
 * @module utils/plainCopy
 * @description A deep copy of a row, as JSON would have it, without writing it
 * out as JSON.
 */

import { toRaw } from 'vue'

/**
 * A copy of `value` holding what `JSON.parse(JSON.stringify(value))` would:
 * plain objects and arrays, no reactivity, nothing JSON leaves out.
 *
 * A string is the same string in the copy. Only objects are copied, so a
 * document of any length costs what a short one does. Writing one out instead
 * takes seconds at a few hundred megabytes, and past 128 million characters,
 * with a character anywhere beside it that doesn't fit in a byte, V8's
 * `JSON.stringify` can kill the page outright with an out-of-memory error
 * nothing can catch.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 * @throws {RangeError} When the value holds a cycle, as JSON's TypeError would
 */
export function plainCopy(value) {
  return /** @type {T} */ (copyOf(value))
}

/**
 * @param {any} value
 * @returns {any} Undefined for what JSON leaves out
 */
function copyOf(value) {
  const raw = toRaw(value)
  // Adding 0 makes -0 a 0, as writing it out does.
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw + 0 : null
  if (typeof raw === 'function' || typeof raw === 'symbol') return undefined
  if (raw === null || typeof raw !== 'object') return raw
  if (typeof raw.toJSON === 'function') return copyOf(raw.toJSON())
  if (Array.isArray(raw)) return raw.map(item => copyOf(item) ?? null)
  // By entries, so that a key called `__proto__` stays a key, as JSON's does.
  return Object.fromEntries(
    Object.keys(raw)
      .map(key => [key, copyOf(raw[key])])
      .filter(([, item]) => item !== undefined)
  )
}
