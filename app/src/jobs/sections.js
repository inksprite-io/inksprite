/**
 * @module jobs/sections
 * @description A document's sections, decided before any of it is converted.
 *
 * A conversion that finds structure a chunk at a time finds a different one
 * in every chunk. Here the whole tree is settled first — from the PDF's own
 * bookmarks where it has them, and otherwise by one request that reads the
 * whole text and names its headings — and the text is then cut along it:
 * each request is a section, or a run of small ones, with its headings
 * already written in as Markdown. The model converts what is under them;
 * the structure is not its to choose.
 *
 * Everything here is pure. The text arrives as lines — a PDF's with the size
 * each is set in and the page it is on, a text document's with neither.
 */

import structurePrompt from '@/ai/prompts/structure.md?raw'

/**
 * A line of the source, where it came from.
 *
 * @typedef {Object} SourceLine
 * @property {string} text - '' for a paragraph break
 * @property {number|null} page - Counted from one; null for a text without pages
 * @property {number} size - The size it is set in; 0 when unknown
 * @property {number} [y] - Its height on the page, for placing a bookmark that names no line
 * @property {boolean} [bold] - Set in a bold face throughout
 */

/**
 * A heading of the tree, placed on the source.
 *
 * @typedef {Object} PlannedHeading
 * @property {string} title
 * @property {number} level - 1 to 6
 * @property {number} line - The line it starts at: its own printed line, or
 *   the line it is placed before when the source does not print it
 * @property {number} consumed - How many source lines are the printed
 *   heading, and so are not body text; 0 when it is not printed
 */

/**
 * A stretch of the source that is converted as one: a section's body, or
 * part of one too long for a request.
 *
 * @typedef {Object} Unit
 * @property {number|null} heading - Index into the headings; null for what comes before the first
 * @property {number} from - First body line
 * @property {number} to - Exclusive
 * @property {number} part - 0 for the part that opens with the heading
 */

/**
 * What one request converts.
 *
 * @typedef {Object} Request
 * @property {string} id
 * @property {Unit[]} units
 */

/**
 * How much source one request carries, in characters: about six thousand
 * tokens of English, which comes back as about as many.
 */
export const REQUEST_CHARS = 24000

/** How much text the structure request reads whole; past it, only the lines that could be headings. */
export const STRUCTURE_CHARS = 400000

/** The deepest a heading goes in Markdown. */
const DEEPEST = 6

// ---------------------------------------------------------------------------
// The source, as lines
// ---------------------------------------------------------------------------

/**
 * The lines of a PDF's layout, page after page. Nothing marks a page break
 * in the text; each line carries its page.
 *
 * @param {import('@/files/pdf.js').PdfLayout} layout
 * @returns {SourceLine[]}
 */
export function linesOfLayout(layout) {
  /** @type {SourceLine[]} */
  const lines = []
  for (const page of layout.pages) {
    for (const line of page.lines) {
      lines.push({
        text: line.text,
        page: page.number,
        size: line.size,
        y: line.y,
        ...(line.bold ? { bold: true } : {}),
      })
    }
  }
  return lines
}

/**
 * The lines of a stored text. A PDF's text as the importer wrote it carries
 * `[p.N]` markers; they become each line's page and leave the text.
 *
 * @param {string} text
 * @returns {SourceLine[]}
 */
export function linesOfText(text) {
  /** @type {SourceLine[]} */
  const lines = []
  /** @type {number|null} */
  let page = null
  for (const raw of text.split('\n')) {
    const marker = raw.match(/^\[p\.(\d+)\]$/)
    if (marker) {
      page = Number(marker[1])
      continue
    }
    const clean = raw.replace(/[ \t\u00a0]+/g, ' ').trim()
    if (!clean && (lines.length === 0 || lines[lines.length - 1].text === '')) continue
    lines.push({ text: clean, page, size: 0 })
  }
  while (lines.length > 0 && lines[lines.length - 1].text === '') lines.pop()
  return lines
}

/**
 * The size the body is set in: the one most characters have.
 *
 * @param {SourceLine[]} lines
 * @returns {number} 0 when the lines carry no sizes
 */
export function bodySize(lines) {
  /** @type {Map<number, number>} */
  const chars = new Map()
  for (const line of lines) {
    if (line.size > 0) chars.set(line.size, (chars.get(line.size) || 0) + line.text.length)
  }
  let best = 0
  let most = -1
  for (const [size, count] of chars) {
    if (count > most) {
      most = count
      best = size
    }
  }
  return best
}

