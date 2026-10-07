/**
 * @module editor/tables
 * @description Tables in the editor: making one by typing its header row,
 * moving through it from the keyboard, and the row and column commands its
 * menu offers.
 *
 * A table is made the way the rest of the document is, by typing its
 * markdown: `| Name | Age |` and Enter becomes a table with that header and an
 * empty row under it. Inside one, Tab and Shift-Tab go from cell to cell, and
 * Tab from the last cell adds a row. Enter goes down a row, adding one at the
 * bottom; on an empty last row it ends the table there, as Enter on an empty
 * list item ends the list. Shift-Enter and Mod-Enter leave the table for a
 * paragraph after it, as they leave a code block. Backspace on the whole
 * table empties its cells, and on an empty one deletes it. Rows, columns, and
 * the table itself are added and taken away from a menu, with
 * `prosemirror-tables`' own commands, and a column is aligned with
 * `alignColumn`.
 *
 * The rest is `prosemirror-tables` too: selecting cells, pasting cells, and
 * keeping every row as wide as the others. Anything else pasted into a cell
 * is made to fit its one line (`cellPaste`).
 */

import { Plugin, Selection, TextSelection } from 'prosemirror-state'
import { Slice } from 'prosemirror-model'
import {
  CellSelection,
  TableMap,
  addRow,
  findTable,
  goToNextCell,
  isInTable,
  selectedRect,
} from 'prosemirror-tables'
import { schema } from './schema.js'

/**
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('prosemirror-state').Transaction} Transaction
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('prosemirror-model').Fragment} Fragment
 */

const { paragraph, table, table_row, table_cell } = schema.nodes

/**
 * Put the caret at the end of the cell that starts at `pos`.
 *
 * @param {Transaction} tr
 * @param {number} pos - Directly before the cell
 * @returns {Transaction}
 */
function intoCell(tr, pos) {
  const cell = tr.doc.nodeAt(pos)
  return tr.setSelection(TextSelection.create(tr.doc, pos + 1 + cell.content.size))
}

/**
 * A new paragraph after a table, with the caret in it.
 *
 * @param {Transaction} tr
 * @param {number} after - Directly after the table
 * @returns {Transaction}
 */
function paragraphAfter(tr, after) {
  tr.insert(after, paragraph.create())
  return tr.setSelection(TextSelection.create(tr.doc, after + 1))
}

/**
 * The cells a typed header row names: what lies between its pipes, trimmed,
 * with its marks. Null when the line is not a row — not all text, or not
 * opened and closed with a pipe.
 *
 * @param {Node} line - A paragraph
 * @returns {Fragment[]|null}
 */
export function cellsOfRow(line) {
  if (!line.content.content.every(child => child.isText)) return null
  const text = line.textContent
  if (!/^\s*\|.*\|\s*$/.test(text)) return null

  const pipes = []
  for (let i = 0; i < text.length; i++) if (text[i] === '|') pipes.push(i)
  if (pipes.length < 2) return null

  const cells = []
  for (let i = 1; i < pipes.length; i++) {
    const from = pipes[i - 1] + 1
    const to = pipes[i]
    const raw = text.slice(from, to)
    const lead = raw.length - raw.trimStart().length
    const trail = raw.length - raw.trimEnd().length
    cells.push(
      lead + trail >= raw.length
        ? line.content.cut(0, 0)
        : line.content.cut(from + lead, to - trail)
    )
  }
  return cells
}

/**
 * Enter at the end of a typed header row, `| Name | Age |`: the row becomes a
 * table, with an empty row under it and the caret there.
 *
 * @type {Command}
 */
export const tableFromRow = (state, dispatch) => {
  const { $from, empty } = state.selection
  const line = $from.parent
  if (!empty || line.type !== paragraph || $from.parentOffset !== line.content.size) return false
  const cells = cellsOfRow(line)
  if (!cells) return false

  const header = table_row.create(
    null,
    cells.map(content => table_cell.create(null, content))
  )
  const body = table_row.create(
    null,
    cells.map(() => table_cell.create())
  )
  const grid = table.create(null, [header, body])
  const index = $from.index(-1)
  if (!$from.node(-1).canReplaceWith(index, index + 1, table)) return false

  if (dispatch) {
    const before = $from.before()
    const tr = state.tr.replaceWith(before, $from.after(), grid)
    // Into the table, past the header row, into the body row's first cell.
    dispatch(intoCell(tr, before + 1 + header.nodeSize + 1).scrollIntoView())
  }
  return true
}

/**
 * Enter in a table: down a row, keeping the column, with a row added at the
 * bottom. An empty last row, below the header, ends the table: it goes, and
 * the caret goes to a paragraph after.
 *
 * @type {Command}
 */
