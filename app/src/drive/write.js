/**
 * @module drive/write
 * @description What a Google Doc lacks of a document, as the Docs API
 * requests that would make it so: the writing half of the converter.
 *
 * The Doc is read (`drive/convert`), and its document compared with the one
 * to send, block by block and then, within the blocks that differ, a
 * character at a time. Only what differs is written, at the Doc's own
 * indices, so the rest of the Doc stays as it is: its comments, its fonts,
 * and whatever the converter holds (pictures, page breaks, the empty
 * paragraphs a Doc is spaced with), none of which is ever deleted. A chip
 * stays a chip while its words do; words changed in one, or added against
 * it in its link, replace it with plain text. A picture is known by the
 * Doc's id for it, which its entry on the document's row keeps: one deleted
 * here is deleted in the Doc, and one added here stays here, as nothing yet
 * can send one. Only a picture the row knows the Doc's id for is deleted
 * when its text no longer has it; one the document never had, as one
 * imported before pictures came in, stays.
 *
 * The requests come in two passes. The first inserts and deletes, from the
 * end of each segment back, so each request's indices are still the Doc's
 * as read. The second styles, at the indices the first left: text bold,
 * italic, struck, linked or in a monospaced font, and paragraphs as
 * headings, quotes (indented 30 pt either side, as Docs makes a pasted one)
 * and list items. A rule goes up as a paragraph of `* * *`, which reads back
 * as one.
 *
 * A table is made the document's shape first (`drive/shape`): rows and
 * columns put in and taken out, tables put in empty and deleted. The Doc as
 * those requests leave it is what the words are then written against, each
 * table laid against the document's in the same place, cell by cell, its
 * words as any paragraph's.
 *
 * What it cannot send yet it says, rather than sending part of it: a table
 * with merged cells changing shape, or a row, column or table deleted that
 * holds what the document cannot show; a list item's kind or nesting
 * changed; a footnote added or removed; an edit in a paragraph with a
 * newline or a change of style suggested; a block inside a list or a quote
 * that a Doc's paragraphs cannot be. See `.llm/google_docs_design.md`, part 3.
 * The words a suggestion puts in are held, as a picture is, and those it
 * takes out are words as they stand, so the writer writes around them.
 */

import { applyRequests } from './apply.js'
import { MONOSPACED, readDoc, tabsOf } from './convert.js'
import { shapeTables } from './shape.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { suggestionsIn } from '@/editor/suggestions.js'
import { diffSequences, deletionsFirst } from '@/utils/diff.js'
import { schema } from '@/editor/schema.js'
import { pictureOf } from '@/utils/pictures.js'
import { Fragment } from 'prosemirror-model'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('./docsTypes.js').Document} Document
 * @typedef {import('./docsTypes.js').DocumentTab} DocumentTab
 * @typedef {import('./docsTypes.js').StructuralElement} StructuralElement
 * @typedef {import('./docsTypes.js').TextStyle} TextStyle
 * @typedef {import('./convert.js').Span} Span
 */

/**
 * What the writer could not send.
 *
 * @typedef {'table'|'merged'|'held'|'list'|'footnote'|'suggestion'|'layout'} Unsent
 */

/**
 * @typedef {Object} Written
 * @property {object[]} requests - For `documents.batchUpdate`, in order
 * @property {Unsent[]} unsent - What the requests leave out; send none of
 *   them unless this is empty
 * @property {string} revisionId - The revision they were made against
 */

/**
 * How a character looks, in the terms a Doc sets it.
 *
 * @typedef {{bold: boolean, italic: boolean, strike: boolean, link: string, code: boolean}} Look
 */

/**
 * What kind of paragraph a block is.
 *
 * @typedef {{kind: 'paragraph'|'heading'|'list'|'quote'|'code'|'footnote'|'table', level?: number, ordered?: boolean, depth?: number}} Kind
 */

/**
 * A piece of a document, for the comparison: a character, a line break, a
 * block's end, a rule, a table, or the converter's own text. Those read
 * from the Doc know where they are in it.
 *
 * @typedef {Object} Unit
 * @property {'char'|'break'|'end'|'rule'|'table'|'fixed'|'picture'} type
 * @property {string} key - What the comparison compares
 * @property {string} segment - The footnote it is in; the body when empty
 * @property {Kind} kind - The block it is in
 * @property {string} [char]
 * @property {Look} [look]
 * @property {number} [index]
 * @property {number} [size]
 * @property {number} [chip] - The index of the chip whose words it is one of
 * @property {string} [object] - A picture's inline object, by id
 * @property {boolean} [virtual] - An end that is a page break, which goes
 *   only when the paragraphs either side of it are joined
 * @property {DocParagraph} [paragraph] - The Doc's paragraph it is in
 */

/**
 * @typedef {Object} Block
 * @property {'text'|'code'|'rule'|'table'} type
 * @property {string} key
 * @property {Node} node
 * @property {number} pos
 * @property {Kind} kind
 * @property {boolean} odd - Nothing a Doc's paragraphs can be
 * @property {string} segment
 * @property {string} [label] - A footnote's number, on its note
 * @property {number} [labelLength]
 * @property {number} [ordinal] - A table's place among the tables, which
 *   the shaping has made the same on both sides
 */

/**
 * A paragraph of the Doc as read.
 *
 * @typedef {Object} DocParagraph
 * @property {number} start
 * @property {number} end - Its newline's index
 * @property {string} named - Its named style
 * @property {boolean} bullet
 * @property {boolean} suggested - A suggested edit touches it
 * @property {boolean} protects - It holds what a deletion leaves: a picture,
 *   a break, an equation
 * @property {boolean} beforeBlock - A table, a table of contents or a
 *   section break follows it, so its newline cannot go
 * @property {boolean} last - Its newline is its segment's last
 * @property {Array<{start: number, text: string, style: TextStyle}>} runs
 * @property {number[]} breaks - Where its page and column breaks are
 */

/**
 * @typedef {{op: 'equal', a: Unit, b: Unit}|{op: 'delete', a: Unit}|{op: 'insert', b: Unit}|{op: 'keep', a: Unit}} Move
 */

/**
 * A paragraph of the document sent, and where it ends up.
 *
 * @typedef {Object} Ending
 * @property {Unit} b - Its end, or its rule
 * @property {string} segment
 * @property {{index: number}|{insert: Insert, offset: number}} at
 * @property {Kind} base - What it is in the Doc before it is styled
 * @property {string} named - Its named style there
 * @property {boolean} bullet - Whether it has a bullet there
 * @property {boolean} joined - Paragraphs of the Doc were joined into it
 * @property {Kind[]} involved - What those were
 */

/**
 * What a paragraph of the Doc whose newline a join takes runs on into.
 *
 * @typedef {Object} RunOn
 * @property {Kind[]} involved - It and the paragraphs after it, to the one
 *   whose newline stays
 * @property {boolean} bullet - Whether any of them has a bullet
 */

/**
 * @typedef {Object} Insert
 * @property {string} segment
 * @property {number} anchor
 * @property {number} seq - Its place among the insertions, in the document's order
 * @property {string} text
 * @property {Array<{b: Unit, offset: number}>} chars
 * @property {Look|null} inherited - How the character before it looks, from
 *   which Docs styles it
 */

/** Past this many characters changed in one stretch, the stretch goes whole. */
const MAX_EDITS = 3000

/** The font monospaced words go up in. */
const CODE_FONT = 'Courier New'

/** How far in a quote is indented, either side, as Docs indents one pasted. */
const QUOTE_INDENT = { magnitude: 30, unit: 'PT' }

/** The bullets a new list item is given. */
const PRESETS = { bullet: 'BULLET_DISC_CIRCLE_SQUARE', ordered: 'NUMBERED_DECIMAL_ALPHA_ROMAN' }

/**
 * What a join may take beside the newline it deletes: the spaces and line
 * breaks markdown drops anyway, and a page or column break (read as `\f`),
 * which left between the words joined would part them again.
 */
const TRIMMABLE = /^[ \t\v\f]*$/

/** A footnote's note, as the converter writes it. */
const NOTE = /^\[\^([^\]\s]+)\]:( |$)/

const NO_LOOK = /** @type {Look} */ ({
  bold: false,
  italic: false,
  strike: false,
  link: '',
  code: false,
})

/**
 * The requests that make a Doc's tab read as `target`.
 *
 * @param {Document} document - As `documents.get` returned it, with
 *   `suggestionsViewMode=SUGGESTIONS_INLINE`
 * @param {Node} target - The document, in the editor's schema
 * @param {Object} [options]
 * @param {string} [options.tabId]
 * @param {Record<string, import('@/types/models.js').PictureInfo>} [options.pictures]
 *   - The document's pictures, by name, as its row has them: those with the
 *   Doc's id are the Doc's
 * @returns {Written}
 */