/**
 * A heading's words, for comparing a bookmark with a printed line: letters
 * and digits only, lower case, accents aside.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function wordsOfTitle(text) {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  )
}

/**
 * How a printed line stands to a heading's title: `whole` when it is the
 * heading — the title itself, or the title after a short label such as a
 * number or `Core Lineage:` — `start` when it is the first line of a heading
 * that wraps, and null when it is not the heading.
 *
 * @param {string[]} line - The line's words
 * @param {string[]} title - The title's words
 * @param {string} [text] - The line as printed, for telling a gloss from more words
 * @returns {'whole'|'start'|null}
 */
export function titleMatch(line, title, text = '') {
  if (line.length === 0 || title.length === 0) return null
  const same = (/** @type {number} */ at) => title.every((word, i) => line[at + i] === word)
  if (line.length >= title.length) {
    const extra = line.length - title.length
    if (extra === 0) return same(0) ? 'whole' : null
    // A label before the title — `3.2`, `Core Lineage:` — or a page number
    // after it; not a longer heading that starts with a one-word title.
    if (extra <= 3 && same(extra)) return 'whole'
    if (same(0) && line.slice(title.length).every(word => /^\d+$/.test(word))) return 'whole'
    // The title and a short gloss in brackets: `Might (MT):`.
    if (same(0) && extra <= 2 && /^[^(]*\([^)]*\)[\s:.]*$/.test(text)) return 'whole'
    return null
  }
  if (line.length >= 2 && line.every((word, i) => title[i] === word)) return 'start'
  return null
}

/**
 * How many lines from `at` make up the printed heading, when it wraps over
 * several: the first, and each after it while the title goes on.
 *
 * @param {SourceLine[]} lines
 * @param {number} at
 * @param {string[]} title
 * @returns {number}
 */
function wrappedLength(lines, at, title) {
  let words = wordsOfTitle(lines[at].text)
  let count = 1
  while (words.length < title.length && at + count < lines.length) {
    const next = wordsOfTitle(lines[at + count].text)
    if (next.length === 0) break
    const joined = words.concat(next)
    if (!joined.every((word, i) => i >= title.length || title[i] === word)) break
    words = joined
    count++
  }
  return words.length >= title.length ? count : 0
}

/** A number a heading is printed with: `4.1.6`, `IV`, `Chapter 4`, `Part II`. */
const NUMBER = /^(?:(?:chapter|part|section|book|appendix)\s+)?(?:\d+(?:\.\d+)*|[IVXLC]+)\.?$/i

/**
 * A bookmark's title with the number its heading is printed with, when the
 * page gives one and the bookmark leaves it out — `Chapter 4: Early Results`,
 * `4.1.6 Sampling` — so a reader asking for chapter 4 or section 4.1.6 finds
 * it by name.
 *
 * @param {string} title - The bookmark's
 * @param {string|null} above - A label line printed above the heading
 * @param {string} printed - The heading's own printed line
 */
function numbered(title, above, printed) {
  if (/^\s*(?:(?:chapter|part|section|appendix)\s+)?[\dIVXLC]+(?:\.\d+)*\b/i.test(title))
    return title
  if (above && NUMBER.test(above.trim())) {
    const label = above.trim().replace(/\.$/, '')
    return /^\d/.test(label) ? `${label} ${title}` : `${label}: ${title}`
  }
  const lead = printed.trim().match(/^((?:\d+(?:\.\d+)*|[IVXLC]+)\.?)\s+\S/)
  if (
    lead &&
    wordsOfTitle(printed.trim().slice(lead[1].length)).join(' ') === wordsOfTitle(title).join(' ')
  ) {
    return `${lead[1].replace(/\.$/, '')} ${title}`
  }
  return title
}

/** A line that labels the heading after it: `Chapter 4`, `Part II`, `4`. */
const LABEL = /^(?:(?:chapter|part|section|book|appendix)\s+[\p{L}\p{N}]+|[\p{N}IVXLC]+\.?)$/iu

/**
 * Place the PDF's bookmarks on its lines.
 *
 * Each bookmark is looked for on the page it points at, and the page after,
 * from where the one before it was placed onward — and failing that,
 * earlier on its page, since an outline can list a heading after ones the
 * page prints below it: the printed line that is its heading, or the
 * lines, when the heading wraps. A label line just above — `Chapter 4` over
 * the chapter's title — goes with it. The headings come back in the order
 * the text has them.
 *
 * A bookmark whose heading is not printed there is written in without
 * taking a line from the text. One that groups the bookmarks after it —
 * `Core` over `Dwarf` and `Elf`, pointing at a table on the page before —
 * goes just before its first child, which is where its section starts. Any
 * other goes at the height on the page it points to, kept between its
 * neighbours.
 *
 * @param {SourceLine[]} lines
 * @param {import('@/files/pdf.js').Bookmark[]} outline
 * @returns {PlannedHeading[]}
 */
