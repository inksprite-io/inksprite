/* global structuredClone */
/**
 * @module drive/apply
 * @description A batch of the Docs API's requests applied to a Doc as Docs
 * applies them, and the Doc as it would read after: what a sync expects its
 * write to leave, so that whatever else the Doc reads as afterwards is what
 * Google merged in from a collaborator. The writer's tests apply its
 * requests with it too, and it was checked against Google's own in the
 * writer's live run (17 Oct 2026), which found nowhere the two part.
 *
 * - Text goes in only inside a paragraph, never at a table's start; the
 *   control characters Docs strips are stripped. Inserted text takes the
 *   style of the character before it, or the one after at a paragraph's
 *   start. A newline makes a paragraph, which copies the style and bullet
 *   of the one it was typed into.
 * - A deletion may not take a segment's last newline, a newline before a
 *   table or a section break, or any part of a table or a section break.
 *   Two paragraphs a deletion joins keep the second's style.
 * - A text or paragraph style update sets the fields given and resets those
 *   named but left out.
 * - Bullets: a paragraph's leading tabs are its nesting, and are removed; a
 *   paragraph after a list made with the same preset joins it.
 * - A table goes in inside a paragraph, which it parts: a newline is put in
 *   before it, and what followed in the paragraph follows the table. Each of
 *   its cells, and each cell of a row or column put in, is one empty
 *   paragraph. A table goes whole, by its range or by its last row or column.
 *
 * Only what the writer sends is here; anything else is refused, as Docs
 * would refuse what is refused here. The Doc is held as atoms, one per
 * index, and written back in the API's shape after each batch, adjacent
 * runs of one style as one.
 */

import { tabsOf } from './convert.js'

/** What Docs strips from inserted text. */
// eslint-disable-next-line no-control-regex
const STRIPPED = /[\u0000-\u0008\u000c-\u001f-]/g

/** The bullet presets the writer uses, as a list's levels. */
const PRESETS = {
  BULLET_DISC_CIRCLE_SQUARE: [{ glyphSymbol: '●' }, { glyphSymbol: '○' }, { glyphSymbol: '■' }],
  NUMBERED_DECIMAL_ALPHA_ROMAN: [
    { glyphType: 'DECIMAL', startNumber: 1 },
    { glyphType: 'ALPHA', startNumber: 1 },
    { glyphType: 'ROMAN', startNumber: 1 },
  ],
}

const clone = value => (value === undefined ? undefined : structuredClone(value))
const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

/**
 * A paragraph's elements as atoms.
 *
 * @param {object} paragraph
 */
function atomsOf(paragraph) {
  const atoms = []
  for (const element of paragraph.elements ?? []) {
    if (element.textRun) {
      const { content = '', textStyle = {}, ...extra } = element.textRun
      for (const char of content.split(''))
        atoms.push({ char, style: clone(textStyle), extra: clone(extra) })
    } else {
      const [kind, value] = Object.entries(element).find(([key]) => !key.endsWith('Index'))
      atoms.push({ kind, value: clone(value) })
    }
  }
  return atoms
}

/** A body's, a cell's or a footnote's blocks, as atoms. */
function blocksOf(content) {
  return content.map(element => {
    if (element.paragraph) {
      const { elements: _elements, ...props } = element.paragraph
      return { type: 'paragraph', props: clone(props), atoms: atomsOf(element.paragraph) }
    }
    if (element.table) {
      const { tableRows, ...props } = element.table
      return {
        type: 'table',
        props: clone(props),
        rows: tableRows.map(row => {
          const { tableCells, startIndex: _s, endIndex: _e, ...rowProps } = row
          return {
            props: clone(rowProps),
            cells: tableCells.map(cell => {
              const { content, startIndex: _cs, endIndex: _ce, ...cellProps } = cell
              return { props: clone(cellProps), blocks: blocksOf(content ?? []) }
            }),
          }
        }),
      }
    }
    const { startIndex = 0, endIndex, ...rest } = element
    return { type: 'other', element: clone(rest), size: endIndex - startIndex }
  })
}

