import { describe, it, expect } from 'vitest'
import { createEditorState } from '@/editor/state.js'
import { draftRange, withDraft } from '@/editor/commentDraft.js'

describe('commentDraft', () => {
  // "Snow" is 6 to 10, after the heading "One".
  const state = createEditorState('# One\n\nSnow fell.')

  it('holds a passage set by a transaction, and lets it go when cleared', () => {
    expect(draftRange(state)).toBe(null)
    const held = state.apply(withDraft(state.tr, { from: 6, to: 10 }))
    expect(draftRange(held)).toEqual({ from: 6, to: 10 })
    expect(draftRange(held.apply(withDraft(held.tr, null)))).toBe(null)
  })

  it('follows the passage through edits around it', () => {
    const held = state.apply(withDraft(state.tr, { from: 6, to: 10 }))
    const typed = held.apply(held.tr.insertText('Deep ', 6))
    expect(draftRange(typed)).toEqual({ from: 11, to: 15 })
    expect(typed.doc.textBetween(11, 15)).toBe('Snow')
    // Typing at its end is outside it.
    const after = typed.apply(typed.tr.insertText('y', 15))
    expect(draftRange(after)).toEqual({ from: 11, to: 15 })
  })

  it('goes with its words', () => {
    const held = state.apply(withDraft(state.tr, { from: 6, to: 10 }))
    expect(draftRange(held.apply(held.tr.delete(5, 11)))).toBe(null)
  })
})
