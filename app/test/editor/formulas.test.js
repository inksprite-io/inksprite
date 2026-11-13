/* global KeyboardEvent */
import { describe, it, expect, afterEach } from 'vitest'
import { undo } from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from '../../src/editor/schema.js'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import { createEditorState } from '../../src/editor/state.js'
import { formulaKey, insertFormula, settle } from '../../src/editor/formulas.js'

/**
 * Type `text` a character at a time through the editor's own input rules,
 * as a view would hand them its keystrokes.
 *
 * @param {EditorState} start
 * @param {string} text
 */
const typeInto = (start, text) => {
  let state = start
  const view = {
    get state() {
      return state
    },
    dispatch: tr => {
      state = state.apply(tr)
    },
    composing: false,
  }
  const plugin = state.plugins.find(each => each.props.handleTextInput)
  for (const char of text) {
    const { from, to } = state.selection
    const handled = plugin.props.handleTextInput(view, from, to, char, () => state.tr)
    if (!handled) view.dispatch(state.tr.insertText(char, from, to))
  }
  return state
}

/** The first block's children, as their names and what they hold. */
const children = state => {
  const out = []
  state.doc.firstChild.forEach(child =>
    out.push(child.isText ? child.text : `${child.type.name}:${child.attrs.tex}`)
  )
  return out
}

/** @param {EditorState} state @param {import('prosemirror-state').Command} command */
const run = (state, command) => {
  let next = state
  const done = command(state, tr => {
    next = state.apply(tr)
  })
  return done ? next : null
}

describe('typing a formula', () => {
  it('makes one of $…$ once the next character is typed', () => {
    const state = typeInto(createEditorState(''), 'So $x^2$ is')
    expect(children(state)).toEqual(['So ', 'formula:x^2', ' is'])
  })

  it('leaves prices as they are', () => {
    for (const text of ['From $5-$10.', 'It costs $5 and $10', '$x$5']) {
      expect(children(typeInto(createEditorState(''), text))).toEqual([text])
    }
  })

  it('puts back what typography made of the TeX', () => {
    const state = typeInto(createEditorState(''), "$f'(x) = 1, 2...$ ")
    expect(children(state)[0]).toBe("formula:f'(x) = 1, 2...")
  })

  it('makes one of $$…$$ in a sentence', () => {
    const state = typeInto(createEditorState(''), 'One $$y$$.')
    expect(children(state)).toEqual(['One ', 'formula:y', '.'])
  })

  it('is taken back to text by Backspace straight after', () => {
    const state = typeInto(createEditorState(''), 'So $x$ ')
    const back = run(state, undoInputRule)
    expect(back && children(back)).toEqual(['So $x$ '])
  })

  it('makes $$ at the start of an empty paragraph a formula of its own, selected to open', () => {
    const state = typeInto(createEditorState(''), '$$')
    expect(state.doc.firstChild.type.name).toBe('formula_block')
    expect(state.selection).toBeInstanceOf(NodeSelection)
    expect(formulaKey.getState(state)).toBe('start')
  })

  it('leaves $$ where a formula of its own cannot go', () => {
    const start = createEditorState('- ')
    const inItem = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 3)))
    const state = typeInto(inItem, '$$')
    expect(state.doc.firstChild.type.name).toBe('bullet_list')
  })

  it('makes one on Enter, before Enter does what it does', () => {
    let state = typeInto(createEditorState(''), 'So $x$')
    const plugin = state.plugins.find(each => each.spec.key === formulaKey)
    const view = {
      get state() {
        return state
      },
      dispatch: tr => {
        state = state.apply(tr)
      },
    }
    const handled = plugin.props.handleKeyDown(view, new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(handled).toBe(false)
    expect(children(state)).toEqual(['So ', 'formula:x'])
  })
})

describe('a document opened', () => {
  it('starts with the caret in its last text, not on a formula that ends it', () => {
    const state = createEditorState('a\n\n$$\nx\n$$')
    expect(state.selection).toBeInstanceOf(TextSelection)
    expect(state.selection.from).toBe(2)
  })
})

describe('insertFormula', () => {
  it('makes an empty paragraph a formula of its own', () => {
    const state = run(createEditorState(''), insertFormula)
    expect(state?.doc.firstChild.type.name).toBe('formula_block')
    expect(formulaKey.getState(state)).toBe('start')
  })

  it('puts an empty one at the caret, selected to open', () => {
    const start = createEditorState('So it')
    const state = run(
      start.apply(start.tr.setSelection(TextSelection.create(start.doc, 4))),
      insertFormula
    )
    expect(state && children(state)).toEqual(['So ', 'formula:', 'it'])
    expect(state?.selection).toBeInstanceOf(NodeSelection)
  })

  it("takes the selection's words as its TeX", () => {
    const start = createEditorState('So x^2 here')
    const selected = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 4, 7)))
    const state = run(selected, insertFormula)
    expect(state && children(state)).toEqual(['So ', 'formula:x^2', ' here'])
    expect(formulaKey.getState(state)).toBe('end')
  })

  it('puts none in code', () => {
    const start = createEditorState('```\ncode\n```')
    const state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 2)))
    expect(insertFormula(state)).toBe(false)
  })
})

