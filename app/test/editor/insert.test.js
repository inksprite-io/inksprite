import { describe, it, expect } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { createEditorState } from '../../src/editor/state.js'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import { insertCodeBlock, insertRule, insertTable } from '../../src/editor/insert.js'

/** The state with the caret at the end of the first textblock reading `text`. */
const at = (markdown, text) => {
  const state = createEditorState(markdown)
  let pos = null
  state.doc.descendants((node, offset) => {
    if (pos !== null) return false
    if (node.isTextblock && node.textContent === text) pos = offset + 1 + node.content.size
    return pos === null
  })
  if (pos === null) throw new Error(`no block reads ${JSON.stringify(text)}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** The state with an empty line after the textblock reading `text`, and the caret on it. */
const emptyLineAfter = (markdown, text) => {
  const state = at(markdown, text)
  return state.apply(state.tr.split(state.selection.head))
}

/** Run a command, and hand back the state after it. */
const run = (state, command) => {
  let next = null
  command(state, tr => {
    next = state.apply(tr)
  })
  if (!next) throw new Error('declined')
  return next
}

/** The kinds of block the document holds, in order. */
const blocks = state => state.doc.content.content.map(node => node.type.name)

/** What the caret is in. */
const caretIn = state => state.selection.$head.parent.type.name

describe('insertTable', () => {
  it('takes the place of an empty line, with the caret in its first cell', () => {
    const state = run(emptyLineAfter('Before\n\nAfter', 'Before'), insertTable)
    expect(serializeMarkdown(state.doc)).toBe('Before\n\n|  |  |\n| --- | --- |\n|  |  |\n\nAfter')
    expect(caretIn(state)).toBe('table_cell')
    expect([state.selection.$head.index(-2), state.selection.$head.index(-1)]).toEqual([0, 0])
  })

  it('goes after the paragraph the caret is in, leaving it whole', () => {
    const state = run(at('A line.\n\nAfter', 'A line.'), insertTable)
    expect(blocks(state)).toEqual(['paragraph', 'table', 'paragraph'])
    expect(state.doc.firstChild.textContent).toBe('A line.')
  })

  it('goes after the table it is asked for in, not into a cell', () => {
    const state = run(at('| a | b |\n| --- | --- |\n| 1 | 2 |', '1'), insertTable)
    expect(blocks(state)).toEqual(['table', 'table'])
  })

  it('goes after the line in a list item, inside the item', () => {
    const state = run(at('- one\n- two', 'one'), insertTable)
    const list = state.doc.firstChild
    expect(list.firstChild.content.content.map(node => node.type.name)).toEqual([
      'paragraph',
      'table',
    ])
  })
})

describe('insertRule', () => {
  it('puts a rule and a line after it to write on, with the caret there', () => {
    const state = run(at('Before', 'Before'), insertRule)
    expect(blocks(state)).toEqual(['paragraph', 'horizontal_rule', 'paragraph'])
    expect(state.selection.$head.parent).toBe(state.doc.lastChild)
  })

  it('takes the place of an empty line', () => {
    const state = run(emptyLineAfter('Before', 'Before'), insertRule)
    expect(serializeMarkdown(state.doc)).toBe('Before\n\n---')
    expect(blocks(state)).toEqual(['paragraph', 'horizontal_rule', 'paragraph'])
  })
})

describe('insertCodeBlock', () => {
  it('puts an empty code block after the line, with the caret in it', () => {
    const state = run(at('Before\n\nAfter', 'Before'), insertCodeBlock)
    expect(blocks(state)).toEqual(['paragraph', 'code_block', 'paragraph'])
    expect(caretIn(state)).toBe('code_block')
  })

  it('goes after a code block the caret is in', () => {
    const state = run(at('```\nlet x\n```', 'let x'), insertCodeBlock)
    expect(blocks(state)).toEqual(['code_block', 'code_block'])
    expect(state.selection.$head.parent).toBe(state.doc.lastChild)
  })
})
