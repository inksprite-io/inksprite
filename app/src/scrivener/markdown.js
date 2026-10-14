/**
 * @module scrivener/markdown
 * @description What was read out of a Scrivener text, written as markdown.
 *
 * The paragraphs and tables are built into a document in the editor's schema
 * and written out by the editor's serializer, so the markdown is in the file
 * format's own form and its escaping is the serializer's: a scene break typed
 * as a lone `#` stays a `#`, not an empty heading.
 *
 * Scrivener's paragraph styles are known by name. Title is a heading of the
 * first level and Heading n one of level n + 1, so a Title keeps its place
 * above the Heading 1s under it; Block Quote is a block quote and Code Block a
 * code block. Any other style is an ordinary paragraph. Lists nest by level,
 * and a level that jumps more than one deeper than the item before it is
 * taken as one deeper. Empty paragraphs, which lay out space in Scrivener,
 * are dropped.
 *
 * A table of one row lays out a page rather than holding data, as the title
 * page in Scrivener's novel template does: its cells are paragraphs, their
 * lines kept. A longer one is a table, its first row the header, a cell's
 * lines run together, since a cell holds one.
 */

import { schema } from '@/editor/schema.js'
import { serializeMarkdown } from '@/editor/markdown.js'

/** @typedef {import('prosemirror-model').Node} Node */
/** @typedef {import('./rtf.js').Run} Run */
/** @typedef {import('./rtf.js').RtfBlock} RtfBlock */
/** @typedef {import('./rtf.js').RtfParagraph} RtfParagraph */

/**
 * What a paragraph in a style is written as.
 *
 * @typedef {{type: 'heading', level: number}|{type: 'blockquote'|'code'|'paragraph'}} Kind
 */

/**
 * @param {string|null} style - A Scrivener paragraph style's name
 * @returns {Kind}
 */
export function kindOf(style) {
  const name = (style || '').trim().toLowerCase()
  if (name === 'title') return { type: 'heading', level: 1 }
  const heading = /^heading\s*(\d)$/.exec(name)
  if (heading) return { type: 'heading', level: Math.min(6, Number(heading[1]) + 1) }
  if (name === 'block quote' || name === 'blockquote') return { type: 'blockquote' }
  if (name === 'code block') return { type: 'code' }
  return { type: 'paragraph' }
}

/**
 * A Scrivener text as markdown.
 *
 * @param {RtfBlock[]} blocks
 * @returns {string}
 */
export function markdownOfBlocks(blocks) {
  /** @type {Node[]} */
  const nodes = []
  let at = 0
  while (at < blocks.length) {
    const block = blocks[at]
    if (block.type === 'table') {
      if (block.rows.length > 1) nodes.push(tableOf(block.rows))
      else nodes.push(...block.rows[0].filter(Boolean).map(cellParagraph))
      at++
      continue
    }
    if (block.list) {
      const items = []
      while (at < blocks.length) {
        const item = blocks[at]
        if (item.type !== 'paragraph' || !item.list) break
        if (!isEmpty(item)) items.push(item)
        at++
      }
      nodes.push(...listsOf(items))
      continue
    }
    const kind = kindOf(block.style)
    if (kind.type === 'code') {
      const lines = []
      while (at < blocks.length) {
        const line = blocks[at]
        if (line.type !== 'paragraph' || line.list || kindOf(line.style).type !== 'code') break
        lines.push(line.runs.map(run => run.text).join(''))
        at++
      }
      const text = lines.join('\n').replace(/^\n+|\s+$/g, '')
      if (text) nodes.push(schema.nodes.code_block.create(null, schema.text(text)))
      continue
    }
    if (kind.type === 'blockquote') {
      const paragraphs = []
      while (at < blocks.length) {
        const quoted = blocks[at]
        if (quoted.type !== 'paragraph' || quoted.list) break
        if (kindOf(quoted.style).type !== 'blockquote') break
        if (!isEmpty(quoted)) paragraphs.push(schema.nodes.paragraph.create(null, inline(quoted)))
        at++
      }
      if (paragraphs.length > 0) nodes.push(schema.nodes.blockquote.create(null, paragraphs))
      continue
    }
    at++
    if (isEmpty(block)) continue
    if (kind.type === 'heading') {
      // A heading's style is bold already; its bold is the style's, not the writer's.
      nodes.push(schema.nodes.heading.create({ level: kind.level }, inline(block, false)))
    } else {
      nodes.push(schema.nodes.paragraph.create(null, inline(block)))
    }
  }
  return nodes.length > 0 ? serializeMarkdown(schema.nodes.doc.create(null, nodes)) : ''
}

