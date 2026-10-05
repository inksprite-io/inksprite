/**
 * @module stores/migrations/markdown
 * @description Turn every text document's HTML into markdown.
 *
 * Documents held the HTML the Tiptap editor produced. Version 13 makes them
 * markdown: the format the model reads and writes, the format the editor now
 * serializes to, and the format a file on disk will be.
 *
 * The HTML is read through the editor's own schema and written out by the
 * editor's own serializer, not through a generic converter. What survives is,
 * by construction, exactly what the editor could show — a `<u>` it never had a
 * node for is text here as it was there.
 *
 * This is the first transform that needs a DOM. The page has one at upgrade
 * time and happy-dom has one in tests; `utils/backup.js` accepts the cost.
 *
 * Not idempotent by content: a markdown string run through the HTML parser is
 * a paragraph of escaped text, and there is no reliable way to look at a
 * string and know which it is. The version gate is what runs this once, on
 * the database and on a backup alike, the same as every migration before it.
 *
 * Frozen at what version 13 meant, like the transforms before it — with the
 * one honest exception that the schema and serializer are the editor's live
 * ones, because "what the editor can represent" is the whole definition.
 */

import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model'
import { schema } from '../../editor/schema.js'
import { serializeMarkdown } from '../../editor/markdown.js'

/** @typedef {import('../../types/models.js').Document} Document */

/**
 * The markdown a piece of editor HTML held.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  const dom = new window.DOMParser().parseFromString(html, 'text/html')
  return serializeMarkdown(ProseMirrorDOMParser.fromSchema(schema).parse(dom.body))
}

/**
 * Convert each text document with content. Folders keep their empty content
 * and are not returned; neither is a text document with nothing in it, which
 * reads the same either way.
 *
 * @param {Document[]} documents
 * @returns {{documents: Document[], converted: number}} Only the documents that changed
 */
export function documentsToMarkdown(documents) {
  /** @type {Document[]} */
  const out = []
  for (const document of documents || []) {
    if (document?.type !== 'text' || !document.content) continue
    out.push({ ...document, content: htmlToMarkdown(document.content) })
  }
  return { documents: out, converted: out.length }
}