export function placeBookmarks(lines, outline) {
  /** @type {Map<number, number>} */
  const pageStart = new Map()
  /** @type {Map<number, number>} */
  const pageEnd = new Map()
  lines.forEach((line, at) => {
    if (line.page === null) return
    if (!pageStart.has(line.page)) pageStart.set(line.page, at)
    pageEnd.set(line.page, at + 1)
  })

  const levelOf = (/** @type {number} */ index) =>
    Math.min(DEEPEST, Math.max(1, outline[index].level))

  /** Lines already taken as some bookmark's heading. */
  const taken = new Set()

  /**
   * The printed heading of a bookmark, on its page or the next: looked for
   * from `floor` on first, and then earlier on the page — an outline need
   * not list its bookmarks in the order the pages print them.
   * @param {number} index
   * @param {number} floor
   * @returns {PlannedHeading|null}
   */
  const printed = (index, floor) => {
    const bookmark = outline[index]
    const title = wordsOfTitle(bookmark.title)
    const pages = [bookmark.page, bookmark.page + 1]
    // Earlier on the page only the title itself will do: a table there
    // has rows like `2 Core` that a label before a short title would take.
    /** @type {Array<[number, number, boolean]>} */
    const spans = [
      ...pages.map(
        page =>
          /** @type {[number, number, boolean]} */ ([
            Math.max(floor, pageStart.get(page) ?? Infinity),
            pageEnd.get(page) ?? -1,
            false,
          ])
      ),
      [
        pageStart.get(bookmark.page) ?? Infinity,
        Math.min(floor, pageEnd.get(bookmark.page) ?? -1),
        true,
      ],
    ]
    for (const [start, end, strict] of spans) {
      for (let at = start; at < end; at++) {
        if (taken.has(at)) continue
        const words = wordsOfTitle(lines[at].text)
        if (strict && words.join(' ') !== title.join(' ')) continue
        const match = titleMatch(words, title, lines[at].text)
        if (!match) continue
        const consumed = match === 'whole' ? 1 : wrappedLength(lines, at, title)
        if (consumed === 0) continue
        // `Chapter 4` on the line above the title is the same heading.
        const label =
          at > 0 &&
          !taken.has(at - 1) &&
          lines[at - 1].page === lines[at].page &&
          LABEL.test(lines[at - 1].text)
        return {
          title: numbered(bookmark.title, label ? lines[at - 1].text : null, lines[at].text),
          level: levelOf(index),
          line: label ? at - 1 : at,
          consumed: label ? consumed + 1 : consumed,
        }
      }
    }
    return null
  }

  /**
   * An unprinted bookmark at the height it points to, between `low` and `high`.
   * @param {number} index
   * @param {number} low
   * @param {number} high
   * @returns {PlannedHeading}
   */
  const byHeight = (index, low, high) => {
    const bookmark = outline[index]
    const start = pageStart.get(bookmark.page)
    const end = pageEnd.get(bookmark.page)
    let at = start ?? low
    if (start !== undefined && end !== undefined && bookmark.top !== null) {
      while (at < end && (lines[at].y ?? -Infinity) > bookmark.top + 1) at++
    }
    return {
      title: bookmark.title,
      level: levelOf(index),
      line: Math.min(Math.max(at, low), high),
      consumed: 0,
    }
  }

  /** @type {PlannedHeading[]} */
  const placed = new Array(outline.length)
  /** @type {number[]} */
  let waiting = []
  let floor = 0

  /**
   * Place the bookmarks waiting for a printed heading, now that the next
   * printed one is at `high`, whose level is `level`.
   * @param {number} high
   * @param {number} level
   */
  const settle = (high, level) => {
    let low = floor
    for (const index of waiting) {
      placed[index] =
        levelOf(index) < level
          ? { title: outline[index].title, level: levelOf(index), line: high, consumed: 0 }
          : byHeight(index, low, high)
      low = placed[index].line
    }
    waiting = []
  }

  outline.forEach((_, index) => {
    const found = printed(index, floor)
    if (!found) {
      waiting.push(index)
      return
    }
    for (let at = found.line; at < found.line + found.consumed; at++) taken.add(at)
    placed[index] = found
    // One printed before where the outline has got to is placed where it
    // is printed, and the rest go on from where they were.
    if (found.line < floor) return
    settle(found.line, found.level)
    floor = found.line + found.consumed
  })
  settle(lines.length, 0)
  // The text's order, which is the order the Markdown will have them in;
  // the outline's where two share a line.
  return placed
    .map((heading, index) => ({ heading, index }))
    .sort((a, b) => a.heading.line - b.heading.line || a.index - b.index)
    .map(({ heading }) => heading)
}

// ---------------------------------------------------------------------------
// Running headers, and headings from how the page sets them
// ---------------------------------------------------------------------------

