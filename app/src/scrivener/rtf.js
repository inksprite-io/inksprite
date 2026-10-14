/**
 * @module scrivener/rtf
 * @description A Scrivener text's RTF, read into paragraphs and tables.
 *
 * Scrivener on a Mac writes its RTF through macOS's text system, which uses a
 * small and regular part of the format: a font table, a color table and a
 * list table, then the paragraphs, each opened by `\pard` and its settings
 * and closed by a backslash at the end of a line. What a markdown document can
 * hold is kept: bold, italic and strikethrough, which list a paragraph is in
 * and how deep, which of Scrivener's paragraph styles it is in, and tables, as
 * the text in their cells. Fonts, sizes, colors, spacing and the rest are read
 * past.
 *
 * Scrivener marks its styles in the text itself: `<$Scr_Ps::0>` opens the
 * first of the styles the text uses, `<!$Scr_Ps::0>` closes it, and the
 * paragraphs between are in it. The markers come out here, and each paragraph
 * keeps the name of the style it was in.
 *
 * Anything else is read as the text it holds, and what holds none, such as a
 * picture's data or a field's instruction, is dropped. Nothing in the content
 * throws.
 */

/**
 * A stretch of text with one set of marks. A line break inside a paragraph is
 * a `\n` in it.
 *
 * @typedef {Object} Run
 * @property {string} text
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {boolean} strike
 */

/**
 * A paragraph, and what it is part of.
 *
 * @typedef {Object} RtfParagraph
 * @property {'paragraph'} type
 * @property {Run[]} runs
 * @property {string|null} style - The name of the Scrivener paragraph style it is in
 * @property {{level: number, ordered: boolean}|null} list - Where it is in a
 *   list, when it is in one: how deep, from 0, and whether it is numbered
 */

/**
 * A table, as the text in its cells, row by row: a cell's paragraphs a line
 * each.
 *
 * @typedef {Object} RtfTable
 * @property {'table'} type
 * @property {string[][]} rows
 */

/** @typedef {RtfParagraph|RtfTable} RtfBlock */

/**
 * Groups that hold no text of the document's: tables of fonts and colors, a
 * picture's data, the bullet as drawn before a list item, a field's
 * instruction. A group whose first word is starred (`{\*\…}`) is one too.
 */
const SKIPPED = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'NeXTGraphic',
  'object',
  'listtext',
  'fldinst',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
])

/** Characters RTF has a word for. */
const NAMED = /** @type {Record<string, string>} */ ({
  emdash: '\u2014',
  endash: '\u2013',
  lquote: '\u2018',
  rquote: '\u2019',
  ldblquote: '\u201c',
  rdblquote: '\u201d',
  bullet: '\u2022',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
  tab: ' ',
  line: '\n',
})

/** The number format a bullet list's level has in the list table. */
const BULLET = 23
/** A level with no number at all. */
const NO_NUMBER = 255

/** A Scrivener marker in the text: a style opened or closed, or a setting. */
const MARKER = /<!?\$Scr[^>]*>/g
/** A paragraph style opened, or closed with `!`, and its index. */
const PARAGRAPH_STYLE = /^<(!?)\$Scr_Ps::(\d+)>$/

const CONTROL_WORD = /\\([a-zA-Z]{1,32})(-?\d{1,10})? ?/y
const HEX = /\\'([0-9a-fA-F]{2})/y
const PLAIN = /[^\\{}\r\n]+/y

/**
 * What a group's text is: the document's, the list table's settings, or
 * nothing at all.
 *
 * @typedef {'text'|'lists'|'overrides'|'skip'} Destination
 */

/**
 * @typedef {Object} GroupState
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {boolean} strike
 * @property {number} uc - How many characters stand in after a `\u` for a
 *   reader that cannot show it
 * @property {Destination} destination
 */

/**
 * Read a text's RTF.
 *
 * @param {string} source - The RTF, one character per byte
 * @param {string[]} [styles] - The names of the paragraph styles the text
 *   uses, in the order its markers number them
 * @returns {RtfBlock[]}
 */
