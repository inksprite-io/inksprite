import { describe, it, expect } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { createEditorState, keys } from '../../src/editor/state.js'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import {
  MARKS,
  STYLES,
  WRAPPERS,
  formatCommand,
  formattingAt,
  hasStyles,
  styleAt,
} from '../../src/editor/format.js'

/** The state with `text` selected, where it first comes in a block, marked or not. */
const selecting = (markdown, text) => {
  const state = createEditorState(markdown)
  let found = null
  state.doc.descendants((node, pos) => {
    if (found !== null || !node.isTextblock) return found === null
    const at = node.textContent.indexOf(text)
    if (at >= 0) found = pos + 1 + at
    return false
  })
  if (found === null) throw new Error(`no text reads ${JSON.stringify(text)}`)
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, found, found + text.length))
  )
}

/** Run a format by its id, and hand back the markdown after it. */
const run = (state, id) => {
  let next = null
  formatCommand(id)(state, tr => {
    next = state.apply(tr)
  })
  if (!next) throw new Error('declined')
  return serializeMarkdown(next.doc)
}

describe('editor/format', () => {
  it('names a key the editor has for every format', () => {
    for (const { keys: binding } of [...MARKS, ...STYLES, ...WRAPPERS]) {
      expect(keys[binding], binding).toBeTypeOf('function')
    }
  })

  it('toggles a mark as its key does: off where any of the selection has it', () => {
    expect(run(selecting('A cold night.', 'cold'), 'strong')).toBe('A **cold** night.')
    expect(run(selecting('A **cold** night.', 'cold'), 'strong')).toBe('A cold night.')
    expect(run(selecting('A **cold** night.', 'A cold'), 'strong')).toBe('A cold night.')
    expect(run(selecting('A cold night.', 'night'), 'strikethrough')).toBe('A cold ~~night~~.')
  })

  it('says which marks the selection has, and that none go in a code block', () => {
    const marked = formattingAt(selecting('A ***cold*** night.', 'cold'))
    expect(marked.on).toMatchObject({ strong: true, em: true, code: false, link: false })
    expect(marked.can).toMatchObject({ strong: true, code: true, link: true, clear: true })

    const code = formattingAt(selecting('```\nA cold night.\n```', 'cold'))
    expect(code.can).toMatchObject({ strong: false, em: false, link: false, clear: false })
    expect(code.style).toBe('code_block')
    expect(code.can.paragraph).toBe(true)
  })

  it('clears the marks off the text, and leaves its link and comment', () => {
    const state = selecting('A **cold** [*dark*](https://example.com) night.', 'cold dark')
    expect(run(state, 'clear')).toBe('A cold [dark](https://example.com) night.')

    const commented = selecting('A {==**cold**==}{>>cabcd1<<} night.', 'cold')
    expect(run(commented, 'clear')).toBe('A {==cold==}{>>cabcd1<<} night.')
    expect(formattingAt(selecting('A cold night.', 'cold')).can.clear).toBe(false)
  })

  it('sets the style of the blocks, a heading back to normal text among them', () => {
    expect(run(selecting('A cold night.', 'cold'), 'heading2')).toBe('## A cold night.')
    expect(run(selecting('## A cold night.', 'cold'), 'paragraph')).toBe('A cold night.')
    expect(run(selecting('A cold night.', 'cold'), 'code_block')).toBe('```\nA cold night.\n```')
  })

  it('names the style the blocks share, and none where they differ', () => {
    expect(styleAt(selecting('### Snow\n\nA cold night.', 'Snow'))).toBe('heading3')
    expect(styleAt(selecting('# Snow\n\n# Ice', 'Snow'))).toBe('heading1')
    const both = selecting('# Snow\n\nA cold night.', 'Snow')
    const across = both.apply(
      both.tr.setSelection(TextSelection.create(both.doc, 2, both.doc.content.size - 2))
    )
    expect(styleAt(across)).toBe(null)
  })

  it('offers no style in a table, whose cells hold text alone', () => {
    const cell = formattingAt(selecting('| a | b |\n| --- | --- |\n| cold | 2 |', 'cold'))
    expect(cell.style).toBe(null)
    expect(hasStyles(cell)).toBe(false)
    expect(cell.can.strong).toBe(true)
    expect(hasStyles(formattingAt(selecting('A cold night.', 'cold')))).toBe(true)
  })

  it('quotes the blocks, and lifts them out of the quote again', () => {
    const quoted = run(selecting('A cold night.', 'cold'), 'blockquote')
    expect(quoted).toBe('> A cold night.')
    expect(formattingAt(selecting(quoted, 'cold')).on.blockquote).toBe(true)
    expect(run(selecting(quoted, 'cold'), 'blockquote')).toBe('A cold night.')
    // Only the selected block, the rest of the quote around it kept.
    expect(run(selecting('> One.\n>\n> Two.\n>\n> Three.', 'Two'), 'blockquote')).toBe(
      '> One.\n\nTwo.\n\n> Three.'
    )
  })

  it('makes a list, takes it off, and turns one kind into the other', () => {
    const listed = run(selecting('A cold night.', 'cold'), 'bullet_list')
    expect(listed).toBe('- A cold night.')
    expect(formattingAt(selecting(listed, 'cold')).on).toMatchObject({
      bullet_list: true,
      ordered_list: false,
    })
    expect(run(selecting(listed, 'cold'), 'bullet_list')).toBe('A cold night.')
    expect(run(selecting('- One\n- Two', 'Two'), 'ordered_list')).toBe('1. One\n2. Two')
  })

  it('toggles the quote and the lists from their keys too', () => {
    const state = selecting('> A cold night.', 'cold')
    let next = null
    keys['Mod-Shift-b'](state, tr => {
      next = state.apply(tr)
    })
    expect(serializeMarkdown(next.doc)).toBe('A cold night.')
  })
})