export const nextRow = (state, dispatch) => {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  const { map, table: grid, tableStart } = rect

  if (dispatch) {
    const tr = state.tr
    const last = grid.child(map.height - 1)
    if (rect.bottom < map.height) {
      intoCell(tr, tableStart + map.map[rect.bottom * map.width + rect.left])
    } else if (map.height > 1 && rect.top === map.height - 1 && last.textContent === '') {
      const end = tableStart + grid.content.size
      tr.delete(end - last.nodeSize, end)
      paragraphAfter(tr, tableStart - 1 + grid.nodeSize - last.nodeSize)
    } else {
      addRow(tr, rect, map.height)
      const grown = TableMap.get(tr.doc.nodeAt(tableStart - 1))
      intoCell(tr, tableStart + grown.map[(grown.height - 1) * grown.width + rect.left])
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

/**
 * Leave the table for a new paragraph after it.
 *
 * @type {Command}
 */
export const exitTable = (state, dispatch) => {
  const found = isInTable(state) && findTable(state.selection.$head)
  if (!found) return false
  if (dispatch) dispatch(paragraphAfter(state.tr, found.pos + found.node.nodeSize).scrollIntoView())
  return true
}

/**
 * Backspace or Delete on a whole table whose cells are empty: the table goes,
 * and the caret goes to the start of what followed it, or the end of what came
 * before. A table that was all its parent held leaves an empty paragraph,
 * since the parent has to hold something. With words still in the cells,
 * `prosemirror-tables` empties them first, so a table goes in two presses, or
 * three from the start of the paragraph after it, where the first selects it.
 *
 * @type {Command}
 */
export const deleteEmptyTable = (state, dispatch) => {
  const { selection } = state
  if (!(selection instanceof CellSelection)) return false
  if (!selection.isRowSelection() || !selection.isColSelection()) return false
  const $cell = selection.$anchorCell
  const grid = $cell.node(-1)
  if (grid.textContent !== '') return false

  if (dispatch) {
    const from = $cell.before(-1)
    const to = from + grid.nodeSize
    const tr =
      $cell.node(-2).childCount > 1
        ? state.tr.delete(from, to)
        : state.tr.replaceWith(from, to, paragraph.create())
    dispatch(tr.setSelection(Selection.near(tr.doc.resolve(from), 1)).scrollIntoView())
  }
  return true
}

/**
 * Tab in a table: the next cell, or a new row from the last.
 *
 * @type {Command}
 */
export const nextCell = (state, dispatch) => {
  if (!isInTable(state)) return false
  if (goToNextCell(1)(state, dispatch)) return true
  if (dispatch) {
    const rect = selectedRect(state)
    const tr = addRow(state.tr, rect, rect.map.height)
    const grown = TableMap.get(tr.doc.nodeAt(rect.tableStart - 1))
    dispatch(
      intoCell(tr, rect.tableStart + grown.map[(grown.height - 1) * grown.width]).scrollIntoView()
    )
  }
  return true
}

/**
 * Shift-Tab in a table: the cell before, and nowhere from the first, so that
 * the key does not take the caret out of the editor.
 *
 * @type {Command}
 */
export const previousCell = (state, dispatch) => {
  if (!isInTable(state)) return false
  goToNextCell(-1)(state, dispatch)
  return true
}

/**
 * Align the columns the selection is in, or take their alignment away.
 *
 * @param {'left'|'center'|'right'|null} align
 * @returns {Command}
 */
export function alignColumn(align) {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    if (dispatch) {
      const { map, table: grid, tableStart, left, right } = selectedRect(state)
      const tr = state.tr
      for (let row = 0; row < map.height; row++) {
        for (let col = left; col < right; col++) {
          const pos = map.map[row * map.width + col]
          tr.setNodeMarkup(tableStart + pos, null, { ...grid.nodeAt(pos).attrs, align })
        }
      }
      dispatch(tr)
    }
    return true
  }
}

/**
 * The column alignment the selection is in, as the first row has it.
 *
 * @param {import('prosemirror-state').EditorState} state
 * @returns {string|null}
 */
export function alignmentAt(state) {
  if (!isInTable(state)) return null
  const { map, table: grid, left } = selectedRect(state)
  return grid.nodeAt(map.map[left]).attrs.align
}

/**
 * What a paste puts in a cell: its inline content, when it is one line of
 * text, marks and all; otherwise null, and its words go in instead.
 *
 * @param {Slice} slice
 * @returns {Slice|null}
 */
function lineOf(slice) {
  let { content } = slice
  while (content.childCount === 1 && !content.firstChild.isInline)
    content = content.firstChild.content
  let text = true
  content.forEach(child => {
    text = text && child.isText
  })
  return text ? new Slice(content, 0, 0) : null
}

/**
 * Pasting into a cell. Cells copied from a table are `prosemirror-tables`'s,
 * pasted over the cells from this one on. Anything else goes into the one
 * line this cell has: a line of text as it is, and more than that as its
 * words, a space where each line or block ended. Left to the usual paste,
 * each line would be made a cell of its own, since a cell is the only
 * textblock a row can hold, and laid over the cells beside this one.
 *
 * Ahead of `tableEditing`, which would paste those cells.
 *
 * @returns {Plugin}
 */
export function cellPaste() {
  return new Plugin({
    props: {
      handlePaste(view, event, slice) {
        const { state } = view
        const { selection } = state
        if (!(selection instanceof TextSelection) || selection.$from.parent.type !== table_cell) {
          return false
        }
        if (/<t[dh][\s>]/i.test(event.clipboardData?.getData('text/html') || '')) return false

        const line = lineOf(slice)
        // A code block's lines are in its text.
        const words = () =>
          slice.content.textBetween(0, slice.content.size, ' ', ' ').replace(/\n/g, ' ')
        const tr = line ? state.tr.replaceSelection(line) : state.tr.insertText(words())
        view.dispatch(tr.scrollIntoView())
        return true
      },
    },
  })
}
