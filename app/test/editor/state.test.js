import { describe, it, expect } from 'vitest'
import { undo } from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import { schema } from '../../src/editor/schema.js'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import {
  createEditorState,
  replaceContent,
  appendContent,
  isEmptyDocument,
  rules,
  horizontalRuleRule,
  markInputRule,
} from '../../src/editor/state.js'

/** Run a typed shortcut the way the plugin would when `typed` is entered. */
const type = (state, rule, typed) => {
  const from = state.selection.from
  const $from = state.doc.resolve(from)
  const before = $from.parent.textBetween(0, $from.parentOffset) + typed
  const match = rule.match.exec(before)
  if (!match) return null
  return rule.handler(state, match, from - (match[0].length - typed.length), from)
}

/** A document the writer has typed `text` into, so it is text and not markdown. */
const typed = text => {
  const state = createEditorState('')
  return state.apply(state.tr.insertText(text))
}

/** Undo once, as the key would. */
const undone = state => {
  let next = state
  undo(state, tr => {
    next = state.apply(tr)
  })
  return next
}

describe('createEditorState', () => {
  it('holds the document with the caret at its end', () => {
    const state = createEditorState('# One\n\nTwo.')
    expect(serializeMarkdown(state.doc)).toBe('# One\n\nTwo.')
    expect(state.selection.from).toBe(state.doc.content.size - 1)
  })

  it('reads nothing as one empty paragraph', () => {
    const state = createEditorState('')
    expect(isEmptyDocument(state.doc)).toBe(true)
    expect(isEmptyDocument(createEditorState('x').doc)).toBe(false)
    expect(isEmptyDocument(createEditorState('One\n\nTwo').doc)).toBe(false)
  })
})

describe('replaceContent', () => {
  it('replaces the whole document as one undo step', () => {
    const state = createEditorState('Old.')
    const replaced = state.apply(replaceContent(state, '# New\n\nText.'))

    expect(serializeMarkdown(replaced.doc)).toBe('# New\n\nText.')
    expect(replaced.selection.from).toBe(replaced.doc.content.size - 1)
    expect(serializeMarkdown(undone(replaced).doc)).toBe('Old.')
  })

  it('is its own undo step, apart from typing just before it', () => {
    const state = createEditorState('Old')
    const typed = state.apply(state.tr.insertText('.'))
    const replaced = typed.apply(replaceContent(typed, 'New.'))

    expect(serializeMarkdown(undone(replaced).doc)).toBe('Old.')
  })
})

describe('appendContent', () => {
  it('adds blocks after the last, leaving the caret where it was', () => {
    const state = createEditorState('One.')
    const caret = state.apply(
      state.tr.setSelection(state.selection.constructor.create(state.doc, 2))
    )
    const appended = caret.apply(appendContent(caret, '## Two\n\nThree.'))

    expect(serializeMarkdown(appended.doc)).toBe('One.\n\n## Two\n\nThree.')
    expect(appended.selection.from).toBe(2)
    expect(serializeMarkdown(undone(appended).doc)).toBe('One.')
  })

  it('replaces an empty document rather than leaving a blank paragraph above', () => {
    const state = createEditorState('')
    const appended = state.apply(appendContent(state, 'First.'))
    expect(appended.doc.childCount).toBe(1)
    expect(serializeMarkdown(appended.doc)).toBe('First.')
  })
})

describe('typed shortcuts', () => {
  const [headingRule, blockquoteRule, orderedRule, bulletRule, codeRule] = rules

  it('turn a line into the block its prefix names', () => {
    const state = typed('#')
    const tr = type(state, headingRule, ' ')
    expect(state.apply(tr).doc.firstChild.type).toBe(schema.nodes.heading)

    expect(type(typed('>'), blockquoteRule, ' ')).not.toBeNull()
    expect(type(typed('-'), bulletRule, ' ')).not.toBeNull()
    expect(type(typed('``'), codeRule, '`')).not.toBeNull()
    // "3." is not yet "3. "; the rule wants the space.
    expect(type(typed('3'), orderedRule, '.')).toBeNull()
  })

  it('numbers a list from where the writer started it', () => {
    const state = typed('3.')
    const tr = type(state, orderedRule, ' ')
    const list = state.apply(tr).doc.firstChild
    expect(list.type).toBe(schema.nodes.ordered_list)
    expect(list.attrs.order).toBe(3)
  })

  it('draws a rule from three dashes and leaves a paragraph to type into', () => {
    const state = typed('--')
    const next = state.apply(type(state, horizontalRuleRule, '-'))

    expect(next.doc.childCount).toBe(2)
    expect(next.doc.firstChild.type).toBe(schema.nodes.horizontal_rule)
    expect(next.doc.lastChild.type).toBe(schema.nodes.paragraph)
    expect(next.selection.$from.parent).toBe(next.doc.lastChild)
    expect(type(createEditorState('# --'), horizontalRuleRule, '-')).toBeNull()
  })

  it('marks text typed between delimiters and drops the delimiters', () => {
    const rule = markInputRule(
      /(?:^|\s)(\*\*(?!\s+\*\*)([^*]+)\*\*(?!\s+\*\*))$/,
      schema.marks.strong
    )
    const state = typed('some **bold*')
    const next = state.apply(type(state, rule, '*'))

    expect(serializeMarkdown(next.doc)).toBe('some **bold**')
    expect(next.doc.textContent).toBe('some bold')
    // What is typed next is plain.
    expect(next.storedMarks).toEqual([])
  })

  it('does not mark across a word boundary that is not there', () => {
    const rule = markInputRule(/(?:^|\s)(\*(?!\s+\*)([^*]+)\*(?!\s+\*))$/, schema.marks.em)
    expect(type(typed('a*b'), rule, '*')).toBeNull()
  })
})

describe('typography as you type', () => {
  /**
   * Type `text` a character at a time through the editor's own input rules,
   * as a view would hand them its keystrokes.
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

  /** The text of the first block. */
  const text = state => state.doc.firstChild.textContent

  it('curls quotes and apostrophes', () => {
    const state = typeInto(createEditorState(''), `"It's late," she said. 'Go.'`)
    expect(text(state)).toBe('“It’s late,” she said. ‘Go.’')
  })

  it('makes a dash of two hyphens and an ellipsis of three dots', () => {
    const state = typeInto(createEditorState(''), 'Wait -- what...')
    expect(text(state)).toBe('Wait — what…')
  })

  it('still draws a rule from three dashes on a line of their own', () => {
    const state = typeInto(createEditorState(''), '---')
    expect(state.doc.firstChild.type).toBe(schema.nodes.horizontal_rule)
  })

  it('leaves code as typed', () => {
    const block = typeInto(createEditorState('```\n\n```'), `"a" -- b...`)
    expect(block.doc.firstChild.type).toBe(schema.nodes.code_block)
    expect(block.doc.firstChild.textContent).toBe(`"a" -- b...`)

    const empty = createEditorState('')
    const inCode = empty.apply(empty.tr.addStoredMark(schema.marks.code.create()))
    expect(text(typeInto(inCode, `x "q" -- y`))).toBe(`x "q" -- y`)
  })

  it('takes a conversion back on Backspace straight after', () => {
    const state = typeInto(createEditorState(''), 'a--')
    expect(text(state)).toBe('a—')

    let next = state
    undoInputRule(state, tr => {
      next = state.apply(tr)
    })
    expect(text(next)).toBe('a--')
  })
})