/** The atoms back as elements, a run for each stretch of one style. */
function elementsOf(atoms, start) {
  /** @type {any[]} */
  const out = []
  let at = start
  const at0 = index => (index === 0 ? {} : { startIndex: index })
  for (const atom of atoms) {
    const last = out.at(-1)
    if (atom.char !== undefined) {
      if (
        last?.textRun &&
        same(last.textRun.textStyle, atom.style) &&
        same(last.extra, atom.extra)
      ) {
        last.textRun.content += atom.char
        last.endIndex++
      } else {
        out.push({
          ...at0(at),
          endIndex: at + 1,
          textRun: { content: atom.char, textStyle: clone(atom.style) ?? {}, ...clone(atom.extra) },
          extra: atom.extra,
        })
      }
    } else {
      out.push({ ...at0(at), endIndex: at + 1, [atom.kind]: clone(atom.value) })
    }
    at++
  }
  return out.map(({ extra: _extra, ...element }) => element)
}

/** Blocks back in the API's shape, indexed from `start`. */
function contentOf(blocks, start) {
  let at = start
  const at0 = index => (index === 0 ? {} : { startIndex: index })
  const content = blocks.map(block => {
    if (block.type === 'paragraph') {
      const from = at
      const elements = elementsOf(block.atoms, at)
      at += block.atoms.length
      return { ...at0(from), endIndex: at, paragraph: { ...clone(block.props), elements } }
    }
    if (block.type === 'table') {
      const from = at++
      const tableRows = block.rows.map(row => {
        const rowFrom = at++
        const tableCells = row.cells.map(cell => {
          const cellFrom = at++
          const inner = contentOf(cell.blocks, at)
          at = inner.end
          return {
            startIndex: cellFrom,
            endIndex: at,
            content: inner.content,
            ...clone(cell.props),
          }
        })
        return { startIndex: rowFrom, endIndex: at, tableCells, ...clone(row.props) }
      })
      at++
      const shape = { rows: block.rows.length, columns: block.rows[0]?.cells.length ?? 0 }
      return {
        startIndex: from,
        endIndex: at,
        table: { ...clone(block.props), ...shape, tableRows },
      }
    }
    const from = at
    at += block.size
    return { ...at0(from), endIndex: at, ...clone(block.element) }
  })
  return { content, end: at }
}

/**
 * Every paragraph of a segment with its first index, in order, tables'
 * cells included, and the indices of tables' and other blocks' starts.
 */
function layout(blocks, start = 0) {
  const paragraphs = []
  const fixed = []
  const tables = []
  const walk = (list, from, inCell, within) => {
    let at = from
    list.forEach((block, i) => {
      if (block.type === 'paragraph') {
        paragraphs.push({ block, list, i, start: at, inCell, within, before: list[i + 1] })
        at += block.atoms.length
      } else if (block.type === 'table') {
        const table = { block, list, start: at, end: 0 }
        fixed.push({ start: at, block })
        at++
        for (const row of block.rows) {
          at++
          for (const cell of row.cells) {
            at++
            at = walk(cell.blocks, at, true, [...within, block])
          }
        }
        fixed.push({ start: at, block })
        at++
        table.end = at
        tables.push(table)
      } else {
        for (let k = 0; k < block.size; k++) fixed.push({ start: at + k, block })
        at += block.size
      }
    })
    return at
  }
  const end = walk(blocks, start, false, [])
  return { paragraphs, fixed, tables, end }
}

/** The paragraph an index is in, and how far into it. */
function locate(segment, index) {
  const { paragraphs } = layout(segment)
  for (const entry of paragraphs) {
    if (index >= entry.start && index < entry.start + entry.block.atoms.length) {
      return { ...entry, offset: index - entry.start }
    }
  }
  return null
}

/** Rebuild a paragraph split at each newline but its last, each part its own copy. */
function splitAtNewlines(entry) {
  const parts = []
  let current = []
  for (const atom of entry.block.atoms) {
    current.push(atom)
    if (atom.char === '\n') {
      parts.push(current)
      current = []
    }
  }
  if (current.length > 0) throw new Error('a paragraph must end with its newline')
  entry.list.splice(
    entry.i,
    1,
    ...parts.map(atoms => ({ type: 'paragraph', props: clone(entry.block.props), atoms }))
  )
}