/**
 * A line as it compares with others of its kind: lower case, digits as one
 * mark, so `Chapter 3 · 41` and `Chapter 3 · 42` read the same.
 * @param {string} text
 */
const runningKey = text =>
  text
    .toLowerCase()
    .replace(/\d+/g, '#')
    // Spacing aside: one PDF sets its footer as `F ield G uide`.
    .replace(/\s+/g, '')

/** How much of a page, top and bottom, a running header or footer sits in. */
const MARGIN = 0.1

/** How near two lines' heights have to be to be the same place on the page. */
const RUNNING_BUCKET = 12

/** How far inside the page's outermost text a line may sit and still be outermost. */
const EDGE_SLACK = 2

/**
 * The lines that are running headers and footers: the same text, page
 * numbers aside, at the same height in the top or bottom tenth of the page
 * with nothing further out, on a fifth of the pages — or on three pages
 * running, when it carries a page number. A page number alone is one of them.
 * What a book repeats in its margins is furniture, not text; left in, it
 * breaks a table that runs over a page and reads as a heading.
 *
 * @param {SourceLine[]} lines
 * @param {Map<number, number>} heights - Each page's height, by page number
 * @returns {Set<number>} The lines' indices
 */
export function runningLines(lines, heights) {
  const threshold = Math.max(3, heights.size * 0.2)
  const running = new Set()
  // Peeled from the edge in: a footer's title is outermost once the page
  // number under it is taken.
  for (let pass = 0; pass < 3; pass++) {
    // Further in, only what is on most pages: a footer's title is, and a
    // table that often starts a column is not.
    const found = runningAtEdge(
      lines,
      heights,
      running,
      pass === 0 ? threshold : heights.size * 0.5,
      pass === 0
    )
    if (found.length === 0) break
    for (const index of found) running.add(index)
  }
  return running
}

/**
 * The running lines at the edge of the text left: the outermost of each
 * page, top and bottom, that repeat.
 *
 * @param {SourceLine[]} lines
 * @param {Map<number, number>} heights
 * @param {Set<number>} gone - Lines already taken, as if not there
 * @param {number} threshold - How many pages a line has to be on
 * @param {boolean} streaks - Whether three numbered pages running are enough
 * @returns {number[]}
 */
function runningAtEdge(lines, heights, gone, threshold, streaks) {
  /** @type {Map<number, {top: number, bottom: number}>} */
  const edges = new Map()
  lines.forEach((line, at) => {
    if (!line.text || gone.has(at) || line.page === null || line.y === undefined) return
    const edge = edges.get(line.page) || { top: -Infinity, bottom: Infinity }
    edge.top = Math.max(edge.top, line.y)
    edge.bottom = Math.min(edge.bottom, line.y)
    edges.set(line.page, edge)
  })

  /** @type {Map<string, {pages: Set<number>, at: number[], numbered: boolean}>} */
  const seen = new Map()
  lines.forEach((line, at) => {
    if (gone.has(at)) return
    const height = line.page === null ? undefined : heights.get(line.page)
    const edge = line.page === null ? undefined : edges.get(line.page)
    if (!line.text || !height || !edge || line.y === undefined) return
    const top = line.y >= height * (1 - MARGIN) && line.y >= edge.top - EDGE_SLACK
    const bottom = line.y <= height * MARGIN && line.y <= edge.bottom + EDGE_SLACK
    if (!top && !bottom) return
    // At the same height, too: a table that falls at the top of a column
    // repeats its layout there, but not in the same place every time.
    const key = `${runningKey(line.text)}@${Math.round(line.y / RUNNING_BUCKET)}`
    const entry = seen.get(key) || { pages: new Set(), at: [], numbered: /\d/.test(line.text) }
    entry.pages.add(/** @type {number} */ (line.page))
    entry.at.push(at)
    seen.set(key, entry)
  })

  /** @type {number[]} */
  const found = []
  for (const { pages, at, numbered } of seen.values()) {
    const sorted = [...pages].sort((a, b) => a - b)
    // Three pages running is enough for a line that carries its page's
    // number — a chapter's running title — and not for one that does not.
    const streak = streaks && numbered && sorted.some((page, i) => sorted[i + 2] === page + 2)
    if (pages.size >= threshold || streak) found.push(...at)
  }
  return found
}

/** Sizes within this share of each other are one size; a glyph's height jitters. */
const SAME_SIZE = 0.05

/** @param {number} a @param {number} b */
const larger = (a, b) => a > b * (1 + SAME_SIZE)

/**
 * Whether one line is set heavier than another: larger, or as large and
 * bold where the other is not — a heading at the body's size over the body.
 *
 * @param {{size: number, bold?: boolean}} a
 * @param {{size: number, bold?: boolean}} b
 */
