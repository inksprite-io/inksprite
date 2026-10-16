/**
 * @module editor/clipboard
 * @description The clipboard as the editor's menu reaches it, beside the keys:
 * the selection as markdown, markdown pasted as what it stands for, and the
 * clipboard read for a Paste chosen from the menu.
 *
 * Cut, Copy and the keys' Paste are the editor's own: the view writes and
 * reads the clipboard in its copy and paste events, with the document's
 * formatting as HTML. A paste chosen from a menu has no paste event, so the
 * clipboard is read instead, which a browser may ask the writer to allow.
 */

import { Slice } from 'prosemirror-model'
import { parseMarkdown, serializeMarkdown } from './markdown.js'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Command} Command
 */

/**
 * The selection as markdown, as Copy as Markdown puts it on the clipboard.
 * What markdown can't hold alone, such as a few cells of a table, is its text.
 *
 * @param {EditorState} state
 * @returns {string}
 */
export function selectionMarkdown(state) {
  const { from, to } = state.selection
  const doc = state.schema.topNodeType.createAndFill(null, state.selection.content().content)
  return doc ? serializeMarkdown(doc).trim() : state.doc.textBetween(from, to, '\n\n')
}

/**
 * Markdown as a slice to paste. Its first and last blocks are open, so one
 * paragraph of it joins the line it lands in, as pasted text would.
 *
 * @param {string} markdown
 * @returns {Slice}
 */
export const markdownSlice = markdown => Slice.maxOpen(parseMarkdown(markdown).content)

/**
 * Put markdown in place of the selection, as what it stands for.
 *
 * @param {string} markdown
 * @returns {Command}
 */
export const pasteMarkdown = markdown => (state, dispatch) => {
  if (!markdown.trim()) return false
  if (dispatch) dispatch(state.tr.replaceSelection(markdownSlice(markdown)).scrollIntoView())
  return true
}

/**
 * What the clipboard holds: its HTML, if any, and its text.
 *
 * @typedef {Object} ClipboardContents
 * @property {string} html
 * @property {string} text
 */

/**
 * Read the clipboard, HTML and text. Chrome cleans HTML read this way unless
 * asked not to, which would take the marks the editor reads its own copies
 * by; a browser that doesn't know the option ignores it.
 *
 * @param {{ read: (options?: { unsanitized?: string[] }) => Promise<ClipboardItem[]> }} [clipboard]
 * @returns {Promise<ClipboardContents>}
 */
export async function readClipboard(clipboard = navigator.clipboard) {
  const items = await clipboard.read({ unsanitized: ['text/html'] })
  /** @param {string} type */
  const read = async type => {
    const item = items.find(one => one.types.includes(type))
    return item ? (await item.getType(type)).text() : ''
  }
  return { html: await read('text/html'), text: await read('text/plain') }
}
