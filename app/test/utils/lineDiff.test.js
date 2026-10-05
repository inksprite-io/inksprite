import { describe, it, expect } from 'vitest'
import { changedLines } from '../../src/utils/lineDiff.js'

describe('changedLines', () => {
  it('has nothing to show when nothing changed', () => {
    expect(changedLines('a\nb', 'a\nb')).toEqual([])
    expect(changedLines('', '')).toEqual([])
  })

  it('shows a changed line as the one that went and the one in its place', () => {
    expect(changedLines('intro\n* one\nend', 'intro\n- one\nend')).toEqual([
      { removed: ['* one'], added: ['- one'] },
    ])
  })

  it('keeps changes apart that have unchanged lines between them', () => {
    const before = '* one\nkept\nkept too\n1) first'
    const after = '- one\nkept\nkept too\n1. first'

    expect(changedLines(before, after)).toEqual([
      { removed: ['* one'], added: ['- one'] },
      { removed: ['1) first'], added: ['1. first'] },
    ])
  })

  it('shows lines that only went, or only came', () => {
    expect(changedLines('para\n\n\n\npara', 'para\n\npara')).toEqual([
      { removed: ['', ''], added: [] },
    ])
    expect(changedLines('a\nc', 'a\nb\nc')).toEqual([{ removed: [], added: ['b'] }])
  })

  it('takes a heading written two ways as one change', () => {
    expect(changedLines('Title\n=====\n\nText', '# Title\n\nText')).toEqual([
      { removed: ['Title', '====='], added: ['# Title'] },
    ])
  })

  it('does not match up the lines of a change too big to be worth it', () => {
    const before = Array.from({ length: 2500 }, (_, n) => `line ${n}`).join('\n')
    const after = Array.from({ length: 2500 }, (_, n) => `row ${n}`).join('\n')

    const changes = changedLines(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0].removed).toHaveLength(2500)
    expect(changes[0].added).toHaveLength(2500)
  })
})