export function writeDoc(document, target, { tabId, pictures = {} } = {}) {
  const read = readDoc(document, { tabId })
  const { revisionId } = read
  const tab = tabOf(document, read.tabId)
  if (!read.spans || !tab?.documentTab) return { requests: [], unsent: ['layout'], revisionId }
  const settled = withoutEmpty(withoutComments(parseMarkdown(serializeMarkdown(target))))
  // Suggestions go as suggestions, never as their markup.
  if (suggestionsIn(settled).length > 0)
    throw new Error('A suggestion’s markup would reach the Doc')

  // The tables the document's shape first; the words then against the Doc
  // as that leaves it.
  const shaped = shapeTables(tab.documentTab, read, settled, read.tabId)
  if (shaped.unsent.length > 0) return { requests: [], unsent: shaped.unsent, revisionId }
  let now = { read, tab }
  if (shaped.requests.length > 0) {
    try {
      const reshaped = applyRequests(document, shaped.requests, { tabId: read.tabId })
      const again = readDoc(reshaped, { tabId: read.tabId })
      now = { read: again, tab: tabOf(reshaped, again.tabId) }
    } catch {
      return { requests: [], unsent: ['table'], revisionId }
    }
  }
  const spans = now.read.spans
  const documentTab = now.tab?.documentTab
  if (!spans || !documentTab) return { requests: [], unsent: ['table'], revisionId }
  const writer = new Writer(documentTab, now.read.doc, spans, now.read.tabId, pictures)
  const words = writer.write(settled)
  return { requests: [...shaped.requests, ...words.requests], unsent: words.unsent, revisionId }
}

/**
 * The requests without the changes of style among them that change
 * nothing: written as a suggestion, each would be a suggestion of its own
 * ("Format: bold, italic, …") beside the change, though it changed nothing.
 * What they would change is asked of the Doc standing in (`drive/apply`).
 *
 * @param {Document} document
 * @param {object[]} requests
 * @param {string|undefined} tabId
 * @returns {object[]}
 */
export function withoutIdleStyles(document, requests, tabId) {
  /** @param {object[]} some */
  const made = some => JSON.stringify(applyRequests(document, some, { tabId }))
  let all
  try {
    all = made(requests)
  } catch {
    return requests
  }
  let kept = requests
  for (const request of requests) {
    if (!('updateTextStyle' in request || 'updateParagraphStyle' in request)) continue
    const without = kept.filter(each => each !== request)
    try {
      if (made(without) === all) kept = without
    } catch {
      // Needed for the rest to apply: kept.
    }
  }
  return kept
}

/**
 * A document without its empty list items and headings, which aren't
 * written: a Doc holds an empty paragraph as spacing and reads it back as
 * nothing, so one written would be written again at every sync. They stay
 * in the document.
 *
 * @param {Node} node
 * @returns {Node|null} Null for a block left with nothing in it
 */
function withoutEmpty(node) {
  if (node.isTextblock || node.isLeaf) return node
  const { heading, list_item: item, paragraph } = schema.nodes
  /** @type {Node[]} */
  const kept = []
  node.forEach(child => {
    const empty =
      (child.type === heading && child.content.size === 0) ||
      (child.type === item && child.childCount === 1 && child.firstChild?.content.size === 0)
    const left = empty ? null : withoutEmpty(child)
    if (left) kept.push(left)
  })
  if (kept.length === node.childCount && kept.every((child, i) => child === node.child(i))) {
    return node
  }
  if (kept.length === 0) {
    return node.type === schema.topNodeType ? node.copy(Fragment.from(paragraph.create())) : null
  }
  return node.copy(Fragment.fromArray(kept))
}

/**
 * A Doc's tab, by its id.
 *
 * @param {Document} document
 * @param {string} tabId
 */
const tabOf = (document, tabId) =>
  tabsOf(document).find(each => (each.tabProperties?.tabId ?? '') === tabId)

/**
 * A document with its comments' marks taken off: they cross apart.
 *
 * @param {Node} doc
 * @returns {Node}
 */
function withoutComments(doc) {
  const comment = schema.marks.comment
  let marked = false
  doc.descendants(node => {
    if (node.isText && comment.isInSet(node.marks)) marked = true
    return !marked
  })
  if (!marked) return doc
  /** @param {Node} node @returns {Node} */
  const strip = node => {
    if (node.isText) return node.mark(comment.removeFromSet(node.marks))
    /** @type {Node[]} */
    const content = []
    node.forEach(child => content.push(strip(child)))
    return node.copy(Fragment.from(content))
  }
  return strip(doc)
}

/**
 * How a run of text looks here.
 *
 * @param {readonly import('prosemirror-model').Mark[]} marks
 * @returns {Look}
 */
function lookOf(marks) {
  /** @type {Look} */
  const look = { ...NO_LOOK }
  for (const mark of marks) {
    const name = mark.type.name
    if (name === 'strong') look.bold = true
    else if (name === 'em') look.italic = true
    else if (name === 'strikethrough') look.strike = true
    else if (name === 'code') look.code = true
    else if (name === 'link') look.link = mark.attrs.href ?? ''
  }
  return look
}

/**
 * @param {Look|undefined} a
 * @param {Look|undefined} b
 * @returns {boolean}
 */
const sameLook = (a, b) =>
  !!a &&
  !!b &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.strike === b.strike &&
  a.link === b.link &&
  a.code === b.code

/**
 * @param {Kind} a
 * @param {Kind} b
 * @returns {boolean}
 */
const sameKind = (a, b) =>
  a.kind === b.kind &&
  (a.level ?? 0) === (b.level ?? 0) &&
  !!a.ordered === !!b.ordered &&
  (a.depth ?? 0) === (b.depth ?? 0)

/** @param {Kind} kind */
const kindKey = kind =>
  `${kind.kind}:${kind.level ?? ''}:${kind.ordered ? 'o' : ''}:${kind.depth ?? ''}`

/**
 * Every paragraph of a body, a footnote or a table's cells, in order.
 *
 * @param {StructuralElement[]} content
 * @param {DocumentTab} tab - For which of its inline objects are pictures
 * @returns {DocParagraph[]}
 */
function paragraphsOf(content, tab) {
  /** @type {DocParagraph[]} */
  const out = []
  /** @param {StructuralElement[]} blocks @param {boolean} inCell */
  const walk = (blocks, inCell) => {
    // A paragraph after one whose newline is suggested is one with it as
    // the converter reads it, so a suggestion touches both.
    let runsOn = false
    blocks.forEach((element, i) => {
      const paragraph = element.paragraph
      if (!paragraph) runsOn = false
      if (paragraph) {
        const start = element.startIndex ?? 0
        const next = blocks[i + 1]
        /** @type {DocParagraph['runs']} */
        const runs = []
        /** @type {number[]} */
        const breaks = []
        let suggested =
          Object.keys({
            ...paragraph.suggestedParagraphStyleChanges,
            ...paragraph.suggestedBulletChanges,
          }).length > 0
        if (runsOn) suggested = true
        runsOn = false
        let protects = (paragraph.positionedObjectIds?.length ?? 0) > 0
        for (const part of paragraph.elements ?? []) {
          const at = part.startIndex ?? 0
          const run = part.textRun
          if (run) {
            runs.push({ start: at, text: run.content ?? '', style: run.textStyle ?? {} })
            if (run.content?.endsWith('\n') && run.suggestedInsertionIds?.length) runsOn = true
            // Words a suggestion puts in are held, and those it takes out
            // are words, so either is written around; not a newline of one,
            // nor a change of style.
            const marked = !!(run.suggestedInsertionIds?.length || run.suggestedDeletionIds?.length)
            if (
              (marked && run.content?.includes('\n')) ||
              Object.keys(run.suggestedTextStyleChanges ?? {}).length
            ) {
              suggested = true
            }
            continue
          }
          const [kind, inline] = /** @type {[string, any]} */ (
            Object.entries(part).find(([key]) => !key.endsWith('Index')) ?? ['', {}]
          )
          if (inline?.suggestedInsertionIds?.length || inline?.suggestedDeletionIds?.length) {
            suggested = true
          }
          if (kind === 'pageBreak' || kind === 'columnBreak') breaks.push(at)
          // What is held protects its paragraph's newline; a picture the
          // document has goes as it does.
          const picture =
            kind === 'inlineObjectElement' &&
            !inCell &&
            !!tab.inlineObjects?.[inline?.inlineObjectId]?.inlineObjectProperties?.embeddedObject
              ?.imageProperties?.contentUri
          if (
            !picture &&
            !['person', 'richLink', 'dateElement', 'footnoteReference', 'horizontalRule'].includes(
              kind
            )
          ) {
            protects = true
          }
        }
        out.push({
          start,
          end: (element.endIndex ?? start + 1) - 1,
          named: paragraph.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT',
          bullet: !!paragraph.bullet,
          suggested,
          protects,
          beforeBlock: !!next && !next.paragraph,
          last: !inCell && i === blocks.length - 1,
          runs,
          breaks,
        })
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) walk(cell.content ?? [], true)
      }
    })
  }
  walk(content, false)
  return out
}