export function readRtf(source, styles = []) {
  /** @type {RtfBlock[]} */
  const blocks = []

  /** @type {GroupState} */
  let group = { bold: false, italic: false, strike: false, uc: 1, destination: 'text' }
  /** @type {GroupState[]} */
  const groups = []
  // At the start of a group, where its first word may say what it holds.
  let opening = false
  let starred = false
  // Characters still to pass over after a `\u`.
  let standIns = 0
  let decoder = new TextDecoder('windows-1252')

  // The paragraph being read, and its settings since the last `\pard`.
  /** @type {Run[]} */
  let runs = []
  let listOverride = 0
  let level = 0
  let inTable = false
  /** @type {number|null} */
  let openStyle = null

  // The table being read.
  /** @type {string[][]|null} */
  let rows = null
  /** @type {string[]} */
  let row = []
  /** @type {string[]} */
  let cell = []

  // The list table: each list's number formats by level, and which list each
  // `\ls` a paragraph names stands for.
  /** @type {Map<number, number[]>} */
  const listFormats = new Map()
  /** @type {number[]} */
  let formats = []
  /** @type {Map<number, number>} */
  const overrides = new Map()
  let overrideList = 0

  /** @param {string} text */
  const add = text => {
    if (group.destination !== 'text' || !text) return
    const last = runs.at(-1)
    if (
      last &&
      last.bold === group.bold &&
      last.italic === group.italic &&
      last.strike === group.strike
    ) {
      last.text += text
    } else {
      runs.push({ text, bold: group.bold, italic: group.italic, strike: group.strike })
    }
  }

  /** @param {string} char */
  const addChar = char => {
    if (standIns > 0) standIns--
    else add(char)
  }

  /**
   * The paragraph's runs without Scrivener's markers, and the style it is in:
   * the one open where its text starts, since a style is closed at the start
   * of the paragraph after it.
   *
   * @param {Run[]} read
   * @returns {{runs: Run[], style: number|null}}
   */
  const takeMarkers = read => {
    /** @type {number|null|undefined} */
    let style
    /** @param {string} text */
    const reached = text => {
      if (style === undefined && text.trim()) style = openStyle
    }
    /** @type {Run[]} */
    const kept = []
    for (const run of read) {
      let text = ''
      let from = 0
      for (const match of run.text.matchAll(MARKER)) {
        const before = run.text.slice(from, match.index)
        reached(before)
        text += before
        from = (match.index ?? 0) + match[0].length
        const marker = PARAGRAPH_STYLE.exec(match[0])
        if (!marker) continue
        const index = Number(marker[2])
        if (!marker[1]) openStyle = index
        else if (openStyle === index) openStyle = null
      }
      const rest = run.text.slice(from)
      reached(rest)
      text += rest
      if (text) kept.push({ ...run, text })
    }
    return { runs: kept, style: style === undefined ? openStyle : style }
  }

  /** @param {Run[]} read */
  const lineOf = read =>
    read
      .map(run => run.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()

  const endTable = () => {
    if (rows && rows.length > 0) blocks.push({ type: 'table', rows })
    rows = null
  }

  const endParagraph = () => {
    const { runs: kept, style } = takeMarkers(runs)
    runs = []
    if (inTable) {
      cell.push(lineOf(kept))
      return
    }
    endTable()
    blocks.push({
      type: 'paragraph',
      runs: kept,
      style: style === null ? null : (styles[style] ?? null),
      list: listOverride ? listOf(listOverride, level) : null,
    })
  }

  /**
   * @param {number} override
   * @param {number} depth
   */
  const listOf = (override, depth) => {
    const found = listFormats.get(overrides.get(override) ?? override) ?? []
    const format = found[depth] ?? found.at(-1) ?? BULLET
    return { level: depth, ordered: format !== BULLET && format !== NO_NUMBER }
  }

  const endCell = () => {
    endParagraph()
    row.push(cell.filter(Boolean).join('\n'))
    cell = []
  }

  const endRow = () => {
    if (cell.length > 0 || runs.length > 0) endCell()
    if (row.length > 0) (rows ??= []).push(row)
    row = []
  }

  /**
   * @param {string} word
   * @param {number|null} param
   */
  const control = (word, param) => {
    if (opening) {
      opening = false
      if (word === 'listtable') group.destination = 'lists'
      else if (word === 'listoverridetable') group.destination = 'overrides'
      else if (starred || SKIPPED.has(word)) group.destination = 'skip'
      starred = false
    }
    const on = param !== 0

    if (group.destination === 'lists') {
      if (word === 'list') formats = []
      else if (word === 'levelnfc') formats.push(param ?? 0)
      else if (word === 'listid' && param !== null) listFormats.set(param, formats)
      return
    }
    if (group.destination === 'overrides') {
      if (word === 'listid') overrideList = param ?? 0
      else if (word === 'ls' && param !== null) overrides.set(param, overrideList)
      return
    }
    if (group.destination === 'skip') return

    if (word === 'par' || word === 'sect') endParagraph()
    else if (word === 'pard') {
      listOverride = 0
      level = 0
      inTable = false
    } else if (word === 'ls') listOverride = param ?? 0
    else if (word === 'ilvl') level = Math.max(0, param ?? 0)
    else if (word === 'intbl') inTable = true
    else if (word === 'cell') {
      inTable = true
      endCell()
    } else if (word === 'row') endRow()
    else if (word === 'plain') {
      group.bold = false
      group.italic = false
      group.strike = false
    } else if (word === 'b') group.bold = on
    else if (word === 'i') group.italic = on
    else if (word === 'strike' || word === 'striked') group.strike = on
    else if (word === 'uc') group.uc = Math.max(0, param ?? 1)
    else if (word === 'u' && param !== null) {
      const char = String.fromCharCode(param < 0 ? param + 65536 : param)
      add(char === '\u2028' ? '\n' : char)
      standIns = group.uc
    } else if (word in NAMED) addChar(NAMED[word])
    else if (word === 'ansicpg' && param) {
      try {
        decoder = new TextDecoder(`windows-${param}`)
      } catch {
        // A code page the browser has no decoder for: Western, as most are.
      }
    }
  }

  let at = 0
  while (at < source.length) {
    const char = source[at]
    if (char === '{') {
      groups.push(group)
      group = { ...group }
      opening = true
      starred = false
      standIns = 0
      at++
    } else if (char === '}') {
      group = groups.pop() ?? group
      opening = false
      standIns = 0
      at++
    } else if (char === '\\') {
      CONTROL_WORD.lastIndex = at
      const word = CONTROL_WORD.exec(source)
      if (word) {
        const param = word[2] === undefined ? null : Number(word[2])
        if (word[1] === 'bin' && param) {
          at = CONTROL_WORD.lastIndex + param
          continue
        }
        control(word[1], param)
        at = CONTROL_WORD.lastIndex
        continue
      }
      HEX.lastIndex = at
      const hex = HEX.exec(source)
      if (hex) {
        opening = false
        addChar(decoder.decode(new Uint8Array([parseInt(hex[1], 16)])))
        at = HEX.lastIndex
        continue
      }
      const symbol = source[at + 1] ?? ''
      at += 2
      if (symbol === '*' && opening) {
        starred = true
        continue
      }
      opening = false
      if (symbol === '\n' || symbol === '\r') {
        if (group.destination === 'text') endParagraph()
      } else if (symbol === '\\' || symbol === '{' || symbol === '}') addChar(symbol)
      else if (symbol === '~') addChar('\u00a0')
      else if (symbol === '_') addChar('-')
    } else if (char === '\n' || char === '\r') {
      at++
    } else {
      opening = false
      PLAIN.lastIndex = at
      const text = /** @type {RegExpExecArray} */ (PLAIN.exec(source))[0]
      at = PLAIN.lastIndex
      const skipped = Math.min(standIns, text.length)
      standIns -= skipped
      add(text.slice(skipped))
    }
  }

  if (runs.some(run => run.text.trim())) endParagraph()
  if (row.length > 0) endRow()
  endTable()
  return blocks
}
