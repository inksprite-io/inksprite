import { describe, it, expect } from 'vitest'
import { lineDiff } from '@/utils/lineDiff.js'

const lines = (...all) => all.join('\n')

describe('lineDiff', () => {
  it('is empty for two texts that are the same', () => {
    expect(lineDiff('one\ntwo', 'one\ntwo')).toBe('')
    expect(lineDiff('', '')).toBe('')
  })

  it('marks the line that went and the one that came, with the lines around them', () => {
    const before = lines('one', 'two', 'three', 'four', 'five', 'six', 'seven')
    const after = lines('one', 'two', 'three', 'FOUR', 'five', 'six', 'seven')

    expect(lineDiff(before, after)).toBe(
      lines('@@ -2,5 +2,5 @@', ' two', ' three', '-four', '+FOUR', ' five', ' six')
    )
  })

  it('shows a line added and a line taken out', () => {
    expect(lineDiff(lines('a', 'b', 'c'), lines('a', 'b', 'new', 'c'))).toBe(
      lines('@@ -1,3 +1,4 @@', ' a', ' b', '+new', ' c')
    )
    expect(lineDiff(lines('a', 'b', 'c'), lines('a', 'c'))).toBe(
      lines('@@ -1,3 +1,2 @@', ' a', '-b', ' c')
    )
  })

  it('shows what was added to the end, and what was put at the start', () => {
    expect(lineDiff(lines('a', 'b'), lines('a', 'b', '', 'c'))).toBe(
      lines('@@ -1,2 +1,4 @@', ' a', ' b', '+', '+c')
    )
    expect(lineDiff(lines('b', 'c', 'd', 'e'), lines('a', 'b', 'c', 'd', 'e'))).toBe(
      lines('@@ -1,2 +1,3 @@', '+a', ' b', ' c')
    )
  })

  it('keeps changes far apart in stretches of their own, and those near in one', () => {
    const before = Array.from({ length: 20 }, (_, at) => `line ${at + 1}`)
    const far = [...before]
    far[1] = 'changed 2'
    far[17] = 'changed 18'
    const diff = lineDiff(before.join('\n'), far.join('\n'))

    expect(diff.split('\n').filter(line => line.startsWith('@@'))).toEqual([
      '@@ -1,4 +1,4 @@',
      '@@ -16,5 +16,5 @@',
    ])

    const near = [...before]
    near[4] = 'changed 5'
    near[7] = 'changed 8'
    expect(
      lineDiff(before.join('\n'), near.join('\n'))
        .split('\n')
        .filter(line => line.startsWith('@@'))
    ).toEqual(['@@ -3,8 +3,8 @@'])
  })

  it('shows as many lines around a change as asked', () => {
    const before = lines('a', 'b', 'c', 'd', 'e')
    const after = lines('a', 'b', 'C', 'd', 'e')
    expect(lineDiff(before, after, { context: 0 })).toBe(lines('@@ -3,1 +3,1 @@', '-c', '+C'))
    expect(lineDiff(before, after, { context: 1 })).toBe(
      lines('@@ -2,3 +2,3 @@', ' b', '-c', '+C', ' d')
    )
  })

  it('gives up on two texts that differ by more than it is to tell', () => {
    const before = Array.from({ length: 50 }, (_, at) => `a${at}`).join('\n')
    const after = Array.from({ length: 50 }, (_, at) => `b${at}`).join('\n')
    expect(lineDiff(before, after, { maxEdits: 20 })).toBeNull()
    expect(lineDiff(before, after)).toContain('-a0')
  })
})
