/**
 * @module editor/size
 * @description How long a document the editor lays out.
 *
 * The editor puts the whole of a document in the page, and every key typed in
 * it costs in proportion to how much is there: its paragraphs, list items and
 * table cells, not its characters. A novel kept in one document is a few
 * thousand paragraphs and types as fast as a page. A long reference with its
 * tables runs to tens of thousands, and the keys lag behind the writer. A
 * document past the limit comes in from outside as plain text, which is shown
 * a screen at a time whatever its length, and can be laid out from its menu.
 */

/** How many nodes a document can have and still come in laid out. */
export const LAYOUT_LIMIT = 15000

/**
 * Whether a document is short enough for the editor to lay out.
 *
 * @param {import('prosemirror-model').Node} doc
 * @returns {boolean}
 */
export function laysOut(doc) {
  let nodes = 0
  doc.descendants(node => {
    if (!node.isText) nodes++
  })
  return nodes <= LAYOUT_LIMIT
}