/**
 * The writing, for one tab: the Doc's paragraphs and spans looked up, the
 * documents compared, and the requests made.
 */
class Writer {
  /**
   * @param {DocumentTab} tab
   * @param {Node} doc - The Doc as read
   * @param {Span[]} spans
   * @param {string} tabId
   * @param {Record<string, import('@/types/models.js').PictureInfo>} [pictures]
   */
  constructor(tab, doc, spans, tabId, pictures = {}) {
    this.tab = tab
    /** @type {Record<string, import('@/types/models.js').PictureInfo>} */
    this.pictures = pictures
    /** @type {Set<string>} The Doc's pictures the document has had, by id. */
    this.known = new Set(
      Object.values(pictures).flatMap(picture => (picture.docsId ? [picture.docsId] : []))
    )
    this.doc = doc
    this.spans = spans
    this.tabId = tabId
    /** @type {Map<string, DocParagraph[]>} */
    this.paragraphs = new Map([['', paragraphsOf(tab.body?.content ?? [], tab)]])
    for (const [id, note] of Object.entries(tab.footnotes ?? {})) {
      this.paragraphs.set(id, paragraphsOf(note.content ?? [], tab))
    }
    /** @type {Map<string, TextStyle>} */
    this.named = new Map(
      (tab.namedStyles?.styles ?? []).map(style => [
        style.namedStyleType ?? '',
        style.textStyle ?? {},
      ])
    )
    /** @type {Map<string, Set<number>>} Where tables start, by segment. */
    this.tableStarts = new Map([['', tableStartsOf(tab.body?.content ?? [])]])
    /** @type {StructuralElement[]} The body's tables, in order. */
    this.tables = (tab.body?.content ?? []).filter(element => element.table)
    /** @type {Set<Unsent>} */
    this.unsent = new Set()
    /** @type {Array<{segment: string, start: number, end: number}>} */
    this.deletes = []
    /** @type {Insert[]} */
    this.inserts = []
    /** @type {Array<{segment: string, index: number, from: Look, to: Look}>} */
    this.restyled = []
    /** @type {Ending[]} */
    this.endings = []
  }

