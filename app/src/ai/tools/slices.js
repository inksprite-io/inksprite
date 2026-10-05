/**
 * @module ai/tools/slices
 * @description A long document, read a slice at a time.
 *
 * A read has a budget, and a document longer than it comes back one slice at
 * a time: a bounded run of text with the offset it started at, the offset to
 * go on from, and how long the whole is. The offset is the one unit that
 * works for every document — a novel with no headings, a paper with pages, a
 * saved page with sections — and everything else here is a way of naming an
 * offset: a page, for a PDF whose text carries `[p.N]` markers; a heading,
 * for Markdown that has them. Neither decides how much is read. A slice ends
 * at a paragraph break where it can, so what the model sees reads as prose.
 *
 * Nothing here knows about documents or tools; it takes text and numbers.
 */

import { linker, markdownSections } from '@/utils/sections.js'

/**
 * How much of a document one read returns, in characters: about ten thousand
 * tokens of English prose. A document up to this long is read whole; a
 * longer one is read in slices and cannot be kept.
 */
export const READ_BUDGET = 40000

/** How far back from the budget a slice may stop to end at a paragraph. */
const SLACK = 4000

/** A page marker as `files/pdf.js` writes one: on a line of its own. */
const PAGE_MARKER = /^\[p\.(\d+)\]$/gm

/** A Markdown heading line. */
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm

/**
 * Whether a document is too long for one read.
 * @param {string} text
 * @returns {boolean}
 */
export const isLong = text => text.length > READ_BUDGET

/**
 * One slice of a text, starting at an offset.
 *
 * @typedef {Object} Slice
 * @property {string} text
 * @property {number} from - Where it starts, as an offset into the whole
 * @property {number} to - Where it ends, exclusive
 * @property {number} length - The whole text's length
 * @property {number|null} next - Where the next slice starts, or null at the end
 */

/**
 * The slice of a text that starts at `from` and fits the budget.
 *
 * The end is pulled back to the last paragraph break in the final stretch of
 * the budget, so a slice does not stop mid-sentence unless the text has no
 * breaks to stop at. An offset past the end gives an empty slice at the end.
 *
 * @param {string} text
 * @param {number} [from]
 * @param {number} [budget]
 * @returns {Slice}
 */
export function sliceAt(text, from = 0, budget = READ_BUDGET) {
  const length = text.length
  const start = Math.min(Math.max(0, Math.floor(from) || 0), length)
  if (length - start <= budget) {
    return { text: text.slice(start), from: start, to: length, length, next: null }
  }

  let end = start + budget
  const floor = Math.max(start + 1, end - SLACK)
  const paragraph = text.lastIndexOf('\n\n', end)
  if (paragraph >= floor) end = paragraph
  else {
    const line = text.lastIndexOf('\n', end)
    if (line >= floor) end = line
  }

  return { text: text.slice(start, end), from: start, to: end, length, next: end }
}

/**
 * The offset a page starts at: its marker line, so the slice opens with the
 * page's number. Null when the text has no such page.
 *
 * @param {string} text
 * @param {number} page - Counted from one
 * @returns {number|null}
 */
export function offsetOfPage(text, page) {
  for (const match of text.matchAll(PAGE_MARKER)) {
    if (Number(match[1]) === page) return match.index ?? null
  }
  return null
}

/**
 * The page an offset falls on: the last marker at or before it. Null when
 * the text has no page markers before that point.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {number|null}
 */
export function pageAt(text, offset) {
  let page = null
  for (const match of text.matchAll(PAGE_MARKER)) {
    if ((match.index ?? 0) > offset) break
    page = Number(match[1])
  }
  return page
}

/**
 * A heading in a text, with where it is.
 *
 * @typedef {Object} Heading
 * @property {string} title
 * @property {number} level - 1 for `#` or a chapter, 2 for `##` or `4.1`, and so on
 * @property {number} offset - Where its line starts
 * @property {string} [number] - Its number, `4` or `4.1.1`, for a numbered heading
 * @property {number|null} [page] - For a text with pages, the page it is on
 */

/** A chapter as a PDF's text has it: `Chapter 4` on a line, its title on the next. */
const CHAPTER = /^Chapter (\d+)\n(\S[^\n]{0,90}?)[ \t]*$/gm

/** A numbered heading on a line of its own: `4.1 Early Results`, `4.1.1 Sampling`. */
const NUMBERED = /^(\d+(?:\.\d+)*) ([A-Z][^\n]{1,90}?)[ \t]*$/gm

/**
 * A line from a table of contents or a list of figures rather than a heading:
 * dot leaders, or a page number at the end.
 */
const CONTENTS_LINE = /(\. ){2,}|\s\d+$/

/** How many headings the map carries at most; a long map is its own cost. */
const MAP_LIMIT = 120

/**
 * The headings a text has, in order, each with its offset.
 *
 * A map of the document for a model deciding where to read, presented as
 * what it is: the heading lines the text happens to have. Markdown headings
 * where the text has them; otherwise the numbered headings a paper or a
 * dissertation carries in its extracted text — `Chapter 4` with its title on
 * the next line, `4.1 Early Results` on a line of its own — with the
 * table of contents and the list of figures left out, since those name the
 * headings without being them. A text with neither gets an empty map, and
 * the offsets still work.
 *
 * @param {string} text
 * @param {number} [limit] - At most this many
 * @returns {Heading[]}
 */