const outranks = (a, b) =>
  larger(a.size, b.size) || (!larger(b.size, a.size) && Boolean(a.bold) && !b.bold)

/**
 * Whether two lines are set the same way: the same size and weight.
 * @param {{size: number, bold?: boolean}} a
 * @param {{size: number, bold?: boolean}} b
 */
const setAlike = (a, b) =>
  !larger(a.size, b.size) && !larger(b.size, a.size) && Boolean(a.bold) === Boolean(b.bold)

/**
 * Whether a line could be a heading by how it is set: larger than the body,
 * short, and reading like a title — not a sentence's end, a label, a
 * caption, or a line of a table of contents.
 *
 * @param {SourceLine|undefined} line
 * @param {number} body
 */
const setAsHeading = (line, body) =>
  Boolean(line) &&
  Boolean(line?.text) &&
  ((larger(line.size, body) && line.size - body >= 0.8) ||
    (Boolean(line.bold) && !larger(body, line.size))) &&
  line.text.length <= 60 &&
  /\p{L}/u.test(line.text) &&
  !/[.,;:]$/.test(line.text) &&
  !/^\p{Ll}/u.test(line.text) &&
  !/\.{3,}|…|\. \. \./.test(line.text) &&
  !/^(figure|fig\.|table|plate)\s*\d/i.test(line.text) &&
  !/intentionally (left )?blank/i.test(line.text)

/**
 * The next line with text after `at`, within a few.
 * @param {SourceLine[]} lines
 * @param {number} at
 */
const nextWithText = (lines, at) => {
  for (let i = at + 1; i < lines.length && i <= at + 3; i++) if (lines[i].text) return i
  return -1
}

/**
 * The previous line with text before `at`, within a few.
 * @param {SourceLine[]} lines
 * @param {number} at
 */
const previousWithText = (lines, at) => {
  for (let i = at - 1; i >= 0 && i >= at - 3; i--) if (lines[i].text) return i
  return -1
}

/**
 * The headings a page's type makes, below and between the ones the
 * bookmarks name: a line set larger than the body, short, and followed by
 * smaller text — a spell's name over its description, a monster's over its
 * stat block. Two such lines of one size in a row, the second followed by
 * smaller text, are one heading set over two lines; three or more are a
 * table's header, not a heading.
 *
 * Each takes its level from where it sits: one below the nearest heading
 * before it that is set larger — a bookmark or another of these — so every
 * spell under `Spell Descriptions` is one level below it, whichever part of
 * the book it is in — and never out of the section of the bookmark it is in. Nothing before the first bookmark counts, when there
 * are bookmarks: that is the title page.
 *
 * @param {SourceLine[]} lines
 * @param {PlannedHeading[]} marked - The headings already placed, from bookmarks
 * @returns {PlannedHeading[]} Every heading, the marked ones and these, in text order
 */