  /**
   * @param {Node} target - Settled, its comments taken off
   * @returns {{requests: object[], unsent: Unsent[]}}
   */
  write(target) {
    const theirs = this.#blocksOf(this.doc, true)
    const ours = this.#blocksOf(target, false)

    const notes = new Map(theirs.filter(block => block.segment).map(block => [block.label, block]))
    const body = theirs.filter(block => !block.segment)
    // The notes at the end of the document sent, each one the Doc has; a
    // paragraph elsewhere that only starts like one is words.
    let cut = ours.length
    while (cut > 0 && ours[cut - 1].label !== undefined && notes.has(ours[cut - 1].label)) cut--
    // A note at the end that the Doc has none of is a footnote to make.
    for (let k = cut - 1; k >= 0 && ours[k].label !== undefined; k--) this.unsent.add('footnote')
    for (const block of ours.slice(0, cut)) {
      delete block.label
      delete block.labelLength
    }
    this.#compare('', body, ours.slice(0, cut))
    for (const note of ours.slice(cut)) {
      const theirsNote = /** @type {Block} */ (notes.get(note.label))
      this.#compare(theirsNote.segment, [theirsNote], [{ ...note, segment: theirsNote.segment }])
    }
    return { requests: this.#requests(), unsent: [...this.unsent] }
  }

  /**
   * A document's blocks, in order: each paragraph, heading, list item, quoted
   * paragraph and code block, each rule and each table.
   *
   * @param {Node} doc
   * @param {boolean} read - Whether it is the Doc as read, whose notes are
   *   known by their spans
   * @returns {Block[]}
   */
  #blocksOf(doc, read) {
    /** @type {Block[]} */
    const out = []
    let tables = 0
    /**
     * @param {Node} node
     * @param {number} pos
     * @param {{list?: {ordered: boolean, depth: number}, quote?: boolean, odd?: boolean}} context
     */
    const visit = (node, pos, context) => {
      const name = node.type.name
      const inside = !!(context.list || context.quote)
      /** @param {Block['type']} type @param {Kind} kind @param {boolean} odd */
      const add = (type, kind, odd) => {
        const key = `${type}|${kindKey(kind)}|${odd}|${JSON.stringify(node.toJSON())}`
        out.push({ type, key, node, pos, kind, odd, segment: '' })
      }
      if (name === 'paragraph') {
        /** @type {Kind} */
        const kind = context.list
          ? { kind: 'list', ordered: context.list.ordered, depth: context.list.depth }
          : context.quote
            ? { kind: 'quote' }
            : { kind: 'paragraph' }
        add('text', kind, !!context.odd)
      } else if (name === 'heading') {
        add('text', { kind: 'heading', level: node.attrs.level }, !!context.odd || inside)
      } else if (name === 'code_block') {
        add('code', { kind: 'code' }, !!context.odd || inside)
      } else if (name === 'horizontal_rule') {
        add('rule', { kind: 'paragraph' }, !!context.odd || inside)
      } else if (name === 'table') {
        const odd = !!context.odd || inside
        add('table', { kind: 'table' }, odd)
        // Laid against the table in the same place, whatever it holds.
        if (!odd) Object.assign(/** @type {Block} */ (out.at(-1)), { ordinal: tables++ })
      } else if (name === 'blockquote') {
        node.forEach((child, offset) =>
          visit(child, pos + 1 + offset, { ...context, quote: true, odd: context.odd || inside })
        )
      } else if (name === 'bullet_list' || name === 'ordered_list') {
        const list = {
          ordered: name === 'ordered_list',
          depth: context.list ? context.list.depth + 1 : 0,
        }
        node.forEach((item, offset) =>
          visit(item, pos + 1 + offset, { ...context, list, odd: context.odd || !!context.quote })
        )
      } else if (name === 'list_item') {
        node.forEach((child, offset, index) =>
          visit(child, pos + 1 + offset, {
            ...context,
            // A second paragraph in an item has no bullet of its own.
            odd: context.odd || (index > 0 && child.isTextblock),
          })
        )
      } else {
        node.forEach((child, offset) => visit(child, pos + 1 + offset, context))
      }
    }
    doc.forEach((child, offset) => visit(child, offset, {}))

    for (const block of out) {
      if (block.type !== 'text' || block.kind.kind !== 'paragraph') continue
      const label = NOTE.exec(block.node.textContent)
      if (!label) continue
      if (read) {
        const span = this.#spansWithin(block.pos, block.pos + block.node.nodeSize).find(
          each => each.segment
        )
        if (!span?.segment) continue
        block.segment = span.segment
      }
      block.label = label[1]
      block.labelLength = label[0].length
      // After its key, which is the same either side.
      block.kind = { kind: 'footnote' }
    }
    return out
  }

  /**
   * The spans whose place is in `[from, to]`.
   *
   * @param {number} from
   * @param {number} to
   * @returns {Span[]}
   */
  #spansWithin(from, to) {
    let lo = 0
    let hi = this.spans.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.spans[mid].pos < from) lo = mid + 1
      else hi = mid
    }
    const out = []
    for (let i = lo; i < this.spans.length && this.spans[i].pos <= to; i++) out.push(this.spans[i])
    return out
  }

  /**
   * The Doc's paragraph an index is in.
   *
   * @param {string} segment
   * @param {number} index
   * @returns {DocParagraph|undefined}
   */
  #paragraphAt(segment, index) {
    const list = this.paragraphs.get(segment) ?? []
    let lo = 0
    let hi = list.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const paragraph = list[mid]
      if (index < paragraph.start) hi = mid - 1
      else if (index > paragraph.end) lo = mid + 1
      else return paragraph
    }
    return undefined
  }

  /**
   * The character of the Doc at an index, if it is text; a page or column
   * break as `\f`.
   *
   * @param {string} segment
   * @param {number} index
   * @returns {string}
   */
  #charAt(segment, index) {
    const paragraph = this.#paragraphAt(segment, index)
    const run = paragraph?.runs.find(
      each => index >= each.start && index < each.start + each.text.length
    )
    if (run) return run.text[index - run.start]
    return paragraph?.breaks.includes(index) ? '\f' : ''
  }

  /**
   * How the Doc's character before an index looks, which text inserted
   * there takes: the one after it at a paragraph's start.
   *
   * @param {string} segment
   * @param {number} index
   * @returns {Look|null}
   */
  #lookBefore(segment, index) {
    const paragraph = this.#paragraphAt(segment, index)
    if (!paragraph) return null
    const at = index > paragraph.start ? index - 1 : index
    const run = paragraph.runs.find(each => at >= each.start && at < each.start + each.text.length)
    if (!run) return null
    const font =
      run.style.weightedFontFamily?.fontFamily ??
      this.named.get(paragraph.named)?.weightedFontFamily?.fontFamily ??
      this.named.get('NORMAL_TEXT')?.weightedFontFamily?.fontFamily ??
      ''
    return {
      bold: !!run.style.bold,
      italic: !!run.style.italic,
      strike: !!run.style.strikethrough,
      link: run.style.link?.url ?? '',
      code: MONOSPACED.test(font),
    }
  }

  /**
   * A block as units: the Doc's, with where each is, or the document's.
   *
   * @param {Block} block
   * @param {boolean} read
   * @returns {Unit[]}
   */
  #units(block, read) {
    const { segment, kind } = block
    if (block.type === 'table') {
      // One the shaping placed is known by its place, as its block is.
      const key = block.ordinal === undefined ? JSON.stringify(block.node.toJSON()) : block.ordinal
      /** @type {Unit} */
      const unit = { type: 'table', key: `t${key}`, segment, kind }
      const element = read && block.ordinal !== undefined ? this.tables[block.ordinal] : undefined
      if (element) {
        unit.index = element.startIndex ?? 0
        unit.size = (element.endIndex ?? unit.index) - unit.index
      }
      return [unit]
    }
    if (block.type === 'rule') {
      /** @type {Unit} */
      const unit = { type: 'rule', key: 'r', segment, kind }
      if (read) {
        const span = this.#spansWithin(block.pos, block.pos).find(each => each.kind === 'rule')
        if (span) Object.assign(unit, { index: span.index, size: span.size })
        unit.paragraph = this.#paragraphAt(segment, unit.index ?? -1)
      }
      return [unit]
    }

    const start = block.pos + 1
    const end = start + block.node.content.size
    const spans = read ? this.#spansWithin(block.pos, end) : []
    const covering = spans.filter(
      span => (span.kind === 'text' || span.kind === 'chip') && span.length > 0
    )
    let next = 0
    /** @param {number} pos @returns {Span|null} */
    const spanAt = pos => {
      while (next < covering.length && covering[next].pos + covering[next].length <= pos) next++
      const span = covering[next]
      return span && span.pos <= pos ? span : null
    }
    /** @type {Unit[]} */
    const units = []
    /** @param {Unit} unit */
    const push = unit => {
      if (read && unit.index !== undefined) unit.paragraph = this.#paragraphAt(segment, unit.index)
      units.push(unit)
    }
    const code = block.type === 'code'
    block.node.forEach((child, offset) => {
      const at = start + offset
      if (child.isText) {
        const look = code ? { ...NO_LOOK, code: true } : lookOf(child.marks)
        const text = child.text ?? ''
        for (let k = 0; k < text.length; k++) {
          const char = text[k]
          const span = read ? spanAt(at + k) : null
          const index = span
            ? span.index + (span.kind === 'chip' ? 0 : at + k - span.pos)
            : undefined
          const fixed = read
            ? !span
            : block.labelLength !== undefined && offset + k < block.labelLength
          if (fixed) {
            push({ type: 'fixed', key: `f${char}`, char, segment, kind })
          } else if (code && char === '\n') {
            // A newline in code is a paragraph's end, or a line break in one.
            const isBreak = read && index !== undefined && this.#charAt(segment, index) === '\v'
            push(
              isBreak
                ? { type: 'break', key: 'b', segment, kind, index, size: 1 }
                : { type: 'end', key: 'e', segment, kind, index, size: 1 }
            )
          } else {
            push({
              type: 'char',
              key: `c${char}`,
              char,
              look,
              segment,
              kind,
              index,
              size: 1,
              ...(span?.kind === 'chip' && { chip: span.index }),
            })
          }
        }
      } else if (child.type.name === 'image') {
        push(this.#picture(child, at, spans, read, segment, kind))
      } else if (child.type.name === 'hard_break') {
        const span = read ? spanAt(at) : null
        push({
          type: 'break',
          key: 'b',
          segment,
          kind,
          index: span ? span.index + (at - span.pos) : undefined,
          size: 1,
        })
      }
    })

    /** @type {Unit} */
    const close = { type: 'end', key: 'e', segment, kind, size: 1 }
    if (read) {
      const own = spans.find(span => span.kind === 'end' && span.pos === end)
      const parting = spans.find(
        span =>
          span.kind === 'held' &&
          span.pos === end &&
          (span.held === 'pageBreak' || span.held === 'columnBreak')
      )
      if (own) close.index = own.index
      else if (parting) Object.assign(close, { index: parting.index, virtual: true })
      else close.virtual = true
    }
    push(close)
    return units
  }

  /**
   * A picture as a unit, known by the Doc's id for it: the converter's span
   * says it for the Doc's, the row for the document's. A picture with no id
   * is one the Doc does not have.
   *
   * @param {Node} node
   * @param {number} pos
   * @param {Span[]} spans
   * @param {boolean} read
   * @param {string} segment
   * @param {Kind} kind
   * @returns {Unit}
   */
  #picture(node, pos, spans, read, segment, kind) {
    if (read) {
      const span = spans.find(each => each.kind === 'picture' && each.pos === pos)
      const object = span?.object ?? ''
      return {
        type: 'picture',
        key: `p${object}`,
        segment,
        kind,
        index: span?.index,
        size: 1,
        object,
      }
    }
    const src = String(node.attrs.src ?? '')
    const name = pictureOf(src)?.name
    const id = name ? this.pictures[name]?.docsId : undefined
    return { type: 'picture', key: id ? `p${id}` : `q${src}`, segment, kind }
  }

  /**
   * Compare one segment's blocks and gather what to write.
   *
   * @param {string} segment
   * @param {Block[]} theirs
   * @param {Block[]} ours
   */
  #compare(segment, theirs, ours) {
    const steps = this.#steps(theirs, ours)
    /** @type {Array<{from: number, to: number}>} */
    const changes = []
    steps.forEach((step, i) => {
      if (step.op === 'equal') return
      const last = changes.at(-1)
      if (last && last.to === i) last.to = i + 1
      else changes.push({ from: i, to: i + 1 })
    })

    for (const { from, to } of changes) {
      let first = from
      // A change at the end takes the block before it in, so that the Doc's
      // last newline can be kept.
      if (to === steps.length && first > 0 && steps[first - 1].op === 'equal') first--
      const before = first > 0 ? steps[first - 1] : null
      const after = to < steps.length ? steps[to] : null

      /** @type {Block[]} */
      const left = []
      /** @type {Block[]} */
      const right = []
      for (const step of steps.slice(first, to)) {
        if (step.op !== 'insert') left.push(theirs[step.a])
        if (step.op !== 'delete') right.push(ours[step.b])
      }
      if (right.some(block => block.odd)) this.unsent.add('layout')

      const moves = wordMoves(
        left.flatMap(block => this.#units(block, true)),
        right.flatMap(block => this.#units(block, false))
      )
      // Around the change, the blocks either side as they stand, whole, so
      // that a paragraph of the Doc is never taken for one wholly deleted
      // when only its end is in the change.
      /** @param {{a: number, b: number}} step @returns {Move[]} */
      const around = step => {
        const a = this.#units(theirs[step.a], true)
        const b = this.#units(ours[step.b], false)
        return a.map((unit, k) => ({ op: /** @type {const} */ ('equal'), a: unit, b: b[k] }))
      }
      if (before?.op === 'equal') moves.unshift(...around(before))
      if (after?.op === 'equal') moves.push(...around(after))
      this.#gather(segment, this.#settle(moves))
    }

    for (const step of steps) {
      if (step.op !== 'equal' || theirs[step.a].type !== 'table') continue
      if (!theirs[step.a].node.eq(ours[step.b].node))
        this.#compareTable(theirs[step.a], ours[step.b])
    }
  }

  /**
   * Two documents' blocks laid against each other: the tables, which the
   * shaping has made the same in number and shape, each against the one in
   * its place, and the blocks between them compared.
   *
   * @param {Block[]} theirs
   * @param {Block[]} ours
   * @returns {import('@/utils/diff.js').Step[]}
   */
  #steps(theirs, ours) {
    /** @param {Block[]} blocks */
    const tables = blocks => blocks.flatMap((block, i) => (block.ordinal !== undefined ? [i] : []))
    const [ta, tb] = [tables(theirs), tables(ours)]
    /** @param {Block[]} a @param {Block[]} b */
    const compared = (a, b) =>
      diffSequences(
        a.map(block => block.key),
        b.map(block => block.key)
      ) ?? []
    if (ta.length !== tb.length) return compared(theirs, ours)
    /** @type {import('@/utils/diff.js').Step[]} */
    const out = []
    let a0 = 0
    let b0 = 0
    for (let k = 0; k <= ta.length; k++) {
      const a1 = k < ta.length ? ta[k] : theirs.length
      const b1 = k < tb.length ? tb[k] : ours.length
      for (const step of compared(theirs.slice(a0, a1), ours.slice(b0, b1))) {
        if (step.op === 'equal') out.push({ op: 'equal', a: step.a + a0, b: step.b + b0 })
        else if (step.op === 'delete') out.push({ op: 'delete', a: step.a + a0 })
        else out.push({ op: 'insert', b: step.b + b0 })
      }
      if (k < ta.length) out.push({ op: 'equal', a: a1, b: b1 })
      a0 = a1 + 1
      b0 = b1 + 1
    }
    return out
  }

  /**
   * A table of the Doc's and the document's in its place, of one shape,
   * compared cell by cell: each cell's words as a paragraph's.
   *
   * @param {Block} theirs
   * @param {Block} ours
   */
  #compareTable(theirs, ours) {
    /** @param {Block} block @returns {Block[][]} */
    const cellsOf = block => {
      /** @type {Block[][]} */
      const rows = []
      block.node.forEach((row, rowOffset) => {
        /** @type {Block[]} */
        const cells = []
        row.forEach((cell, cellOffset) =>
          cells.push({
            type: 'text',
            key: '',
            node: cell,
            pos: block.pos + 1 + rowOffset + 1 + cellOffset,
            kind: { kind: 'table' },
            odd: false,
            segment: '',
          })
        )
        rows.push(cells)
      })
      return rows
    }
    const [a, b] = [cellsOf(theirs), cellsOf(ours)]
    if (a.length !== b.length || a.some((row, r) => row.length !== b[r].length)) {
      this.unsent.add('table')
      return
    }
    a.forEach((row, r) =>
      row.forEach((cell, c) => {
        const other = b[r][c]
        if (cell.node.eq(other.node)) return
        const moves = wordMoves(this.#units(cell, true), this.#units(other, false))
        this.#gather('', this.#settle(moves))
      })
    )
  }

  /**
   * The moves made sendable: a chip whose words changed is replaced whole; a
   * page break's end is kept; a newline that cannot go is kept, or traded
   * for the one before it.
   *
   * @param {Move[]} moves
   * @returns {Move[]}
   */
  #settle(moves) {
    // A chip is broken by a word of it deleted or restyled, or by anything
    // put between its words, or by words newly in its link against it, put
    // there or restyled, which read back as words of it.
    /** @type {Set<number>} */
    const broken = new Set()
    /** @type {Map<number, {first: number, last: number, link: string}>} */
    const reach = new Map()
    moves.forEach((move, i) => {
      if (move.op === 'insert' || move.a.chip === undefined) return
      const chip = move.a.chip
      const seen = reach.get(chip)
      reach.set(chip, { first: seen?.first ?? i, last: i, link: move.a.look?.link ?? '' })
      if (move.op === 'delete' || (move.op === 'equal' && !sameLook(move.a.look, move.b.look))) {
        broken.add(chip)
      }
    })
    /**
     * Whether what will be against a chip on one side of it, past what is
     * deleted there, is newly in its link.
     *
     * @param {number} from - The move beside the chip
     * @param {number} step - Away from it
     * @param {string} link
     */
    const linkedAgainst = (from, step, link) => {
      for (let i = from; i >= 0 && i < moves.length; i += step) {
        const move = moves[i]
        if (move.op === 'insert') return move.b.look?.link === link
        if (move.op === 'equal') return move.a.look?.link !== link && move.b.look?.link === link
        if (move.op !== 'delete') return false
      }
      return false
    }
    for (const [chip, { first, last, link }] of reach) {
      if (
        moves.slice(first, last).some(move => move.op === 'insert') ||
        (link && (linkedAgainst(first - 1, -1, link) || linkedAgainst(last + 1, 1, link)))
      ) {
        broken.add(chip)
      }
    }
    let out = moves
    if (broken.size > 0) {
      /** @type {Move[]} */
      const split = []
      for (const move of moves) {
        if (move.op === 'equal' && move.a.chip !== undefined && broken.has(move.a.chip)) {
          split.push({ op: 'delete', a: move.a }, { op: 'insert', b: move.b })
        } else {
          split.push(move)
        }
      }
      out = deletionsFirst(split)
    }

    // A picture of the Doc's goes only if the document had it: the row
    // knows its id.
    out = out.map(move =>
      move.op === 'delete' && move.a.type === 'picture' && !this.known.has(move.a.object ?? '')
        ? { op: 'keep', a: move.a }
        : move
    )

    // Ends that cannot go.
    for (let i = 0; i < out.length; i++) {
      const move = out[i]
      if (move.op === 'delete' && move.a.type === 'rule') {
        const paragraph = move.a.paragraph
        if (paragraph && (paragraph.last || paragraph.beforeBlock)) this.unsent.add('layout')
        continue
      }
      if (move.op !== 'delete' || move.a.type !== 'end') continue
      const unit = move.a
      const paragraph = unit.paragraph
      if (!paragraph || unit.index === undefined) {
        out[i] = { op: 'keep', a: unit }
        continue
      }
      // A page break between two paragraphs goes when they are joined.
      if (unit.virtual) continue
      const whole = this.#wholly(out, paragraph)
      // The second of two paragraphs a page break parts, gone: the break goes
      // and the newline stays, for the first.
      let k = i - 1
      while (k >= 0 && out[k].op === 'delete') k--
      const parted = out[k]
      if (
        !whole &&
        parted?.op === 'equal' &&
        parted.a.type === 'end' &&
        parted.a.virtual &&
        parted.a.paragraph === paragraph
      ) {
        out[k] = { op: 'delete', a: parted.a }
        out[i] = { op: 'equal', a: unit, b: parted.b }
        continue
      }
      if (whole && paragraph.protects) {
        // Its words go, its picture stays, in a paragraph that reads as empty.
        out[i] = { op: 'keep', a: unit }
        continue
      }
      if (!paragraph.last && !paragraph.beforeBlock) continue
      // Trade it for the newline before it, if nothing but deletions lies
      // between: the Doc keeps its last newline, and the one before a table.
      let j = i - 1
      while (j >= 0 && out[j].op === 'delete') j--
      const previous = out[j]
      if (
        whole &&
        previous?.op === 'equal' &&
        previous.a.type === 'end' &&
        !previous.a.virtual &&
        previous.a.paragraph &&
        !previous.a.paragraph.beforeBlock
      ) {
        out[j] = { op: 'delete', a: previous.a }
        out[i] = { op: 'equal', a: unit, b: previous.b }
      } else if (whole) {
        out[i] = { op: 'keep', a: unit }
      } else {
        out[i] = { op: 'keep', a: unit }
        this.unsent.add('layout')
      }
    }
    // Two paragraphs a page break parts are one paragraph of the Doc, styled
    // as one. One to be styled apart from it is parted from the other by a
    // newline after the break.
    for (let i = 0; i < out.length; i++) {
      const move = out[i]
      if (move.op !== 'equal' || !move.a.virtual) continue
      // The paragraph of the Doc goes on to the next newline after the break,
      // the Doc's or one put in, and is styled as that one's paragraph is.
      const following = out
        .slice(i + 1)
        .find(
          each =>
            (each.op === 'equal' && each.a.type === 'end') ||
            (each.op === 'insert' && (each.b.type === 'end' || each.b.type === 'rule'))
        )
      const wanted =
        following && following.op !== 'delete' && following.op !== 'keep' ? following.b.kind : null
      const apart =
        !sameKind(move.b.kind, move.a.kind) || (wanted !== null && !sameKind(move.b.kind, wanted))
      if (apart) out.splice(i, 1, { op: 'keep', a: move.a }, { op: 'insert', b: move.b })
    }
    return out
  }

  /**
   * Whether every unit of a paragraph of the Doc goes.
   *
   * @param {Move[]} moves
   * @param {DocParagraph} paragraph
   * @returns {boolean}
   */
  #wholly(moves, paragraph) {
    let any = false
    for (const move of moves) {
      if (move.op === 'insert' || move.a.paragraph !== paragraph) continue
      if (move.op !== 'delete') return false
      any = true
    }
    return any
  }

  /**
   * Walk the moves and gather the deletions, insertions, restylings and
   * paragraphs they make.
   *
   * @param {string} segment
   * @param {Move[]} moves
   */
  #gather(segment, moves) {
    /** @type {Unit|null} */
    let previous = null
    /** Joins since the last paragraph's end, and what was joined. */
    let carried = { joined: false, involved: /** @type {Kind[]} */ ([]) }
    /** @type {{start: number, end: number}|null} */
    let deleting = null
    /** @type {Set<DocParagraph>} Paragraphs of the Doc that go whole. */
    const whole = new Set()
    /** @type {Set<DocParagraph>} */
    const removed = new Set()
    for (const move of moves) {
      if (move.op === 'delete' && move.a.paragraph && this.#wholly(moves, move.a.paragraph)) {
        whole.add(move.a.paragraph)
      }
    }
    // The Doc's paragraphs whose newlines a join takes, each with the
    // paragraphs it runs on into, up to the newline that stays. A newline
    // put in one is typed into all of them, and makes a paragraph styled as
    // Docs styles the join: so it is styled whole, as a join is.
    /** @type {Map<DocParagraph, RunOn>} */
    const running = new Map()
    /** @type {Array<{paragraph: DocParagraph, kind: Kind}>} */
    let joining = []
    for (const move of moves) {
      if (move.op === 'insert' || move.a.type !== 'end' || move.a.virtual) continue
      const paragraph = move.a.paragraph
      if (!paragraph || whole.has(paragraph)) continue
      joining.push({ paragraph, kind: move.a.kind })
      if (move.op === 'delete') continue
      joining.slice(0, -1).forEach((each, i) => {
        const on = joining.slice(i)
        running.set(each.paragraph, {
          involved: on.map(one => one.kind),
          bullet: on.some(one => one.paragraph.bullet),
        })
      })
      joining = []
    }

    const flush = () => {
      if (deleting) this.deletes.push({ segment, ...deleting })
      deleting = null
    }
    /** @param {number} start @param {number} end */
    const remove = (start, end) => {
      if (deleting && deleting.end >= start) deleting.end = Math.max(deleting.end, end)
      else {
        flush()
        deleting = { start, end }
      }
    }
    /** @param {Unit} unit */
    const check = unit => {
      if (unit.paragraph?.suggested) this.unsent.add('suggestion')
    }

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]
      if (move.op === 'insert') {
        let j = i
        while (j < moves.length && moves[j].op === 'insert') j++
        flush()
        const run = /** @type {Array<{op: 'insert', b: Unit}>} */ (moves.slice(i, j))
        const after = moves
          .slice(j)
          .find(each => each.op !== 'insert' && each.a.index !== undefined)
        const next = after && after.op !== 'insert' ? after.a : null
        carried = this.#insertRun(segment, run, moves[i - 1], previous, next, carried, running)
        i = j - 1
        continue
      }
      const unit = move.a
      if (move.op === 'delete') {
        check(unit)
        if (unit.type === 'fixed') this.unsent.add('footnote')
        if (unit.type === 'table') this.unsent.add('table')
        if (unit.index === undefined) continue
        const paragraph = unit.paragraph
        if (paragraph && whole.has(paragraph)) {
          // A paragraph gone whole goes with the whitespace it held, and
          // joins nothing.
          if (!removed.has(paragraph)) remove(paragraph.start, paragraph.end + 1)
          removed.add(paragraph)
        } else if (unit.type === 'end' && paragraph) {
          // A join takes the whitespace either side of the newline with it.
          // Its own reach in order; what it takes further on, apart.
          const [own, ...further] = this.#joinReach(segment, unit, previous, moves.slice(i + 1))
          remove(own[0], own[1])
          for (const [start, end] of further) this.deletes.push({ segment, start, end })
          carried = { joined: true, involved: [...carried.involved, unit.kind] }
        } else {
          remove(unit.index, unit.index + (unit.size ?? 1))
        }
        previous = unit
        continue
      }
      flush()
      if (move.op === 'equal') {
        const b = move.b
        if (unit.type === 'char' && !sameLook(unit.look, b.look) && unit.index !== undefined) {
          check(unit)
          this.restyled.push({
            segment,
            index: unit.index,
            from: /** @type {Look} */ (unit.look),
            to: /** @type {Look} */ (b.look),
          })
        }
        if (unit.type === 'end' && unit.index !== undefined) {
          const paragraph = unit.paragraph
          this.endings.push({
            b,
            segment,
            at: { index: unit.index },
            base: unit.kind,
            named: paragraph?.named ?? 'NORMAL_TEXT',
            bullet: !!paragraph?.bullet,
            joined: carried.joined,
            involved: [...carried.involved, unit.kind],
          })
          if (carried.joined || !sameKind(unit.kind, b.kind)) check(unit)
          carried = { joined: false, involved: [] }
        }
      }
      if (unit.index !== undefined) previous = unit
    }
    flush()
  }

  /**
   * Where a join's deletion reaches: its newline, and the spaces markdown
   * held either side of it.
   *
   * @param {string} segment
   * @param {Unit} unit - The newline going
   * @param {Unit|null} previous - The Doc's unit before it
   * @param {Move[]} rest - The moves after it
   * @returns {Array<[number, number]>}
   */
  #joinReach(segment, unit, previous, rest) {
    const newline = /** @type {number} */ (unit.index)
    let start = newline
    const paragraph = unit.paragraph
    if (previous?.index !== undefined && previous.paragraph === paragraph) {
      const from = previous.index + (previous.size ?? 1)
      if (TRIMMABLE.test(this.#textBetween(segment, from, newline))) start = from
    }
    /** @type {Array<[number, number]>} */
    const out = [[start, newline + 1]]
    // Forward to the words joined, past the paragraphs held between, which
    // the units do not show: their newlines, spacing and breaks go, and what
    // they hold, a picture, stays, in the paragraph joined. What else lies there
    // the moves delete already.
    const kept = rest.find(
      move => move.op !== 'insert' && move.op !== 'delete' && move.a.index !== undefined
    )
    const to = kept && kept.op !== 'insert' ? /** @type {number} */ (kept.a.index) : Infinity
    /** @type {Set<number>} */
    const shown = new Set()
    for (const move of rest) {
      if (move.op !== 'insert' && move.a.type === 'end' && move.a.index !== undefined)
        shown.add(move.a.index)
    }
    /** @param {number} at */
    const take = at => {
      const last = out[out.length - 1]
      if (last[1] === at) last[1] = at + 1
      else out.push([at, at + 1])
    }
    for (const held of this.paragraphs.get(segment) ?? []) {
      if (held.start <= newline || held.end >= to || shown.has(held.end)) continue
      if (held.beforeBlock || held.last) {
        this.unsent.add('layout')
        continue
      }
      for (let at = held.start; at <= held.end; at++) {
        if (/^[ \t\v\n\f]$/.test(this.#charAt(segment, at))) take(at)
      }
    }
    // And the spacing at the start of the paragraph joined.
    if (kept && kept.op !== 'insert' && Number.isFinite(to)) {
      const into = this.#paragraphAt(segment, to)
      if (into && into.start > newline) {
        const lead = this.#textBetween(segment, into.start, to)
        if (TRIMMABLE.test(lead)) for (let at = into.start; at < to; at++) take(at)
      }
    }
    return out
  }

  /**
   * The Doc's text between two indices, an element as a character that is
   * not whitespace.
   *
   * @param {string} segment
   * @param {number} from
   * @param {number} to
   * @returns {string}
   */
  #textBetween(segment, from, to) {
    let out = ''
    for (let i = from; i < to; i++) out += this.#charAt(segment, i) || '\uFFFC'
    return out
  }

  /**
   * One run of insertions: where it goes in, as what text, and the
   * paragraphs it makes.
   *
   * @param {string} segment
   * @param {Array<{op: 'insert', b: Unit}>} run
   * @param {Move|undefined} before - The move before the run
   * @param {Unit|null} previous - The Doc's last unit before it
   * @param {Unit|null} next - The Doc's next unit after it
   * @param {{joined: boolean, involved: Kind[]}} carried - Joins since the
   *   last paragraph's end
   * @param {Map<DocParagraph, RunOn>} running - The Doc's paragraphs a join
   *   takes the newline of
   * @returns {{joined: boolean, involved: Kind[]}} What it carries on to the
   *   next paragraph's end
   */
  #insertRun(segment, run, before, previous, next, carried, running) {
    // A paragraph of nothing but pictures that stay here, one pasted on a
    // line of its own, makes no empty paragraph in the Doc.
    /** @type {Array<{op: 'insert', b: Unit}>} */
    const sent = []
    /** @type {Array<{op: 'insert', b: Unit}>} */
    let made = []
    for (const move of run) {
      made.push(move)
      if (move.b.type !== 'end' && move.b.type !== 'rule') continue
      const pictures = made.some(each => each.b.type === 'picture')
      if (!pictures || !made.every(each => each.b.type === 'picture' || each.b.type === 'end')) {
        sent.push(...made)
      }
      made = []
    }
    sent.push(...made)
    if (!sent.some(each => each.b.type !== 'picture')) return carried
    run = sent

    const last = run[run.length - 1].b
    const closes = last.type === 'end' || last.type === 'rule'
    const after = before && before.op === 'equal' ? before.a : null
    // Whole paragraphs after a paragraph's end go in before that newline, a
    // newline first, so they never land at a table's start or past the end.
    const rotate =
      closes &&
      !!after &&
      (after.type === 'end' || after.type === 'rule') &&
      !after.virtual &&
      after.index !== undefined
    /** @type {number|undefined} */
    let anchor
    /** @type {Unit|null} */
    let from = null
    if (rotate && after) {
      anchor =
        /** @type {number} */ (after.index) + (after.type === 'rule' ? (after.size ?? 1) - 1 : 0)
      from = after
    } else if (
      previous &&
      previous.index !== undefined &&
      !['end', 'rule', 'table'].includes(previous.type)
    ) {
      anchor = previous.index + (previous.size ?? 1)
      from = previous
    } else if (previous?.type === 'table' && previous.index !== undefined) {
      // At the start of the paragraph after the table, which Docs always has.
      anchor = previous.index + (previous.size ?? 0)
      const into = this.#paragraphAt(segment, anchor)
      from = next && into && next.paragraph === into ? next : null
    } else if (next?.index !== undefined && next.type !== 'table') {
      anchor = next.index
      from = next
    } else {
      // Nothing of the Doc's shows before it, nor after but a table: into
      // the empty paragraph Docs keeps there, before the table or last.
      const empty =
        next?.type === 'table' && next.index !== undefined
          ? this.#paragraphAt(segment, next.index - 1)
          : (this.paragraphs.get(segment) ?? []).find(each => each.last)
      if (empty && empty.start === empty.end) anchor = empty.start
    }
    const paragraph = anchor === undefined ? undefined : this.#paragraphAt(segment, anchor)
    // Paragraphs put into an empty one end with its newline.
    const fill = closes && !rotate && !!paragraph && paragraph.start === paragraph.end
    if (anchor === undefined || !paragraph || this.tableStarts.get(segment)?.has(anchor)) {
      // A table put where nothing can go after it is the table's to say.
      this.unsent.add(run.some(move => move.b.type === 'table') ? 'table' : 'layout')
      return carried
    }
    if (paragraph.suggested) this.unsent.add('suggestion')

    /** @type {Insert} */
    const insert = {
      segment,
      anchor,
      seq: this.inserts.length,
      text: rotate ? '\n' : '',
      chars: [],
      inherited: this.#lookBefore(segment, anchor),
    }
    // A newline put in a paragraph a join runs on makes one styled as the
    // join is, so styled whole.
    const on = running.get(paragraph)
    const copied = {
      base: from?.kind ?? { kind: 'paragraph' },
      named: paragraph.named,
      bullet: paragraph.bullet || !!on?.bullet,
    }
    if (rotate) {
      // The paragraph before keeps its words and takes the new newline; the
      // last one made takes its old one.
      const ending = this.endings.at(-1)
      if (ending && before?.op === 'equal' && ending.b === before.b) {
        ending.at = { insert, offset: 0 }
      }
    }
    let joined = carried.joined || !!on
    let involved = [...carried.involved, ...(on?.involved ?? [])]
    run.forEach(({ b }, i) => {
      const lastOne = i === run.length - 1
      if (b.type === 'char') {
        insert.chars.push({ b, offset: insert.text.length })
        insert.text += b.char
      } else if (b.type === 'break') {
        insert.text += '\v'
      } else if (b.type === 'end' || b.type === 'rule') {
        if (b.type === 'rule') insert.text += '* * *'
        const own = (rotate || fill) && lastOne
        const at = own
          ? { index: /** @type {number} */ (anchor) }
          : { insert, offset: insert.text.length }
        if (!own) insert.text += '\n'
        this.endings.push({
          b,
          segment,
          at,
          ...copied,
          joined,
          involved: [...involved, copied.base],
        })
        joined = !!on
        involved = [...(on?.involved ?? [])]
      } else if (b.type === 'picture') {
        // One added here, or one the Doc no longer has: it stays here, as
        // nothing can send a picture yet.
      } else if (b.type === 'fixed') {
        this.unsent.add('footnote')
      } else {
        this.unsent.add('table')
      }
    })
    if (insert.text) this.inserts.push(insert)
    return { joined, involved }
  }

  /**
   * The requests: the insertions and deletions, last first, then the styles
   * at the indices they leave.
   *
   * @returns {object[]}
   */
  #requests() {
    /** @type {object[]} */
    const requests = []
    const segments = new Set([
      ...this.deletes.map(each => each.segment),
      ...this.inserts.map(each => each.segment),
      ...this.restyled.map(each => each.segment),
      ...this.endings.map(each => each.segment),
    ])
    /** @type {Map<string, ReturnType<typeof shifts>>} */
    const moved = new Map()
    for (const segment of segments) {
      const deletes = overlapsJoined(this.deletes.filter(each => each.segment === segment))
      const inserts = this.inserts.filter(each => each.segment === segment)
      moved.set(segment, shifts(inserts, deletes))
      /** @type {Array<{at: number, order: number, seq: number, request: object}>} */
      const edits = [
        ...deletes.map(each => ({
          at: each.start,
          order: 0,
          seq: 0,
          request: {
            deleteContentRange: {
              range: this.#range(segment, each.start, each.end),
            },
          },
        })),
        ...inserts.map(each => ({
          at: each.anchor,
          order: 1,
          seq: each.seq,
          request: {
            insertText: { text: each.text, location: this.#location(segment, each.anchor) },
          },
        })),
      ]
      // Last first; at one index, deletions first, then the insertion that
      // comes later in the document, so the earlier ends up before it.
      edits.sort((x, y) => y.at - x.at || x.order - y.order || y.seq - x.seq)
      requests.push(...edits.map(each => each.request))
    }

    for (const segment of segments) {
      const map = /** @type {ReturnType<typeof shifts>} */ (moved.get(segment))
      requests.push(...this.#restyle(segment, map), ...this.#styleInserted(segment, map))
      requests.push(...this.#styleParagraphs(segment, map))
    }
    return requests
  }

  /**
   * @param {string} segment
   * @param {number} start
   * @param {number} end
   */
  #range(segment, start, end) {
    return {
      startIndex: start,
      endIndex: end,
      ...(segment && { segmentId: segment }),
      ...(this.tabId && { tabId: this.tabId }),
    }
  }

  /**
   * @param {string} segment
   * @param {number} index
   */
  #location(segment, index) {
    return {
      index,
      ...(segment && { segmentId: segment }),
      ...(this.tabId && { tabId: this.tabId }),
    }
  }

  /**
   * The Doc's own words restyled, a request for each stretch.
   *
   * @param {string} segment
   * @param {ReturnType<typeof shifts>} map
   * @returns {object[]}
   */
  #restyle(segment, map) {
    const out = []
    const changes = this.restyled
      .filter(each => each.segment === segment)
      .sort((x, y) => x.index - y.index)
    for (let i = 0; i < changes.length; ) {
      let j = i + 1
      while (
        j < changes.length &&
        changes[j].index === changes[j - 1].index + 1 &&
        sameLook(changes[j].from, changes[i].from) &&
        sameLook(changes[j].to, changes[i].to)
      ) {
        j++
      }
      const { from, to } = changes[i]
      const start = map.kept(changes[i].index)
      out.push(this.#textStyle(segment, start, start + (j - i), to, fieldsChanged(from, to)))
      i = j
    }
    return out
  }

  /**
   * Inserted words styled as the document has them, from whatever Docs gave
   * them from the text before.
   *
   * @param {string} segment
   * @param {ReturnType<typeof shifts>} map
   * @returns {object[]}
   */
  #styleInserted(segment, map) {
    const out = []
    for (const insert of this.inserts.filter(each => each.segment === segment)) {
      const base = map.inserted(insert, 0)
      const { chars } = insert
      for (let i = 0; i < chars.length; ) {
        let j = i + 1
        while (
          j < chars.length &&
          chars[j].offset === chars[j - 1].offset + 1 &&
          sameLook(chars[j].b.look, chars[i].b.look)
        ) {
          j++
        }
        const look = /** @type {Look} */ (chars[i].b.look)
        const fields = ['bold', 'italic', 'strikethrough', 'link']
        if (look.code || insert.inherited?.code) fields.push('weightedFontFamily')
        const start = base + chars[i].offset
        out.push(this.#textStyle(segment, start, start + (j - i), look, fields))
        i = j
      }
    }
    return out
  }

  /**
   * @param {string} segment
   * @param {number} start
   * @param {number} end
   * @param {Look} look
   * @param {string[]} fields
   */
  #textStyle(segment, start, end, look, fields) {
    /** @type {TextStyle & {weightedFontFamily?: {fontFamily: string}}} */
    const textStyle = {}
    if (look.bold) textStyle.bold = true
    if (look.italic) textStyle.italic = true
    if (look.strike) textStyle.strikethrough = true
    if (look.link) textStyle.link = { url: look.link }
    if (look.code) textStyle.weightedFontFamily = { fontFamily: CODE_FONT }
    return {
      updateTextStyle: {
        range: this.#range(segment, start, end),
        textStyle,
        fields: fields.join(','),
      },
    }
  }

  /**
   * Each paragraph made, joined or changed, styled as the document has it:
   * its named style, a quote's indent, a list item's bullet.
   *
   * @param {string} segment
   * @param {ReturnType<typeof shifts>} map
   * @returns {object[]}
   */
  #styleParagraphs(segment, map) {
    const out = []
    /** @type {object[]} */
    const bullets = []
    for (const ending of this.endings.filter(each => each.segment === segment)) {
      const wanted = ending.b.kind
      if (wanted.kind === 'footnote' || wanted.kind === 'table') continue
      const { base, joined } = ending
      if (!joined && sameKind(wanted, base)) continue
      const index =
        'index' in ending.at
          ? map.kept(ending.at.index)
          : map.inserted(ending.at.insert, ending.at.offset)
      const range = this.#range(segment, index, index + 1)

      const named =
        wanted.kind === 'heading'
          ? base.kind === 'heading' && base.level === wanted.level
            ? ending.named
            : `HEADING_${wanted.level}`
          : 'NORMAL_TEXT'
      if (joined || named !== ending.named) {
        out.push({
          updateParagraphStyle: {
            range,
            paragraphStyle: { namedStyleType: named },
            fields: 'namedStyleType',
          },
        })
      }

      const quote = wanted.kind === 'quote'
      if (
        quote !== (base.kind === 'quote') ||
        (joined && (quote || ending.involved.some(each => each.kind === 'quote')))
      ) {
        out.push({
          updateParagraphStyle: {
            range,
            paragraphStyle: quote
              ? {
                  indentStart: QUOTE_INDENT,
                  indentFirstLine: QUOTE_INDENT,
                  indentEnd: QUOTE_INDENT,
                }
              : {},
            fields: 'indentStart,indentFirstLine,indentEnd',
          },
        })
      }

      const list = wanted.kind === 'list'
      if (joined) {
        // Joined list items of the kind wanted keep their bullet; anything
        // else is given the bullet wanted, or none.
        const kept = ending.involved.every(each => each.kind === 'list' && sameKind(each, wanted))
        const any = ending.involved.some(each => each.kind === 'list') || ending.bullet
        if (list && !kept) {
          if ((wanted.depth ?? 0) > 0) this.unsent.add('list')
          else {
            if (any) bullets.push({ deleteParagraphBullets: { range } })
            bullets.push({ createParagraphBullets: { range, bulletPreset: presetOf(wanted) } })
          }
        } else if (!list && any) {
          bullets.push({ deleteParagraphBullets: { range } })
        }
      } else if (list && base.kind === 'list') {
        this.unsent.add('list')
      } else if (list) {
        if ((wanted.depth ?? 0) > 0) this.unsent.add('list')
        else bullets.push({ createParagraphBullets: { range, bulletPreset: presetOf(wanted) } })
      } else if (base.kind === 'list' || ending.bullet) {
        bullets.push({ deleteParagraphBullets: { range } })
      }
    }
    return [...out, ...bullets]
  }
}

