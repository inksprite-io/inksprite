/**
 * @module editor/insert
 * @description Blocks put in from the editor's menu, for what is otherwise only
 * typed: a table (`| a | b |` and Enter), a horizontal rule (`---`) and a code
 * block (three backticks).
 *
 * A block takes the place of an empty paragraph the caret is in. Otherwise it
 * goes after the block the caret is in, or as far out as it can go from
 * there: after a table, not in its cell. The caret goes where the writing
 * goes on: a table's first cell, a code block, or a paragraph after a rule.
 */

import { Fragment } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { schema } from './schema.js'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Command} Command
 */

const { paragraph, table, table_row, table_cell, horizontal_rule, code_block } = schema.nodes

/**
 * Where blocks go for the selection: over an empty paragraph the caret is in,
 * or after the innermost block the caret is in that they may follow.
 *
 * @param {EditorState} state
 * @param {Fragment} blocks
 * @returns {{ from: number, to: number }|null}
 */
export function placeFor(state, blocks) {
  const { $from } = state.selection
  const line = $from.parent
  if (line.type === paragraph && line.content.size === 0 && $from.depth > 0) {
    const index = $from.index($from.depth - 1)
    if ($from.node($from.depth - 1).canReplace(index, index + 1, blocks)) {
      return { from: $from.before(), to: $from.after() }
    }
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    const index = $from.index(depth - 1) + 1
    if ($from.node(depth - 1).canReplace(index, index, blocks)) {
      const after = $from.after(depth)
      return { from: after, to: after }
    }
  }
  return null
}

/**
 * Put blocks in, and the caret at a position counted from where they start.
 *
 * @param {Fragment} blocks
 * @param {number} caret - From the start of the first block
 * @returns {Command}
 */
const insertBlocks = (blocks, caret) => (state, dispatch) => {
  const place = placeFor(state, blocks)
  if (!place) return false
  if (dispatch) {
    const tr = state.tr.replaceWith(place.from, place.to, blocks)
    tr.setSelection(TextSelection.create(tr.doc, place.from + caret))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** A row of empty cells. */
const emptyRow = (/** @type {number} */ columns) =>
  table_row.create(
    null,
    Array.from({ length: columns }, () => table_cell.create())
  )

/**
 * A table of two columns, a header row and one empty row under it, with the
 * caret in its first cell.
 *
 * @type {Command}
 */
export const insertTable = (state, dispatch) =>
  // Into the table, its first row, its first cell.
  insertBlocks(Fragment.from(table.create(null, [emptyRow(2), emptyRow(2)])), 3)(state, dispatch)

/**
 * A horizontal rule, and a paragraph after it to go on writing in.
 *
 * @type {Command}
 */
export const insertRule = (state, dispatch) => {
  const rule = horizontal_rule.create()
  return insertBlocks(Fragment.from([rule, paragraph.create()]), rule.nodeSize + 1)(state, dispatch)
}

/**
 * An empty code block, with the caret in it.
 *
 * @type {Command}
 */
export const insertCodeBlock = (state, dispatch) =>
  insertBlocks(Fragment.from(code_block.create()), 1)(state, dispatch)
