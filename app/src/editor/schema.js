/**
 * @module editor/schema
 * @description The document schema: exactly the nodes and marks that have a
 * markdown form, and nothing else.
 *
 * The markdown serializer is the file format, so the schema decides what a
 * document can hold. A node without a markdown representation would round-trip
 * to nothing, silently — underline is the concrete example — which is why the
 * set is declared here, one spec at a time, and pinned by a test rather than
 * inherited from whatever a starter kit ships with this year.
 *
 * The specs are `prosemirror-schema-basic`'s and `prosemirror-schema-list`'s,
 * plus strikethrough, a code block that keeps its language, and GFM's table. Their `parseDOM` rules are what the v13 migration read the
 * old HTML through, so `<b>`, `<i>`, and `<s>` are covered as well as the tags
 * the editor writes.
 *
 * A table is what GFM can write: a grid of one-line cells, the first row its
 * header, each column aligned or not. So a cell holds text and nothing else —
 * no break, which would end the row — and the header is the first row because
 * it is first: there is one kind of cell, and no way to put a header row
 * anywhere markdown could not. The cells carry `colspan` and `rowspan` only
 * because `prosemirror-tables` reads them; nothing sets them, and they are
 * always 1.
 *
 * A picture is markdown's image, inline, since markdown has no picture as a
 * block. Its `src` is a path: to one of the document's own pictures, to a file
 * document, or an address on the web, which is never fetched (see
 * `editor/pictures.js`). Pasted HTML keeps an `img` whose source is one of
 * those, or the picture itself (`data:image/…`), which the paste makes one
 * of the document's own; one held by the page it came from (`blob:`) or on
 * the disk it came from (`file:`) is no picture to keep.
 */

import { DOMParser, Schema } from 'prosemirror-model'
import { nodes as basic, marks as basicMarks } from 'prosemirror-schema-basic'
import { bulletList, orderedList, listItem } from 'prosemirror-schema-list'

/**
 * A code block's language, from the info string kept on `data-params` or the
 * `language-*` class the previous editor wrote.
 *
 * @param {HTMLElement} dom
 * @returns {string}
 */
function languageOf(dom) {
  const cls = dom.querySelector('code')?.className.match(/language-(\S+)/)
  return cls ? cls[1] : dom.getAttribute('data-params') || ''
}

/** @type {import('prosemirror-model').NodeSpec} */
const code_block = {
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  attrs: { params: { default: '' } },
  parseDOM: [
    {
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs: dom => ({ params: languageOf(/** @type {HTMLElement} */ (dom)) }),
    },
  ],
  toDOM(node) {
    return ['pre', node.attrs.params ? { 'data-params': node.attrs.params } : {}, ['code', 0]]
  },
}

/** The sources a pasted picture keeps: a path, an address on the web, or the picture. */
const KEPT_SOURCE = /^(?![a-z][a-z0-9+.-]*:)|^https?:|^data:image\//i

/** @type {import('prosemirror-model').NodeSpec} */
const image = {
  ...basic.image,
  parseDOM: [
    {
      tag: 'img[src]',
      getAttrs: dom => {
        const src = /** @type {HTMLElement} */ (dom).getAttribute('src') || ''
        if (!KEPT_SOURCE.test(src.trim())) return false
        return {
          src,
          title: /** @type {HTMLElement} */ (dom).getAttribute('title'),
          alt: /** @type {HTMLElement} */ (dom).getAttribute('alt'),
        }
      },
    },
  ],
}

/** @type {import('prosemirror-model').MarkSpec} */
const strikethrough = {
  parseDOM: [
    { tag: 's' },
    { tag: 'del' },
    { tag: 'strike' },
    {
      style: 'text-decoration',
      // null is a match with no attributes; false is no match.
      getAttrs: value => /line-through/.test(String(value)) && null,
    },
  ],
  toDOM() {
    return ['s', 0]
  },
}

/** What a column can be aligned to. */
const ALIGNMENTS = ['left', 'center', 'right']

/**
 * A pasted cell's alignment, from its style or the attribute older pages use.
 *
 * @param {HTMLElement} dom
 * @returns {string|null}
 */
function alignmentOf(dom) {
  const align = dom.style.textAlign || dom.getAttribute('align') || ''
  return ALIGNMENTS.includes(align) ? align : null
}

/**
 * @param {HTMLElement} dom
 * @returns {{align: string|null}}
 */
const cellAttrs = dom => ({ align: alignmentOf(dom) })

/** Where one block, or one line, of a pasted cell ends. */
const BREAKS = 'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr, br'

/**
 * A pasted cell's text, with its marks, as the one line a cell holds. A cell
 * from a page can hold blocks — Google Docs puts a paragraph in every one —
 * and read as they are, the blocks would close the cell, and the table, to
 * find somewhere to go. Read inside a cell, there is nowhere else for their
 * words to go, and a space after each keeps two blocks' words apart.
 *
 * @param {Node} dom
 * @param {Schema} schema
 * @returns {import('prosemirror-model').Fragment}
 */
function cellContent(dom, schema) {
  const copy = /** @type {HTMLElement} */ (dom.cloneNode(true))
  copy.querySelectorAll(BREAKS).forEach(block => block.after(' '))
  return DOMParser.fromSchema(schema).parse(copy, { topNode: schema.nodes.table_cell.create() })
    .content
}