/**
 * @param {object} model
 * @param {{segmentId?: string, tabId?: string}} where
 */
function segmentOf(model, where) {
  if (where.tabId && where.tabId !== model.tabId) throw new Error(`no tab ${where.tabId}`)
  if (!where.segmentId) return model.body
  const footnote = model.footnotes[where.segmentId]
  if (!footnote) throw new Error(`no segment ${where.segmentId}`)
  return footnote
}

function insertText(model, { text, location }) {
  const segment = segmentOf(model, location)
  const entry = locate(segment, location.index)
  if (!entry) {
    throw new Error(`400: text must be inserted inside a paragraph, not at ${location.index}`)
  }
  const atoms = entry.block.atoms
  const before = entry.offset > 0 ? atoms[entry.offset - 1] : atoms[entry.offset]
  const style = before.char !== undefined ? before.style : (before.value?.textStyle ?? {})
  const inserted = text
    .replace(STRIPPED, '')
    .split('')
    .map(char => ({ char, style: clone(style) }))
  atoms.splice(entry.offset, 0, ...inserted)
  if (inserted.some(atom => atom.char === '\n')) splitAtNewlines(entry)
}

function deleteContentRange(model, { range }) {
  const segment = segmentOf(model, range)
  const { startIndex: start, endIndex: end } = range
  if (!(start < end)) throw new Error('400: an empty range')
  const { paragraphs: all, fixed, tables } = layout(segment)
  // A table goes whole, or not at all.
  const gone = new Set(
    tables.filter(table => table.start >= start && table.end <= end).map(table => table.block)
  )
  if (fixed.some(entry => entry.start >= start && entry.start < end && !gone.has(entry.block))) {
    throw new Error('400: part of a table or a section break')
  }
  const paragraphs = all.filter(entry => !entry.within.some(table => gone.has(table)))
  const last = paragraphs.filter(entry => !entry.inCell).at(-1)
  for (const entry of paragraphs) {
    const newline = entry.start + entry.block.atoms.length - 1
    if (newline < start || newline >= end) continue
    if (entry === last) throw new Error('400: the last newline of the segment')
    if (entry.inCell && entry.i === entry.list.length - 1) {
      throw new Error('400: the last newline of a cell')
    }
    if (entry.before && entry.before.type !== 'paragraph' && !gone.has(entry.before)) {
      throw new Error('400: the newline before a table or a section break')
    }
  }
  for (const table of tables) {
    if (gone.has(table.block)) table.list.splice(table.list.indexOf(table.block), 1)
  }
  // Take the atoms out, then join each paragraph that lost its newline to
  // the next, which keeps its style.
  for (const entry of paragraphs) {
    const from = Math.max(start, entry.start) - entry.start
    const to = Math.min(end, entry.start + entry.block.atoms.length) - entry.start
    if (from < to) entry.block.atoms.splice(from, to - from, ...new Array(to - from).fill(null))
  }
  for (const entry of [...paragraphs].reverse()) {
    const { block, list } = entry
    const lostNewline = block.atoms.at(-1) === null
    block.atoms = block.atoms.filter(atom => atom !== null)
    if (lostNewline) {
      const at = list.indexOf(block)
      const next = list[at + 1]
      next.atoms = [...block.atoms, ...next.atoms]
      list.splice(at, 1)
    }
  }
}

function fieldsOf(mask, given) {
  return mask === '*' ? Object.keys(given) : mask.split(',').map(field => field.trim())
}

function updateTextStyle(model, { range, textStyle = {}, fields }) {
  const segment = segmentOf(model, range)
  for (const entry of layout(segment).paragraphs) {
    entry.block.atoms.forEach((atom, i) => {
      const index = entry.start + i
      if (index < range.startIndex || index >= range.endIndex) return
      const style = atom.char !== undefined ? atom.style : (atom.value.textStyle ??= {})
      for (const field of fieldsOf(fields, textStyle)) {
        if (field in textStyle) style[field] = clone(textStyle[field])
        else delete style[field]
      }
    })
  }
}