export function styleHeadings(lines, marked) {
  const body = bodySize(lines)
  if (body <= 0) return marked
  const taken = new Set()
  for (const heading of marked) {
    for (let at = heading.line; at < heading.line + heading.consumed; at++) taken.add(at)
  }
  const start = marked.length > 0 ? marked[0].line : 0

  /** @type {PlannedHeading[]} */
  const found = []
  for (let at = start; at < lines.length; at++) {
    const line = lines[at]
    if (taken.has(at) || !setAsHeading(line, body)) continue
    // A line set the same way just before: this is the second line of a
    // heading set over two, a row of a table's header, or a line of a bold
    // paragraph.
    const before = previousWithText(lines, at)
    if (before >= 0 && !taken.has(before) && setAlike(lines[before], line)) continue
    let consumed = 1
    let next = nextWithText(lines, at)
    if (next >= 0 && !outranks(line, lines[next])) {
      // Set over two lines: the second set the same, and lighter text after.
      const same = setAlike(lines[next], line) && setAsHeading(lines[next], body)
      const after = same ? nextWithText(lines, next) : -1
      if (!same || taken.has(next) || (after >= 0 && !outranks(line, lines[after]))) continue
      consumed = next - at + 1
      next = after
    }
    if (next < 0) continue
    const title = lines
      .slice(at, at + consumed)
      .map(one => one.text)
      .filter(Boolean)
      .join(' ')
    found.push({ title, level: DEEPEST, line: at, consumed })
    at += consumed - 1
  }
  if (found.length === 0) return marked

  // Levels, in text order. A bookmark keeps its own. A heading found here
  // is a sibling of the last heading in its bookmark's section set the same
  // way — its own size, and the size of the text under it — and takes that
  // one's place in the tree, closing whatever came between: a stat block
  // set large in the middle of the spells does not take the spells after
  // it as its own. Otherwise it goes one below the nearest open heading set
  // larger.
  const all = [
    ...marked.map(heading => ({ heading, fixed: true })),
    ...found.map(heading => ({ heading, fixed: false })),
  ]
    .sort((a, b) => a.heading.line - b.heading.line || Number(!a.fixed) - Number(!b.fixed))
    .map(entry => ({ ...entry, look: lookOf(lines, entry.heading) }))

  /** @typedef {{level: number, look: Look, fixed: boolean}} Open */
  /** @type {Open[]} */
  let open = []
  /** The headings placed so far, each with the open headings above it then. @type {Array<{entry: Open, above: Open[]}>} */
  const placed = []
  return all.map(({ heading, fixed, look }) => {
    if (fixed) {
      while (open.length > 0 && open[open.length - 1].level >= heading.level) open.pop()
      const entry = { level: heading.level, look, fixed: true }
      placed.push({ entry, above: open.slice() })
      open.push(entry)
      return heading
    }
    /** @type {{entry: Open, above: Open[]}|null} */
    let sibling = null
    // An open heading set the same way, a bookmark's own included: a group
    // the bookmarks leave out is a sibling of the groups they name.
    for (let i = open.length - 1; i >= 0 && !sibling; i--) {
      if (sameLook(open[i].look, look)) sibling = { entry: open[i], above: open.slice(0, i) }
    }
    // Or one closed since, within its bookmark's section.
    for (let i = placed.length - 1; i >= 0 && !sibling; i--) {
      if (placed[i].entry.fixed) break
      if (sameLook(placed[i].entry.look, look)) sibling = placed[i]
    }
    let level
    if (sibling) {
      level = sibling.entry.level
      open = sibling.above.slice()
    } else {
      // Never out of a bookmark's section: what the type finds inside it is
      // under it, whatever size the bookmark's own heading is printed at.
      while (
        open.length > 0 &&
        !open[open.length - 1].fixed &&
        !outranks(open[open.length - 1].look, look)
      ) {
        open.pop()
      }
      const parent = open[open.length - 1]
      level = Math.min(DEEPEST, parent ? parent.level + 1 : 1)
    }
    const entry = { level, look, fixed: false }
    placed.push({ entry, above: open.slice() })
    open.push(entry)
    return { ...heading, level }
  })
}

/**
 * How a heading is set: its size, and the size of the text under it.
 *
 * @typedef {Object} Look
 * @property {number} size - Infinity for a bookmark the page does not print, above everything
 * @property {boolean} bold - Set in a bold face
 * @property {number} under - The size of the first text after it; NaN when there is none
 */

/**
 * How a heading is set. Two headings set alike are the same kind of heading —
 * two spells, two monsters — where size alone is not enough: a stat block's
 * `Actions` is set as large as a spell's name, but the text under it smaller.
 *
 * @param {SourceLine[]} lines
 * @param {PlannedHeading} heading
 * @returns {Look}
 */
function lookOf(lines, heading) {
  if (heading.consumed === 0) return { size: Infinity, bold: false, under: NaN }
  const next = nextWithText(lines, heading.line + heading.consumed - 1)
  return {
    size: lines[heading.line]?.size || Infinity,
    bold: Boolean(lines[heading.line]?.bold),
    under: next >= 0 ? lines[next].size : NaN,
  }
}

/**
 * Whether two headings are set alike.
 * @param {Look} a
 * @param {Look} b
 */
const sameLook = (a, b) =>
  Number.isFinite(a.size) &&
  Number.isFinite(a.under) &&
  setAlike(a, b) &&
  !larger(a.under, b.under) &&
  !larger(b.under, a.under)

/**
 * A PDF's lines and its section tree, as far as the file itself decides it:
 * the running headers and footers taken out, the bookmarks placed, and the
 * headings the type makes below them. Null headings when the PDF has no
 * bookmarks, for a model to find them instead.
 *
 * @param {import('@/files/pdf.js').PdfLayout} layout
 * @returns {{lines: SourceLine[], headings: PlannedHeading[]|null, removed: number}}
 */
export function structureOfLayout(layout) {
  const all = linesOfLayout(layout)
  const heights = new Map(layout.pages.map(page => [page.number, page.height || 0]))
  const running = runningLines(all, heights)
  const lines = all.filter((_, at) => !running.has(at))
  if (layout.outline.length === 0) return { lines, headings: null, removed: running.size }
  const marked = placeBookmarks(lines, layout.outline)
  return { lines, headings: styleHeadings(lines, marked), removed: running.size }
}

// ---------------------------------------------------------------------------
// Headings from a model, for a text without bookmarks
// ---------------------------------------------------------------------------