describe('settle', () => {
  const { formula, formula_block, paragraph } = schema.nodes
  const em = schema.marks.em.create()

  /** A document with one formula, in a sentence, and its field's words read back. */
  const settled = (value, node = formula.create({ tex: 'x' }, null, [em])) => {
    const doc = schema.node('doc', null, [
      node.isInline ? paragraph.create(null, [schema.text('a '), node]) : node,
    ])
    const state = EditorState.create({ doc })
    const tr = state.tr
    const size = settle(tr, node.isInline ? 3 : 0, node, value)
    return { doc: tr.doc, size, md: serializeMarkdown(tr.doc) }
  }

  it('gives the formula new TeX, its marks kept', () => {
    const { doc, md } = settled('$y^2$')
    expect(doc.firstChild.child(1).attrs.tex).toBe('y^2')
    expect(doc.firstChild.child(1).marks).toEqual([em])
    expect(md).toBe('a *$y^2$*')
  })

  it('makes it text once a dollar is taken out', () => {
    expect(settled('$x').md).toBe('a *$x*')
  })

  it('makes two of two', () => {
    const { doc, size } = settled('$x$ and $y$')
    expect(doc.firstChild.childCount).toBe(4)
    expect(size).toBe(7)
  })

  it('takes it out when nothing is left', () => {
    for (const value of ['', '$$', '$ $']) expect(settled(value).doc.firstChild.childCount).toBe(1)
  })

  it('keeps one of its own whole, and lets it go to blocks', () => {
    const block = formula_block.create({ tex: 'x' })
    expect(settled('$$\nx\n\ny\n$$', block).md).toBe('$$\nx\ny\n$$')
    expect(settled('$z$', block).md).toBe('$$\nz\n$$')
    expect(settled('Words now', block).md).toBe('Words now')
  })
})

describe('the side a field opens at', () => {
  it('is the side the selection came from, and none after an undo', () => {
    const start = createEditorState('a $x$ b')
    const before = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 3)))
    const fromLeft = before.apply(before.tr.setSelection(NodeSelection.create(before.doc, 3)))
    expect(formulaKey.getState(fromLeft)).toBe('start')
    const after = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 4)))
    const fromRight = after.apply(after.tr.setSelection(NodeSelection.create(after.doc, 3)))
    expect(formulaKey.getState(fromRight)).toBe('end')

    const changed = fromLeft.apply(
      fromLeft.tr.setNodeAttribute(3, 'tex', 'y').setMeta(formulaKey, null)
    )
    const moved = changed.apply(changed.tr.setSelection(TextSelection.create(changed.doc, 1)))
    let back = moved
    undo(moved, tr => (back = moved.apply(tr)))
    expect(back.selection).toBeInstanceOf(NodeSelection)
    expect(formulaKey.getState(back)).toBeNull()
  })
})

describe('the field', () => {
  /** @type {EditorView|null} */
  let view = null

  afterEach(() => {
    view?.destroy()
    view?.dom.remove()
    view = null
  })

  /** A view of `markdown`, editable or not, in the page. */
  const viewOf = (markdown, editable = true) => {
    const place = document.createElement('div')
    document.body.append(place)
    view = new EditorView(place, { state: createEditorState(markdown), editable: () => editable })
    return view
  }

  /** @param {EditorView} editorView @param {number} pos @param {'start'|'end'} side */
  const select = (editorView, pos, side) =>
    editorView.dispatch(
      editorView.state.tr
        .setSelection(NodeSelection.create(editorView.state.doc, pos))
        .setMeta(formulaKey, side)
    )

  /** @param {EditorView} editorView */
  const fieldOf = editorView =>
    /** @type {HTMLInputElement|null} */ (editorView.dom.querySelector('.formula-field'))

  /** @param {HTMLElement} field @param {string} key */
  const press = (field, key) =>
    field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  it('opens with the formula as written, the caret just inside the end it came at', () => {
    const editorView = viewOf('a $x^2$ b')
    select(editorView, 3, 'end')
    const field = fieldOf(editorView)
    expect(field?.value).toBe('$x^2$')
    expect(document.activeElement).toBe(field)
    expect(field?.selectionStart).toBe(4)
  })

  it('writes its words back as it closes, and puts the caret after', () => {
    const editorView = viewOf('a $x$ b')
    select(editorView, 3, 'start')
    const field = /** @type {HTMLInputElement} */ (fieldOf(editorView))
    field.value = '$y^2$'
    press(field, 'Escape')
    expect(fieldOf(editorView)).toBeNull()
    expect(serializeMarkdown(editorView.state.doc)).toBe('a $y^2$ b')
    expect(editorView.state.selection.from).toBe(4)
  })

  it('leaves by the start with the arrow, the caret before it', () => {
    const editorView = viewOf('a $x$ b')
    select(editorView, 3, 'start')
    const field = /** @type {HTMLInputElement} */ (fieldOf(editorView))
    field.setSelectionRange(0, 0)
    press(field, 'ArrowLeft')
    expect(fieldOf(editorView)).toBeNull()
    expect(editorView.state.selection.from).toBe(3)
  })

  it('puts a paragraph after one of its own that ends the document, to go on in', () => {
    const editorView = viewOf('a\n\n$$\nx\n$$')
    select(editorView, 3, 'start')
    const field = /** @type {HTMLTextAreaElement} */ (fieldOf(editorView))
    expect(field.value).toBe('$$\nx\n$$')
    expect(field.selectionStart).toBe(3)
    press(field, 'Escape')
    expect(editorView.state.doc.childCount).toBe(3)
    expect(editorView.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('never opens where the text cannot be changed', () => {
    const editorView = viewOf('a $x$ b', false)
    select(editorView, 3, 'end')
    expect(fieldOf(editorView)).toBeNull()
  })
})
