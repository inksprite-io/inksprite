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
 * minus the image, plus strikethrough and a code block that keeps its
 * language. Their `parseDOM` rules are what the v13 migration read the old
 * HTML through, so `<b>`, `<i>`, and `<s>` are covered as well as the tags the
 * editor writes.
 */

import { Schema } from 'prosemirror-model'
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
])

/**
 * Every mark the schema has.
 *
 * @type {readonly string[]}
 */
export const MARK_NAMES = Object.freeze(['link', 'em', 'strong', 'code', 'strikethrough'])

/**
 * The schema itself. One instance for the editor, the migration, and the
 * tests, so a node from any of them is a node in all of them.
 *
 * @type {Schema}
 */
export const schema = new Schema({
  nodes: {
    doc: basic.doc,
    paragraph: basic.paragraph,
    text: basic.text,
    heading: basic.heading,
    blockquote: basic.blockquote,
    bullet_list: { ...bulletList, content: 'list_item+', group: 'block' },
    ordered_list: { ...orderedList, content: 'list_item+', group: 'block' },
    list_item: { ...listItem, content: 'paragraph block*' },
    code_block,
    horizontal_rule: basic.horizontal_rule,
    hard_break: basic.hard_break,
  },
  marks: {
    link: basicMarks.link,
    em: basicMarks.em,
    strong: basicMarks.strong,
    code: basicMarks.code,
    strikethrough,
  },
})
