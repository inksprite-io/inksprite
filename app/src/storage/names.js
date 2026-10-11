/* global TextEncoder */

/**
 * Filenames made from titles.
 *
 * A title is the writer's and can hold anything; a filename has to be one
 * that macOS, Windows and Linux all take, and that a case-insensitive disk
 * keeps apart from its neighbours. Names in a folder are compared the way
 * those disks compare them: composed the same way and in any case.
 */

/** What no system takes in a name, or Windows does not: control characters among them. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/** Names Windows keeps for devices, whatever comes after a dot. */
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i

/**
 * The most a name made from a title takes, in UTF-8 bytes. Disks allow 255;
 * this leaves room for an order prefix, a `(2)`, and a hidden file's `.` and
 * `.md` beside an imported file.
 */
const MAX_BYTES = 180

/** An order prefix: `07 - `. */
const PREFIX = /^(\d+) - (.*)$/s

const encoder = new TextEncoder()

/**
 * A name cut to fit, on a character's edge.
 *
 * @param {string} name
 * @returns {string}
 */
function clip(name) {
  if (encoder.encode(name).length <= MAX_BYTES) return name
  let out = ''
  let bytes = 0
  for (const character of name) {
    bytes += encoder.encode(character).length
    if (bytes > MAX_BYTES) break
    out += character
  }
  return out
}

/**
 * A title as a name every system takes: the characters none of them allow
 * as hyphens, no leading dot (which would hide it), none of the endings
 * Windows drops, nothing Windows keeps for a device, and not too long.
 *
 * @param {string} title
 * @returns {string}
 */
export function safeName(title) {
  const tidy = (/** @type {string} */ name) => name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  let name = tidy(
    clip(tidy((title || '').normalize('NFC').replace(/\s+/g, ' ').replace(UNSAFE, '-')))
  )
  if (!name) return 'Untitled'
  const dot = name.indexOf('.')
  const stem = dot < 0 ? name : name.slice(0, dot)
  if (RESERVED.test(stem)) name = `${stem}_${name.slice(stem.length)}`
  return name
}

/**
 * What two names are compared by: the same on any disk that would take them
 * for one file.
 *
 * @param {string} name
 * @returns {string}
 */
export const nameKey = name => name.normalize('NFC').toLowerCase()

/**
 * A name split at its extension, where it has one: `Map.png` is `Map` and
 * `.png`. A leading dot is not an extension.
 *
 * @param {string} name
 * @returns {{stem: string, extension: string}}
 */
export function splitExtension(name) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { stem: name, extension: '' }
  return { stem: name.slice(0, dot), extension: name.slice(dot) }
}

/**
 * The first of `stem + extension`, `stem (2) + extension`, and so on, that
 * is not taken, and takes it.
 *
 * @param {Set<string>} taken - Keys of the names in use; the one chosen is added
 * @param {string} stem
 * @param {string} extension
 * @returns {string}
 */
export function claimName(taken, stem, extension) {
  let name = `${stem}${extension}`
  for (let n = 2; taken.has(nameKey(name)); n++) name = `${stem} (${n})${extension}`
  taken.add(nameKey(name))
  return name
}

/**
 * How many digits an ordered folder's prefixes take: two, or more for a
 * folder of a hundred or more.
 *
 * @param {number} count
 * @returns {number}
 */
export const prefixWidth = count => Math.max(2, String(count).length)

/**
 * A name with its place in an ordered folder before it: `03 - Chapter 3`.
 *
 * @param {number} place - From 1
 * @param {number} width - See `prefixWidth`
 * @param {string} name
 * @returns {string}
 */
export const withPrefix = (place, width, name) => `${String(place).padStart(width, '0')} - ${name}`

/**
 * A name's order prefix and the rest of it.
 *
 * @param {string} name
 * @returns {{place: number|null, rest: string}}
 */
export function readPrefix(name) {
  const match = PREFIX.exec(name)
  return match ? { place: Number(match[1]), rest: match[2] } : { place: null, rest: name }
}

/**
 * Whether a name on disk is the one a title makes, a `(2)` and the like
 * allowed for. When it is not, the file was renamed somewhere else, and the
 * name is the title now.
 *
 * @param {string} title
 * @param {string} stem - The name less its order prefix and its extension
 * @returns {boolean}
 */
export function stemFits(title, stem) {
  const safe = safeName(title)
  const found = stem.normalize('NFC')
  if (found === safe) return true
  if (!found.startsWith(`${safe} (`)) return false
  return /^ \(\d+\)$/.test(found.slice(safe.length))
}