function overlapping(segment, range) {
  return layout(segment).paragraphs.filter(
    entry =>
      entry.start < range.endIndex && range.startIndex < entry.start + entry.block.atoms.length
  )
}

function updateParagraphStyle(model, { range, paragraphStyle = {}, fields }) {
  for (const { block } of overlapping(segmentOf(model, range), range)) {
    const style = (block.props.paragraphStyle ??= {})
    for (const field of fieldsOf(fields, paragraphStyle)) {
      if (field in paragraphStyle) style[field] = clone(paragraphStyle[field])
      else delete style[field]
    }
  }
}

function createParagraphBullets(model, { range, bulletPreset }) {
  const levels = PRESETS[bulletPreset]
  if (!levels) throw new Error(`no preset ${bulletPreset}`)
  const entries = overlapping(segmentOf(model, range), range)
  const before = entries[0] && entries[0].list[entries[0].i - 1]
  const joined = before?.props?.bullet?.listId
  const listId =
    joined && model.presets[joined] === bulletPreset ? joined : `list.${++model.lists.made}`
  model.presets[listId] = bulletPreset
  model.tabLists[listId] ??= { listProperties: { nestingLevels: clone(levels) } }
  for (const { block } of entries) {
    let tabs = 0
    while (block.atoms[tabs]?.char === '\t') tabs++
    block.atoms.splice(0, tabs)
    block.props.bullet = { listId, ...(tabs > 0 && { nestingLevel: tabs }) }
  }
}

function deleteParagraphBullets(model, { range }) {
  for (const { block } of overlapping(segmentOf(model, range), range)) delete block.props.bullet
}

/** A table's empty cell, as Docs makes one. */
const emptyCell = () => ({
  props: {},
  blocks: [
    {
      type: 'paragraph',
      props: { paragraphStyle: { namedStyleType: 'NORMAL_TEXT' } },
      atoms: [{ char: '\n', style: {} }],
    },
  ],
})

function insertTable(model, { rows, columns, location }) {
  if (!location) throw new Error('the stand-in has no endOfSegmentLocation')
  if (location.segmentId) throw new Error('400: a table cannot go in a footnote')
  const segment = segmentOf(model, location)
  const entry = locate(segment, location.index)
  if (!entry) {
    throw new Error(`400: a table must be inserted inside a paragraph, not at ${location.index}`)
  }
  if (!(rows > 0 && columns > 0)) throw new Error('400: a table of no rows or columns')
  const atoms = entry.block.atoms
  const before = entry.offset > 0 ? atoms[entry.offset - 1] : atoms[entry.offset]
  const style = before.char !== undefined ? before.style : (before.value?.textStyle ?? {})
  const first = {
    type: 'paragraph',
    props: clone(entry.block.props),
    atoms: [...atoms.slice(0, entry.offset), { char: '\n', style: clone(style) }],
  }
  const rest = {
    type: 'paragraph',
    props: clone(entry.block.props),
    atoms: atoms.slice(entry.offset),
  }
  const table = {
    type: 'table',
    props: {},
    rows: Array.from({ length: rows }, () => ({
      props: {},
      cells: Array.from({ length: columns }, emptyCell),
    })),
  }
  entry.list.splice(entry.i, 1, first, table, rest)
}

/** The table a cell location's table starts at, and the cell's row and column. */
function tableOf(model, { tableStartLocation, rowIndex = 0, columnIndex = 0 }) {
  const segment = segmentOf(model, tableStartLocation)
  const table = layout(segment).tables.find(each => each.start === tableStartLocation.index)
  if (!table) throw new Error(`400: no table starts at ${tableStartLocation.index}`)
  const { rows } = table.block
  if (!(rowIndex >= 0 && rowIndex < rows.length)) throw new Error(`400: no row ${rowIndex}`)
  if (!(columnIndex >= 0 && columnIndex < rows[rowIndex].cells.length)) {
    throw new Error(`400: no column ${columnIndex}`)
  }
  if (rows.some(row => row.cells.some(cell => spans(cell)))) {
    throw new Error('the stand-in has no merged cells')
  }
  return { table, rowIndex, columnIndex }
}