/**
 * The messages that ask a model for a text's headings. Every line goes with
 * its number, and — for a PDF — a line set larger than the body carries its
 * size, which is the strongest sign of a heading there is. A text past the
 * budget sends only the lines that could be headings: short ones, set large
 * or standing alone.
 *
 * @param {Object} args
 * @param {string} args.title
 * @param {SourceLine[]} args.lines
 * @returns {Array<{role: string, content: string}>}
 */
export function structureMessages({ title, lines }) {
  const body = bodySize(lines)
  const total = lines.reduce((sum, line) => sum + line.text.length + 1, 0)
  const brief = total > STRUCTURE_CHARS
  /** @type {string[]} */
  const numbered = []
  lines.forEach((line, at) => {
    if (!line.text) return
    const large = body > 0 && line.size > body + 0.4
    if (brief) {
      const alone = at === 0 || lines[at - 1].text === ''
      if (line.text.length > 120 || !(large || alone)) return
    }
    numbered.push(`${at} ${large ? `[${line.size}] ` : ''}${line.text}`)
  })
  const sizes =
    body > 0
      ? `The body is set at size ${body}; a line set larger shows its size in brackets after its number. `
      : ''
  return [
    { role: 'system', content: structurePrompt.trim() },
    {
      role: 'user',
      content: `Document: ${title}\n\n${sizes}${brief ? 'The text is long, so only the lines that could be headings are listed. ' : ''}The lines, numbered:\n\n${numbered.join('\n')}`,
    },
  ]
}

/**
 * The headings a structure answer names, checked against the lines: each
 * on a line that exists, in order, at a level from 1 to 6. A heading that
 * wraps takes the lines its title runs over.
 *
 * @param {string} answer - One heading per line: `<line> <level> <title>`
 * @param {SourceLine[]} lines
 * @returns {PlannedHeading[]}
 * @throws {Error} When the answer names no headings the lines have
 */
export function parseStructure(answer, lines) {
  /** @type {PlannedHeading[]} */
  const headings = []
  let floor = 0
  for (const raw of answer.split('\n')) {
    const match = raw.trim().match(/^(\d+)\s+([1-6])\s+(.+)$/)
    if (!match) continue
    const line = Number(match[1])
    if (line < floor || line >= lines.length || !lines[line].text) continue
    const title = match[3].trim()
    const words = wordsOfTitle(title)
    const printed = titleMatch(wordsOfTitle(lines[line].text), words, lines[line].text)
    const consumed =
      printed === 'whole' ? 1 : printed === 'start' ? wrappedLength(lines, line, words) || 1 : 1
    headings.push({ title, level: Number(match[2]), line, consumed })
    floor = line + consumed
  }
  if (headings.length === 0) throw new Error('The answer named no headings the text has.')
  return headings
}

// ---------------------------------------------------------------------------
// Cutting the source along the tree
// ---------------------------------------------------------------------------

/**
 * The source's sections as stretches of lines: what comes before the first
 * heading, then each heading's body up to the next heading, whatever its
 * level. An empty stretch is kept when it has a heading, since the heading
 * is in the tree either way.
 *
 * @param {SourceLine[]} lines
 * @param {PlannedHeading[]} headings
 * @returns {Unit[]}
 */
export function unitsOf(lines, headings) {
  /** @type {Unit[]} */
  const units = []
  const first = headings.length > 0 ? headings[0].line : lines.length
  if (lines.slice(0, first).some(line => line.text)) {
    units.push({ heading: null, from: 0, to: first, part: 0 })
  }
  headings.forEach((heading, index) => {
    const from = Math.min(heading.line + heading.consumed, lines.length)
    const to = index + 1 < headings.length ? headings[index + 1].line : lines.length
    units.push({ heading: index, from, to: Math.max(from, to), part: 0 })
  })
  return units
}

/**
 * How many characters a run of lines is.
 * @param {SourceLine[]} lines
 * @param {number} from
 * @param {number} to
 */
const charsOf = (lines, from, to) => {
  let sum = 0
  for (let at = from; at < to; at++) sum += lines[at].text.length + 1
  return sum
}

/**
 * Where to cut a run of lines so the first piece is at most `budget`: at a
 * paragraph break if there is one in the last quarter, else at a page
 * break, else at a line.
 *
 * @param {SourceLine[]} lines
 * @param {number} from
 * @param {number} to
 * @param {number} budget
 * @returns {number} The first line of the second piece
 */
function cutPoint(lines, from, to, budget) {
  let end = from
  let used = 0
  while (end < to && used + lines[end].text.length + 1 <= budget) {
    used += lines[end].text.length + 1
    end++
  }
  if (end >= to) return to
  const floor = from + Math.max(1, Math.floor((end - from) * 0.75))
  for (let at = end; at > floor; at--) if (lines[at - 1].text === '') return at
  for (let at = end; at > floor; at--) if (lines[at].page !== lines[at - 1].page) return at
  return Math.max(from + 1, end)
}

