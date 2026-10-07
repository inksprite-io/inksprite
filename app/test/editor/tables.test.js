import { describe, it, expect, afterEach } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import { createEditorState, keys } from '../../src/editor/state.js'
import { CellSelection } from 'prosemirror-tables'
import {
  alignColumn,
  alignmentAt,
  cellsOfRow,
  deleteEmptyTable,
  exitTable,
  nextCell,
  nextRow,
  previousCell,
  tableFromRow,
} from '../../src/editor/tables.js'

/** A document the writer has typed `text` into, so it is text and not markdown. */
const typed = text => {
  const state = createEditorState('')
  return state.apply(state.tr.insertText(text))
}

/** The state with the caret at the end of the first textblock reading `text`. */
const at = (state, text) => {
  let pos = null
  state.doc.descendants((node, offset) => {
    if (pos !== null) return false
    if (node.isTextblock && node.textContent === text) pos = offset + 1 + node.content.size
    return pos === null
  })
  if (pos === null) throw new Error(`no block reads ${JSON.stringify(text)}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** Run a command, and hand back the state after it, or null if it declined. */
const run = (state, command) => {
  let next = null
  const done = command(state, tr => {
    next = state.apply(tr)
  })
  return done ? next : null
}

/** The text of the textblock the caret is in. */
const caretIn = state => state.selection.$head.parent.textContent

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |'

describe('a typed header row', () => {
  it('is cut into its cells at the pipes, trimmed', () => {
    const line = typed('| Name |  Age | |').doc.firstChild
    expect(cellsOfRow(line).map(cell => cell.textBetween(0, cell.size))).toEqual([
      'Name',
      'Age',
      '',
    ])
  })

  it('is not a row without a pipe at each end', () => {
    expect(cellsOfRow(typed('| a | b').doc.firstChild)).toBeNull()
    expect(cellsOfRow(typed('a | b |').doc.firstChild)).toBeNull()
    expect(cellsOfRow(typed('|').doc.firstChild)).toBeNull()
  })

  it('becomes a table on Enter, with an empty row to type into', () => {
    const state = run(typed('| Name | Age |'), tableFromRow)
    expect(serializeMarkdown(state.doc)).toBe('| Name | Age |\n| --- | --- |\n|  |  |')
    expect(state.selection.$head.parent.type.name).toBe('table_cell')
    expect(state.selection.$head.node(-1)).toBe(state.doc.firstChild.child(1))
  })

  it('keeps its marks', () => {
    const state = createEditorState('| **Name** |')
    expect(serializeMarkdown(run(state, tableFromRow).doc)).toBe('| **Name** |\n| --- |\n|  |')
  })

  it('stays a line when the caret is not at its end', () => {
    const state = typed('| a | b |')
    const inside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)))
    expect(run(inside, tableFromRow)).toBeNull()
  })

  it('stays a line in a list item, which a table cannot start', () => {
    expect(run(at(createEditorState('- | a |'), '| a |'), tableFromRow)).toBeNull()
  })

  it('is what Enter does first', () => {
    expect(serializeMarkdown(run(typed('| a |'), keys.Enter).doc)).toBe('| a |\n| --- |\n|  |')
  })
})

describe('Enter in a table', () => {
  it('goes down a row, keeping the column', () => {
    const state = run(at(createEditorState(TABLE), 'b'), nextRow)
    expect(caretIn(state)).toBe('2')
    expect(serializeMarkdown(state.doc)).toBe(TABLE)
  })

  it('adds a row from the last', () => {
    const state = run(at(createEditorState(TABLE), '2'), nextRow)
    expect(serializeMarkdown(state.doc)).toBe(`${TABLE}\n|  |  |`)
    expect(state.selection.$head.parent.type.name).toBe('table_cell')
    expect(state.selection.$head.index(-1)).toBe(1)
  })

  it('ends the table on an empty last row, for a paragraph after', () => {
    const grown = run(at(createEditorState(TABLE), '2'), nextRow)
    const state = run(grown, nextRow)
    expect(serializeMarkdown(state.doc)).toBe(TABLE)
    expect(state.doc.lastChild.type.name).toBe('paragraph')
    expect(state.selection.$head.parent).toBe(state.doc.lastChild)
  })

  it('adds a row under a header with none, rather than ending the table', () => {
    const state = run(createEditorState('|  |\n| --- |'), nextRow)
    expect(state.doc.firstChild.childCount).toBe(2)
  })

  it('is left alone outside a table', () => {
    expect(run(createEditorState('Text'), nextRow)).toBeNull()
  })
})

describe('leaving a table', () => {
  it('puts a paragraph after it, from any cell', () => {
    const state = run(at(createEditorState(`${TABLE}\n\nAfter`), 'a'), exitTable)
    expect(state.doc.content.content.map(n => n.type.name)).toEqual([
      'table',
      'paragraph',
      'paragraph',
    ])
    expect(state.doc.child(1).type.name).toBe('paragraph')
    expect(state.doc.child(1).content.size).toBe(0)
    expect(state.selection.$head.parent).toBe(state.doc.child(1))
  })

  it('is what Shift-Enter does in a cell, which has no line to break', () => {
    const state = run(at(createEditorState(TABLE), '1'), keys['Shift-Enter'])
    expect(state.doc.lastChild.type.name).toBe('paragraph')
    expect(serializeMarkdown(state.doc)).toBe(TABLE)
  })
})

describe('Tab in a table', () => {
  it('goes to the next cell, and the previous with Shift', () => {
    expect(caretIn(run(at(createEditorState(TABLE), 'a'), nextCell))).toBe('b')
    expect(caretIn(run(at(createEditorState(TABLE), '1'), previousCell))).toBe('b')
  })

  it('adds a row from the last cell', () => {
    const state = run(at(createEditorState(TABLE), '2'), nextCell)
    expect(serializeMarkdown(state.doc)).toBe(`${TABLE}\n|  |  |`)
    expect(state.selection.$head.index(-1)).toBe(0)
  })

  it('stays in the table from the first cell with Shift', () => {
    const state = at(createEditorState(TABLE), 'a')
    expect(previousCell(state)).toBe(true)
  })
})

describe('alignColumn', () => {
  it("sets the alignment of the caret's column, header and all", () => {
    const state = run(at(createEditorState(TABLE), '2'), alignColumn('right'))
    expect(serializeMarkdown(state.doc)).toBe('| a | b |\n| --- | ---: |\n| 1 | 2 |')
    expect(alignmentAt(state)).toBe('right')
    expect(state.doc.firstChild.child(1).child(1).attrs.align).toBe('right')
  })

  it('takes it away again', () => {
    const aligned = createEditorState('| a |\n| :-: |\n| 1 |')
    expect(serializeMarkdown(run(at(aligned, 'a'), alignColumn(null)).doc)).toBe(
      '| a |\n| --- |\n| 1 |'
    )
  })
})

describe('deleting a table', () => {
  /** The state with the cells from the one reading `from` to the one reading `to` selected. */
  const cells = (state, from, to) => {
    const before = text => at(state, text).selection.$head.before()
    return state.apply(
      state.tr.setSelection(CellSelection.create(state.doc, before(from), before(to)))
    )
  }

  const EMPTY = '|  |  |\n| --- | --- |\n|  |  |'

  /** The state with every cell of its first table selected. */
  const whole = state => {
    let first = null
    let last = null
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'table_cell') return true
      if (first === null) first = pos
      last = pos
      return false
    })
    return state.apply(state.tr.setSelection(CellSelection.create(state.doc, first, last)))
  }

  it('takes an empty table away, with the caret at the start of what followed', () => {
    const next = run(whole(createEditorState(`Before\n\n${EMPTY}\n\nAfter`)), deleteEmptyTable)
    expect(serializeMarkdown(next.doc)).toBe('Before\n\nAfter')
    expect(next.selection.$head.parent).toBe(next.doc.lastChild)
    expect(next.selection.$head.parentOffset).toBe(0)
  })

  it('leaves the caret at the end of what came before a table that was last', () => {
    const next = run(whole(createEditorState(`Before\n\n${EMPTY}`)), deleteEmptyTable)
    expect(serializeMarkdown(next.doc)).toBe('Before')
    expect(next.selection.$head.parentOffset).toBe('Before'.length)
  })

  it('leaves an empty paragraph where a table was all there was', () => {
    const next = run(whole(createEditorState(EMPTY)), deleteEmptyTable)
    expect(next.doc.content.content.map(n => n.type.name)).toEqual(['paragraph'])
    expect(next.selection.$head.parent).toBe(next.doc.firstChild)
  })

  it('leaves a table with words in it to have them emptied first', () => {
    expect(run(cells(createEditorState(TABLE), 'a', '2'), deleteEmptyTable)).toBeNull()
  })

  it('leaves a table when only some of its cells are selected', () => {
    expect(run(cells(createEditorState(TABLE), 'a', 'b'), deleteEmptyTable)).toBeNull()
  })

  it('goes with Backspace from the paragraph after it: select, empty, delete', () => {
    const view = new EditorView(document.createElement('div'), {
      state: at(createEditorState(`${TABLE}\n\nAfter`), 'After'),
    })
    const start = view.state.selection.$head.start()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start)))
    const backspace = () =>
      view.someProp('handleKeyDown', f =>
        f(view, new window.KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8 }))
      )

    backspace()
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    backspace()
    expect(serializeMarkdown(view.state.doc)).toBe('|  |  |\n| --- | --- |\n|  |  |\n\nAfter')
    backspace()
    expect(serializeMarkdown(view.state.doc)).toBe('After')
    expect(view.state.selection.$head.parent).toBe(view.state.doc.firstChild)
    expect(view.state.selection.$head.parentOffset).toBe(0)
    view.destroy()
  })
})

describe('pasting', () => {
  /** @type {EditorView|null} */
  let view = null
  afterEach(() => {
    view?.destroy()
    view = null
  })

  /** A view over `state`. */
  const viewOf = state => {
    view = new EditorView(document.createElement('div'), { state })
    return view
  }

  /** A paste event whose clipboard holds this HTML, as the browser's would. */
  const clipboard = html => ({
    clipboardData: { getData: type => (type === 'text/html' ? html : '') },
  })

  it('keeps lines pasted into a cell in that cell, and leaves the cells beside it alone', () => {
    const view = viewOf(
      at(createEditorState('| a | b | c |\n| --- | --- | --- |\n| x | y | z |'), 'y')
    )
    view.pasteText('one\ntwo\n\nthree')
    expect(serializeMarkdown(view.state.doc)).toBe(
      '| a | b | c |\n| --- | --- | --- |\n| x | yone two three | z |'
    )
  })

  it('keeps the marks of one pasted line', () => {
    const view = viewOf(at(createEditorState(TABLE), '1'))
    view.pasteHTML('<p>very <strong>bold</strong></p>')
    expect(serializeMarkdown(view.state.doc)).toBe(
      '| a | b |\n| --- | --- |\n| 1very **bold** | 2 |'
    )
  })

  it('pastes cells copied from a table over the cells from this one on', () => {
    const view = viewOf(at(createEditorState(TABLE), '1'))
    const html = '<table><tr><td>p</td><td>q</td></tr></table>'
    view.pasteHTML(html, /** @type {any} */ (clipboard(html)))
    expect(serializeMarkdown(view.state.doc)).toBe('| a | b |\n| --- | --- |\n| p | q |')
  })

  it("reads a pasted table's cells as one line each, blocks and all", () => {
    const view = viewOf(createEditorState(''))
    view.pasteHTML(
      '<table><tbody><tr><th>Head</th><th style="text-align: right">Count</th></tr>' +
        '<tr><td><p>one</p><p><b>more</b></p></td><td><ul><li>item</li></ul>line<br>after</td></tr>' +
        '</tbody></table>'
    )
    expect(serializeMarkdown(view.state.doc)).toBe(
      '| Head | Count |\n| --- | ---: |\n| one **more** | item line after |'
    )
  })
})