/** Whether a cell spans more than itself. */
const spans = cell =>
  (cell.props?.tableCellStyle?.rowSpan ?? 1) > 1 ||
  (cell.props?.tableCellStyle?.columnSpan ?? 1) > 1

function insertTableRow(model, { tableCellLocation, insertBelow }) {
  const { table, rowIndex } = tableOf(model, tableCellLocation)
  const { rows } = table.block
  const row = { props: {}, cells: rows[rowIndex].cells.map(emptyCell) }
  rows.splice(insertBelow ? rowIndex + 1 : rowIndex, 0, row)
}

function insertTableColumn(model, { tableCellLocation, insertRight }) {
  const { table, columnIndex } = tableOf(model, tableCellLocation)
  for (const row of table.block.rows) {
    row.cells.splice(insertRight ? columnIndex + 1 : columnIndex, 0, emptyCell())
  }
}

/** A table left with no rows or columns, gone. */
function dropIfEmpty(table) {
  const { rows } = table.block
  if (rows.length === 0 || rows[0].cells.length === 0) {
    table.list.splice(table.list.indexOf(table.block), 1)
  }
}

function deleteTableRow(model, { tableCellLocation }) {
  const { table, rowIndex } = tableOf(model, tableCellLocation)
  table.block.rows.splice(rowIndex, 1)
  dropIfEmpty(table)
}

function deleteTableColumn(model, { tableCellLocation }) {
  const { table, columnIndex } = tableOf(model, tableCellLocation)
  for (const row of table.block.rows) row.cells.splice(columnIndex, 1)
  dropIfEmpty(table)
}

const REQUESTS = {
  insertText,
  insertTable,
  insertTableRow,
  insertTableColumn,
  deleteTableRow,
  deleteTableColumn,
  deleteContentRange,
  updateTextStyle,
  updateParagraphStyle,
  createParagraphBullets,
  deleteParagraphBullets,
}

/**
 * Apply a batch to a tab of a Doc, as Docs would, and hand back the Doc as
 * it would read after, its revision the one it had with a `+`.
 *
 * @param {import('./docsTypes.js').Document} document - Read with its tabs
 * @param {object[]} requests
 * @param {Object} [options]
 * @param {string} [options.tabId] - The tab they are for; the first otherwise
 * @returns {import('./docsTypes.js').Document}
 * @throws {Error} Where Docs would refuse the batch
 */
export function applyRequests(document, requests, { tabId } = {}) {
  const out = structuredClone(document)
  const tab = tabId ? tabsOf(out).find(each => each.tabProperties?.tabId === tabId) : out.tabs?.[0]
  if (!tab?.documentTab) throw new Error('The Doc has no such tab')
  const documentTab = tab.documentTab
  const model = {
    tabId: tab.tabProperties?.tabId,
    body: blocksOf(documentTab.body?.content ?? []),
    footnotes: Object.fromEntries(
      Object.entries(documentTab.footnotes ?? {}).map(([id, note]) => [
        id,
        blocksOf(note.content ?? []),
      ])
    ),
    tabLists: (documentTab.lists ??= {}),
    lists: { made: 0 },
    presets: {},
  }
  for (const request of requests) {
    const [kind, body] = Object.entries(request)[0]
    const apply = REQUESTS[kind]
    if (!apply) throw new Error(`the stand-in has no ${kind}`)
    apply(model, body)
  }
  documentTab.body = { content: contentOf(model.body, 0).content }
  for (const [id, blocks] of Object.entries(model.footnotes)) {
    documentTab.footnotes[id] = /** @type {any} */ ({
      footnoteId: id,
      content: contentOf(blocks, 0).content,
    })
  }
  out.revisionId = `${document.revisionId}+`
  return out
}
