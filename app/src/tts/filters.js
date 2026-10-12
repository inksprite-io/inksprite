/**
 * @module tts/filters
 * @description Text that is not read aloud: page numbers, running heads,
 * reference marks. Regular expressions, one to a line, matched against each
 * block's words; what they match is left out of what the server is sent, and
 * a block they take all of is not read. The document keeps it all.
 */

/** @typedef {{from: number, to: number}} Range */

/** @typedef {{text: string, filtered: boolean}} Piece */

/** @param {string|null|undefined} text */
const linesOf = text =>
  (text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

/**
 * A line as a regular expression, or null when it is not one. `^` and `$`
 * are the ends of a line, for a block the writer broke into lines.
 * @param {string} line
 */
const compile = line => {
  try {
    return new RegExp(line, 'gm')
  } catch {
    return null
  }
}

/**
 * Read filters from their text: a regular expression to a line. Blank lines
 * are skipped, and so is a line that is not a regular expression.
 *
 * @param {string|null|undefined} text
 * @returns {RegExp[]}
 */
export function parseFilters(text) {
  return linesOf(text)
    .map(compile)
    .filter(pattern => pattern !== null)
}

/**
 * Whether every line of the text is a regular expression.
 *
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function filtersValid(text) {
  return linesOf(text).every(line => compile(line) !== null)
}

/**
 * Where the filters match in some text, in order, joined where they touch
 * or overlap.
 *
 * @param {string} text
 * @param {RegExp[]} filters
 * @returns {Range[]}
 */
export function filteredRanges(text, filters) {
  /** @type {Range[]} */
  const found = []
  for (const filter of filters) {
    for (const match of text.matchAll(filter)) {
      if (match[0]) found.push({ from: match.index, to: match.index + match[0].length })
    }
  }
  found.sort((a, b) => a.from - b.from)

  /** @type {Range[]} */
  const ranges = []
  for (const range of found) {
    const last = ranges.at(-1)
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to)
    else ranges.push({ ...range })
  }
  return ranges
}

/**
 * The text in pieces, in order: what the filters match and what they leave,
 * to show the one apart from the other.
 *
 * @param {string} text
 * @param {RegExp[]} filters
 * @returns {Piece[]}
 */
export function piecesOf(text, filters) {
  /** @type {Piece[]} */
  const pieces = []
  let at = 0
  for (const { from, to } of filteredRanges(text, filters)) {
    if (from > at) pieces.push({ text: text.slice(at, from), filtered: false })
    pieces.push({ text: text.slice(from, to), filtered: true })
    at = to
  }
  if (at < text.length) pieces.push({ text: text.slice(at), filtered: false })
  return pieces
}

/**
 * The text with whatever the filters match taken out. Empty when they match
 * all of it, or all of it but space.
 *
 * @param {string} text
 * @param {RegExp[]} filters
 * @returns {string}
 */
export function applyFilters(text, filters) {
  if (filters.length === 0) return text
  return piecesOf(text, filters)
    .filter(piece => !piece.filtered)
    .map(piece => piece.text)
    .join('')
    .trim()
}