/**
 * The moves that make one run of units another, word by word: deletions
 * before insertions where they meet. The words are laid against each other
 * from the end first, which keeps a Doc's last newline where it can be, and
 * from the start where that makes the change smaller: in fewer pieces, and
 * joining fewer paragraphs. A paragraph deleted after one a page break parts
 * ends in a full stop like it; laid from the end, the first one's full stop
 * went with the break, and the two were joined.
 *
 * @param {Unit[]} from
 * @param {Unit[]} to
 * @returns {Move[]}
 */
function wordMoves(from, to) {
  const a = wordsOf(from)
  const b = wordsOf(to)
  /** @param {boolean} startFirst @returns {Move[]} */
  const laid = startFirst => {
    const diff = diffSequences(
      a.map(word => word.key),
      b.map(word => word.key),
      { maxEdits: MAX_EDITS, startFirst }
    ) ?? [
      ...a.map((_, i) => /** @type {const} */ ({ op: 'delete', a: i })),
      ...b.map((_, j) => /** @type {const} */ ({ op: 'insert', b: j })),
    ]
    /** @type {Move[]} */
    const words = []
    for (const step of diff) {
      if (step.op === 'equal') {
        a[step.a].units.forEach((unit, k) =>
          words.push({ op: 'equal', a: unit, b: b[step.b].units[k] })
        )
      } else if (step.op === 'delete') {
        for (const unit of a[step.a].units) words.push({ op: 'delete', a: unit })
      } else {
        for (const unit of b[step.b].units) words.push({ op: 'insert', b: unit })
      }
    }
    return deletionsFirst(words)
  }
  const fromEnd = laid(false)
  const fromStart = laid(true)
  return sizeOf(fromStart) < sizeOf(fromEnd) ? fromStart : fromEnd
}