/**
 * Split a unit too long for one request into parts that fit.
 *
 * @param {SourceLine[]} lines
 * @param {Unit} unit
 * @param {number} budget
 * @returns {Unit[]}
 */
export function splitUnit(lines, unit, budget) {
  /** @type {Unit[]} */
  const parts = []
  let from = unit.from
  let part = unit.part
  while (from < unit.to) {
    const to = cutPoint(lines, from, unit.to, budget)
    parts.push({ heading: unit.heading, from, to, part })
    from = to
    part++
  }
  return parts.length > 0 ? parts : [unit]
}

/**
 * Group the units into requests, in order, each up to the budget. A unit
 * longer than the budget is split into parts, and each part is a request
 * of its own.
 *
 * @param {SourceLine[]} lines
 * @param {Unit[]} units
 * @param {number} [budget]
 * @returns {Request[]}
 */
export function planRequests(lines, units, budget = REQUEST_CHARS) {
  /** @type {Request[]} */
  const requests = []
  /** @type {Unit[]} */
  let current = []
  let used = 0
  const close = () => {
    if (current.length > 0) requests.push({ id: `request-${requests.length + 1}`, units: current })
    current = []
    used = 0
  }
  for (const unit of units) {
    const size = charsOf(lines, unit.from, unit.to) + 80
    if (size > budget) {
      close()
      for (const part of splitUnit(lines, unit, budget)) {
        current = [part]
        close()
      }
      continue
    }
    if (used + size > budget) close()
    current.push(unit)
    used += size
  }
  close()
  return requests
}

/**
 * A heading as Markdown.
 * @param {PlannedHeading} heading
 */
export const headingLine = heading => `${'#'.repeat(heading.level)} ${heading.title}`

/**
 * The text a request sends: each unit's heading written in as Markdown, and
 * the body under it as the source has it, page breaks and all, but without
 * page markers — a table that runs over a page arrives in one piece.
 *
 * @param {SourceLine[]} lines
 * @param {Request} request
 * @param {PlannedHeading[]} headings
 * @returns {string}
 */
export function requestText(lines, request, headings) {
  return request.units
    .map(unit => {
      const body = lines
        .slice(unit.from, unit.to)
        .map(line => line.text)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      const head =
        unit.heading !== null && unit.part === 0 ? headingLine(headings[unit.heading]) : ''
      return [head, body].filter(Boolean).join('\n\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The headings a request's answer must carry, in order.
 *
 * @param {Request} request
 * @param {PlannedHeading[]} headings
 * @returns {PlannedHeading[]}
 */
export function givenHeadings(request, headings) {
  return request.units
    .filter(unit => unit.heading !== null && unit.part === 0)
    .map(unit => headings[/** @type {number} */ (unit.heading)])
}

/**
 * Where a request's text sits in the tree: the headings above its first
 * unit, outermost first. What the model is told so a continued section, or
 * a subsection on its own, reads in its place.
 *
 * @param {Request} request
 * @param {PlannedHeading[]} headings
 * @returns {PlannedHeading[]}
 */
export function ancestorsOf(request, headings) {
  const first = request.units[0]
  if (!first || first.heading === null) return []
  const index = first.heading
  const own = headings[index]
  /** @type {PlannedHeading[]} */
  const above = []
  let level = first.part > 0 ? own.level + 1 : own.level
  for (let at = first.part > 0 ? index : index - 1; at >= 0 && level > 1; at--) {
    if (headings[at].level < level) {
      above.unshift(headings[at])
      level = headings[at].level
    }
  }
  return above
}

/**
 * A request's label for the jobs toast: its first heading, and how many
 * more it carries, and its pages when it has them.
 *
 * @param {SourceLine[]} lines
 * @param {Request} request
 * @param {PlannedHeading[]} headings
 * @returns {string}
 */
export function requestLabel(lines, request, headings) {
  const first = request.units[0]
  const name =
    first.heading === null
      ? 'Front matter'
      : `${headings[first.heading].title}${first.part > 0 ? ' (continued)' : ''}`
  const more = request.units.length > 1 ? ` +${request.units.length - 1}` : ''
  const last = request.units[request.units.length - 1]
  const from = lines[first.from]?.page ?? lines[Math.max(0, first.from - 1)]?.page ?? null
  const to = lines[Math.max(first.from, last.to - 1)]?.page ?? from
  const pages = from === null ? '' : from === to ? ` · p. ${from}` : ` · pp. ${from}–${to}`
  return `${name}${more}${pages}`
}
