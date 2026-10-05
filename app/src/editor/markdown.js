/**
 * @module editor/markdown
 * @description Markdown as the document's file format: what the store holds,
 * what the model reads and writes, and what a file on disk will be.
 *
 * Built on `prosemirror-markdown`, the reference implementation, with the
 * parser and serializer configured against our schema rather than inherited.
 * The parser is markdown-it's `default` preset — CommonMark plus GFM
 * strikethrough — with raw HTML off, so a tag in a document is text, and with
 * tables and images off, since the schema has nowhere to put them and they
 * would otherwise throw; a table's pipes stay as the text they are.
 *
 * A lone newline is a hard break, in both directions. A writer who ended a line
 * meant it to end there, and CommonMark's soft wrap is not a reading anyone
 * here expects. The serializer writes a hard break as a bare newline; when
 * several run together, the ones after the first are written backslash-newline,
 * which markdown-it reads as a hard break wherever it stands, so a run of
 * breaks comes back as the same run rather than as a blank line that would
 * split the paragraph.
 *
 * Two properties are pinned by tests: `parse(serialize(doc))` is `doc` for
 * every node and mark, and `serialize(parse(md))` is a fixed point after one
 * pass, which is what matters once files are edited outside the app.
 */

import MarkdownIt from 'markdown-it'
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown'
import { schema } from './schema.js'

/** @typedef {import('prosemirror-model').Node} Node */

const tokenizer = new MarkdownIt('default', { html: false }).disable(['table', 'image'])

// The reference token map is written for the same node names; it only lacks
// strikethrough, and reads a soft break as a space.
const { image: _image, ...tokens } = defaultMarkdownParser.tokens
const parser = new MarkdownParser(schema, tokenizer, {
  ...tokens,
  softbreak: { node: 'hard_break' },
  s: { mark: 'strikethrough' },
})

const { image: _imageNode, ...nodes } = defaultMarkdownSerializer.nodes

const serializer = new MarkdownSerializer(
  {
    ...nodes,

    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ')
    },

    text(state, node, parent, index) {
      // The reference escapes block syntax only at the start of a block. Our
      // hard break starts a line too, and `# ` or `- ` there would open a
      // heading or a list on the way back in.
      const afterBreak = index > 0 && parent.child(index - 1).type.name === 'hard_break'
      // Whether the link mark opened as `<url>`, which is not escaped. The
      // reference keeps this on the state without declaring it.
      const inAutolink = /** @type {{inAutolink?: boolean}} */ (/** @type {unknown} */ (state))
        .inAutolink
      if (afterBreak && !inAutolink) state.text(state.esc(node.text || '', true), false)
      else nodes.text(state, node, parent, index)
    },

    hard_break(state, node, parent, index) {
      // Trailing breaks have no form and are dropped, as the reference does.
      let followed = false
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          followed = true
          break
        }
      }
      if (!followed) return
      const inRun = index > 0 && parent.child(index - 1).type === node.type
      state.write(inRun ? '\\\n' : '\n')
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strikethrough: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  }
)

/**
 * Read markdown into a document. Never throws on content: what the schema
 * cannot hold is read as the text it was written as.
 *
 * @param {string|null|undefined} markdown
 * @returns {Node} A document in the editor's schema
 */
export function parseMarkdown(markdown) {
  return parser.parse(markdown || '')
}

/**
 * Write a document as markdown.
 *
 * @param {Node} doc
 * @returns {string}
 */
export function serializeMarkdown(doc) {
  // Tight: items on consecutive lines. The editor has no loose list to keep.
  return serializer.serialize(doc, { tightLists: true })
}

/**
 * Markdown in the file format's own form: what the editor would serialize
 * from it. The same words, with the serializer's choices of bullet, escape,
 * and line ending, so that text written from outside and text the editor
 * wrote never differ in surface form — a recorded edit still matches after
 * the document has been opened, and a document opened and closed untouched
 * is byte-identical.
 *
 * @param {string|null|undefined} markdown
 * @returns {string}
 */
export function settleMarkdown(markdown) {
  return serializeMarkdown(parseMarkdown(markdown))
}

/**
 * Markdown after markdown: a blank line between, so the new text starts a
 * block of its own rather than running on from the last one.
 *
 * @param {string|null|undefined} content
 * @param {string} text
 * @returns {string}
 */
export function appendBlocks(content, text) {
  const before = (content || '').replace(/\s+$/, '')
  const after = text.replace(/^\n+/, '')
  return before ? `${before}\n\n${after}` : after
}