/**
 * Plain text, such as a synopsis, as markdown: each line a paragraph.
 *
 * @param {string} text
 * @returns {string}
 */
export function markdownOfText(text) {
  const nodes = text
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => schema.nodes.paragraph.create(null, schema.text(line)))
  return nodes.length > 0 ? serializeMarkdown(schema.nodes.doc.create(null, nodes)) : ''
}

/** @param {RtfParagraph} paragraph */
const isEmpty = paragraph => !paragraph.runs.some(run => run.text.trim())

/**
 * A paragraph's runs as text and line breaks, with the space around it taken
 * off.
 *
 * @param {RtfParagraph} paragraph
 * @param {boolean} [bold] - Whether bold is kept
 * @returns {Node[]}
 */
function inline({ runs }, bold = true) {
  const trimmed = trimRuns(runs)
  /** @type {Node[]} */
  const out = []
  for (const run of trimmed) {
    const marks = []
    if (bold && run.bold) marks.push(schema.marks.strong.create())
    if (run.italic) marks.push(schema.marks.em.create())
    if (run.strike) marks.push(schema.marks.strikethrough.create())
    run.text.split('\n').forEach((line, i) => {
      if (i > 0) out.push(schema.nodes.hard_break.create())
      if (line) out.push(schema.text(line, marks))
    })
  }
  return out
}

/**
 * Runs without the space at either end of the whole.
 *
 * @param {Run[]} runs
 * @returns {Run[]}
 */
function trimRuns(runs) {
  const out = runs.map(run => ({ ...run, text: run.text.replace(/\t/g, ' ') }))
  while (out.length > 0) {
    out[0].text = out[0].text.replace(/^\s+/, '')
    if (out[0].text) break
    out.shift()
  }
  while (out.length > 0) {
    const last = out[out.length - 1]
    last.text = last.text.replace(/\s+$/, '')
    if (last.text) break
    out.pop()
  }
  return out
}

/**
 * A run of list items as lists, nested by level.
 *
 * @param {RtfParagraph[]} items
 * @returns {Node[]}
 */
function listsOf(items) {
  /** @typedef {{ordered: boolean, items: {paragraph: RtfParagraph, lists: List[]}[]}} List */
  /** @type {List[]} */
  const top = []
  /** @type {List[]} */
  const open = []
  let depth = -1
  for (const paragraph of items) {
    const list = /** @type {{level: number, ordered: boolean}} */ (paragraph.list)
    depth = Math.min(list.level, depth + 1)
    open.length = depth + 1
    let current = open[depth]
    if (!current || current.ordered !== list.ordered) {
      current = { ordered: list.ordered, items: [] }
      if (depth === 0) top.push(current)
      else open[depth - 1].items.at(-1)?.lists.push(current)
      open[depth] = current
    }
    current.items.push({ paragraph, lists: [] })
  }

  /**
   * @param {List} list
   * @returns {Node}
   */
  const nodeOf = list =>
    (list.ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list).create(
      null,
      list.items.map(item =>
        schema.nodes.list_item.create(null, [
          schema.nodes.paragraph.create(null, inline(item.paragraph)),
          ...item.lists.map(nodeOf),
        ])
      )
    )
  return top.map(nodeOf)
}

/**
 * A table, its first row the header, every row as wide as the widest.
 *
 * @param {string[][]} rows
 * @returns {Node}
 */
function tableOf(rows) {
  const width = Math.max(...rows.map(row => row.length))
  return schema.nodes.table.create(
    null,
    rows.map(row =>
      schema.nodes.table_row.create(
        null,
        Array.from({ length: width }, (_, i) =>
          schema.nodes.table_cell.create(
            null,
            row[i] ? schema.text(row[i].replace(/\n/g, ' ')) : null
          )
        )
      )
    )
  )
}

/**
 * A cell laid out on a page, as a paragraph with its lines.
 *
 * @param {string} text
 * @returns {Node}
 */
function cellParagraph(text) {
  /** @type {Node[]} */
  const lines = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) lines.push(schema.nodes.hard_break.create())
    lines.push(schema.text(line))
  })
  return schema.nodes.paragraph.create(null, lines)
}