/** @type {import('prosemirror-model').NodeSpec} */
const table = {
  content: 'table_row+',
  group: 'block',
  tableRole: 'table',
  isolating: true,
  parseDOM: [{ tag: 'table' }],
  toDOM() {
    // In a box of its own, which scrolls sideways when the table is wider
    // than the page, as the page itself does not.
    return ['div', { class: 'table-scroll' }, ['table', ['tbody', 0]]]
  },
}

/** @type {import('prosemirror-model').NodeSpec} */
const table_row = {
  content: 'table_cell+',
  tableRole: 'row',
  parseDOM: [{ tag: 'tr' }],
  toDOM() {
    return ['tr', 0]
  },
}

/** @type {import('prosemirror-model').NodeSpec} */
const table_cell = {
  content: 'text*',
  attrs: {
    align: { default: null },
    colspan: { default: 1 },
    rowspan: { default: 1 },
  },
  tableRole: 'cell',
  isolating: true,
  parseDOM: [
    { tag: 'td', getAttrs: cellAttrs, getContent: cellContent },
    { tag: 'th', getAttrs: cellAttrs, getContent: cellContent },
  ],
  toDOM(node) {
    return ['td', node.attrs.align ? { style: `text-align: ${node.attrs.align}` } : {}, 0]
  },
}

/**
 * A comment's place: its id, carried on the passage it is about so that it
 * follows the text through every edit. What was said is the comment's
 * thread, on the document's row. Not inclusive, so typing at the edge of a
 * commented passage is outside it. It excludes nothing, itself included, so
 * comments with other ids can be on the same text: overlapping comments are
 * several marks. The markdown form is in `comments.js`.
 *
 * @type {import('prosemirror-model').MarkSpec}
 */
const comment = {
  attrs: { id: {} },
  inclusive: false,
  excludes: '',
  parseDOM: [
    {
      tag: 'mark[data-comment-id]',
      getAttrs: dom => ({ id: /** @type {HTMLElement} */ (dom).getAttribute('data-comment-id') }),
    },
  ],
  toDOM(mark) {
    return ['mark', { class: 'comment', 'data-comment-id': mark.attrs.id }, 0]
  },
}

/**
 * A suggested change's two halves: what it would put in, and what it would
 * take out, each carrying the suggestion's id. Until the writer accepts or
 * rejects it, the text holds both. On words, or on a whole block that has
 * none to carry it: a code block, a rule, a table, an empty block. Neither is
 * inclusive, so typing at the edge of one is outside it, and each excludes
 * the other and itself: a word is in one suggestion, one way. The markdown
 * form is in `suggestions.js`.
 *
 * @param {'ins'|'del'} tag
 * @returns {import('prosemirror-model').MarkSpec}
 */
const suggested = tag => {
  /** @param {HTMLElement} dom */
  const getAttrs = dom => ({ id: dom.getAttribute('data-suggestion-id') })
  return {
    attrs: { id: {} },
    inclusive: false,
    excludes: 'insertion deletion',
    parseDOM: [
      { tag: `${tag}[data-suggestion-id]`, getAttrs },
      { tag: `div[data-suggestion-id][data-suggestion=${tag}]`, getAttrs },
    ],
    toDOM(mark, inline) {
      const attrs = { class: 'suggestion', 'data-suggestion-id': mark.attrs.id }
      return inline ? [tag, attrs, 0] : ['div', { ...attrs, 'data-suggestion': tag }, 0]
    },
  }
}

/** The marks a block can carry: a suggestion's, put in or taken out whole. */
const BLOCK_MARKS = 'insertion deletion'

/**
 * Every node the schema has. The serializer has an entry for each of these
 * and the parser produces nothing else.
 *
 * @type {readonly string[]}
 */
export const NODE_NAMES = Object.freeze([
  'doc',
  'paragraph',
  'text',
  'heading',
  'blockquote',
  'bullet_list',
  'ordered_list',
  'list_item',
  'code_block',
  'horizontal_rule',
  'hard_break',
  'image',
  'table',
  'table_row',
  'table_cell',
])

/**
 * Every mark the schema has.
 *
 * @type {readonly string[]}
 */
export const MARK_NAMES = Object.freeze([
  'comment',
  'insertion',
  'deletion',
  'link',
  'em',
  'strong',
  'code',
  'strikethrough',
])

/**
 * The schema itself. One instance for the editor, the migration, and the
 * tests, so a node from any of them is a node in all of them.
 *
 * @type {Schema}
 */
export const schema = new Schema({
  nodes: {
    // Those that hold blocks, but for a list's items and a table's rows,
    // which markdown has nowhere to mark whole.
    doc: { ...basic.doc, marks: BLOCK_MARKS },
    paragraph: basic.paragraph,
    text: basic.text,
    heading: basic.heading,
    blockquote: { ...basic.blockquote, marks: BLOCK_MARKS },
    bullet_list: { ...bulletList, content: 'list_item+', group: 'block' },
    ordered_list: { ...orderedList, content: 'list_item+', group: 'block' },
    list_item: { ...listItem, content: 'paragraph block*', marks: BLOCK_MARKS },
    code_block,
    horizontal_rule: basic.horizontal_rule,
    hard_break: basic.hard_break,
    image,
    table,
    table_row,
    table_cell,
  },
  marks: {
    // First, so it ranks outermost: a comment wraps whatever else is marked
    // in the passage, and serializes around it rather than inside it.
    comment,
    // Next, for the same reason: a suggestion's words keep their own marks
    // inside it.
    insertion: suggested('ins'),
    deletion: suggested('del'),
    link: basicMarks.link,
    em: basicMarks.em,
    strong: basicMarks.strong,
    code: basicMarks.code,
    strikethrough,
  },
})