export function headingsOf(text, limit = MAP_LIMIT) {
  const paged = pageAt(text, text.length) !== null
  const place = (/** @type {Heading} */ heading) => ({
    ...heading,
    ...(paged ? { page: pageAt(text, heading.offset) } : {}),
  })

  /** @type {Heading[]} */
  const marked = []
  for (const match of text.matchAll(HEADING)) {
    if (marked.length >= limit) break
    marked.push(place({ title: match[2].trim(), level: match[1].length, offset: match.index ?? 0 }))
  }
  const numbered = trimMap(numberedHeadings(text).map(place), limit)

  // A text with pages came out of a PDF, whose `#` lines are code comments
  // in a listing, never headings; its structure is in its numbers. Prose
  // written as Markdown is the other way about.
  if (paged) return numbered.length > 0 ? numbered : marked
  return marked.length > 0 ? marked : numbered
}

/**
 * The numbered headings of a text whose structure is in its numbers.
 *
 * Everything before the first `Chapter N` line is front matter — the
 * contents, the list of figures — and its numbered lines are skipped, which
 * is what keeps a figure caption's entry out of the map. A number seen twice
 * keeps its first place: a running header repeats a section's line at the
 * top of every page, and the first is the section.
 *
 * @param {string} text
 * @returns {Heading[]} In order of offset
 */
function numberedHeadings(text) {
  /** @type {Heading[]} */
  const found = []
  for (const match of text.matchAll(CHAPTER)) {
    found.push({
      title: match[2].trim(),
      level: 1,
      number: match[1],
      offset: match.index ?? 0,
    })
  }
  const body = found.length > 0 ? found[0].offset : 0

  for (const match of text.matchAll(NUMBERED)) {
    const offset = match.index ?? 0
    if (offset < body || CONTENTS_LINE.test(match[0])) continue
    const number = match[1]
    // With chapters, a bare number on a line is a sentence that happens to
    // start with a year or a count, not a heading; the chapters are level one.
    if (found.length > 0 && !number.includes('.')) continue
    if (found.some(heading => heading.number === number)) continue
    found.push({
      title: match[2].trim(),
      level: number.split('.').length,
      number,
      offset,
    })
  }
  return found.sort((a, b) => a.offset - b.offset)
}

/**
 * A map cut to size: the chapters and sections whole, then the subsections
 * as far as the limit allows, in document order.
 *
 * @param {Heading[]} headings
 * @param {number} limit
 * @returns {Heading[]}
 */
function trimMap(headings, limit) {
  if (headings.length <= limit) return headings
  const coarse = headings.filter(heading => heading.level <= 2)
  if (coarse.length >= limit) return coarse.slice(0, limit)
  const fine = headings.filter(heading => heading.level > 2).slice(0, limit - coarse.length)
  return [...coarse, ...fine].sort((a, b) => a.offset - b.offset)
}

/**
 * A section of a text: a heading, and where the next heading at its level or
 * above begins.
 *
 * @typedef {Object} Section
 * @property {Heading} heading
 * @property {number} until - The offset the section runs to, exclusive
 */

/**
 * The section a reference names: a heading's number (`4`, `4.1`, `Chapter 4`)
 * or a piece of its title, case aside. Null when nothing matches.
 *
 * @param {Heading[]} headings
 * @param {string} reference
 * @param {number} length - The whole text's length, for the last section
 * @returns {Section|null}
 */
export function sectionOf(headings, reference, length) {
  const wanted = reference
    .trim()
    .replace(/^chapter\s+/i, '')
    .replace(/\.$/, '')
  if (!wanted) return null
  const lower = wanted.toLowerCase()
  const at =
    headings.findIndex(heading => heading.number === wanted) >= 0
      ? headings.findIndex(heading => heading.number === wanted)
      : headings.findIndex(heading => heading.title.toLowerCase().includes(lower))
  if (at < 0) return null

  const heading = headings[at]
  const next = headings.slice(at + 1).find(other => other.level <= heading.level)
  return { heading, until: next ? next.offset : length }
}

/**
 * A count of words, the way the listing counts them, for saying how long a
 * slice or a whole is in the unit the listing uses.
 *
 * @param {string} text
 * @returns {number}
 */
export function wordsIn(text) {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * A text's sections, each with the link it is read by: its Markdown
 * headings, the way `utils/sections.js` reads them — or, for a PDF's text as
 * the importer wrote it, which has pages and keeps its structure in its
 * numbers, its numbered headings, `4.1 Early Results` read as a section
 * titled with its number.
 *
 * @param {string} text
 * @returns {import('@/utils/sections.js').MarkdownSection[]}
 */
export function sectionsOfText(text) {
  const paged = pageAt(text, text.length) !== null
  if (!paged) {
    const marked = markdownSections(text)
    if (marked.length > 0) return marked
  }
  const headings = headingsOf(text, Infinity)
  const link = linker()
  return headings.map((heading, at) => {
    const title = heading.number ? `${heading.number} ${heading.title}` : heading.title
    const end = at + 1 < headings.length ? headings[at + 1].offset : text.length
    const next = headings.slice(at + 1).find(other => other.level <= heading.level)
    const until = next ? next.offset : text.length
    return {
      title,
      level: heading.level,
      link: link(title),
      offset: heading.offset,
      end,
      until,
      words: wordsIn(text.slice(heading.offset, until)),
    }
  })
}