/**
 * How big a change is: the pieces it is in, and the paragraphs of the Doc
 * it joins, each an end deleted from a paragraph not deleted whole.
 *
 * @param {Move[]} moves
 * @returns {number}
 */
function sizeOf(moves) {
  let pieces = 0
  /** @type {Map<DocParagraph, boolean>} Whether each paragraph goes whole. */
  const whole = new Map()
  moves.forEach((move, i) => {
    if (move.op !== 'equal' && move.op !== 'keep' && (i === 0 || moves[i - 1].op === 'equal')) {
      pieces++
    }
    if (move.op === 'insert' || !move.a.paragraph) return
    const paragraph = move.a.paragraph
    whole.set(paragraph, (whole.get(paragraph) ?? true) && move.op === 'delete')
  })
  let joins = 0
  for (const move of moves) {
    if (move.op === 'delete' && move.a.type === 'end' && move.a.paragraph) {
      if (!whole.get(move.a.paragraph)) joins++
    }
  }
  return pieces + joins
}

/** A character that is part of a word. */
const WORD = /[\p{L}\p{N}\p{M}_'’]/u

/**
 * Units as words, for the comparison: a run of letters and digits is one,
 * anything else one each. A word changed goes whole, as a writer would see
 * it, and as a collaborator's edit beside it merges best.
 *
 * @param {Unit[]} units
 * @returns {Array<{key: string, units: Unit[]}>}
 */
function wordsOf(units) {
  /** @type {Array<{key: string, units: Unit[]}>} */
  const out = []
  let inWord = false
  for (const unit of units) {
    const wordy = unit.type === 'char' && WORD.test(unit.char ?? '')
    const last = out.at(-1)
    if (wordy && inWord && last) {
      last.key += unit.key
      last.units.push(unit)
    } else {
      out.push({ key: unit.key, units: [unit] })
    }
    inWord = wordy
  }
  return out
}

/**
 * Deletions in order, those that overlap made one. Those that only meet stay
 * apart: an insertion may go in where they meet.
 *
 * @param {Array<{segment: string, start: number, end: number}>} deletes
 * @returns {Array<{segment: string, start: number, end: number}>}
 */
function overlapsJoined(deletes) {
  /** @type {Array<{segment: string, start: number, end: number}>} */
  const out = []
  for (const each of [...deletes].sort((x, y) => x.start - y.start)) {
    const last = out.at(-1)
    if (last && each.start < last.end) last.end = Math.max(last.end, each.end)
    else out.push({ ...each })
  }
  return out
}

/**
 * The bullets a new list item of a kind is given.
 *
 * @param {Kind} kind
 * @returns {string}
 */
const presetOf = kind => (kind.ordered ? PRESETS.ordered : PRESETS.bullet)

/**
 * Where the Doc's indices end up once the insertions and deletions are made.
 *
 * @param {Insert[]} inserts
 * @param {Array<{start: number, end: number}>} deletes
 */
function shifts(inserts, deletes) {
  const dels = [...deletes].sort((x, y) => x.start - y.start)
  /** Deleted before `index`. */
  const deletedBefore = (/** @type {number} */ index) => {
    let total = 0
    for (const each of dels) {
      if (each.start >= index) break
      total += Math.min(each.end, index) - each.start
    }
    return total
  }
  return {
    /** Where an index of the Doc that stays ends up: after all inserted at it. */
    kept: (/** @type {number} */ index) =>
      index +
      inserts.reduce((total, each) => total + (each.anchor <= index ? each.text.length : 0), 0) -
      deletedBefore(index),
    /** Where a character of an insertion ends up: after those before it. */
    inserted: (/** @type {Insert} */ insert, /** @type {number} */ offset) =>
      insert.anchor +
      inserts.reduce(
        (total, each) =>
          total +
          (each.anchor < insert.anchor || (each.anchor === insert.anchor && each.seq < insert.seq)
            ? each.text.length
            : 0),
        0
      ) -
      deletedBefore(insert.anchor) +
      offset,
  }
}

/**
 * The style fields that differ between two looks.
 *
 * @param {Look} from
 * @param {Look} to
 * @returns {string[]}
 */
function fieldsChanged(from, to) {
  const fields = []
  if (from.bold !== to.bold) fields.push('bold')
  if (from.italic !== to.italic) fields.push('italic')
  if (from.strike !== to.strike) fields.push('strikethrough')
  if (from.link !== to.link) fields.push('link')
  if (from.code !== to.code) fields.push('weightedFontFamily')
  return fields
}

/**
 * Where each table in a body starts.
 *
 * @param {StructuralElement[]} content
 * @returns {Set<number>}
 */
function tableStartsOf(content) {
  const out = new Set()
  for (const element of content) {
    if (element.table) out.add(element.startIndex ?? 0)
  }
  return out
}
