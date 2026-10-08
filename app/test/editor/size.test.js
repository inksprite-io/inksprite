import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../../src/editor/markdown.js'
import { LAYOUT_LIMIT, laysOut } from '../../src/editor/size.js'

describe('laysOut', () => {
  it('counts what the editor puts in the page, not characters', () => {
    const long = 'A sentence of the long road north, with no end to it in sight. '.repeat(20000)
    expect(laysOut(parseMarkdown(long))).toBe(true)
  })

  it('stops at the limit', () => {
    const items = count => Array(count).fill('- item').join('\n')
    // A list, and an item and a paragraph in it for each line.
    const most = Math.floor((LAYOUT_LIMIT - 1) / 2)
    expect(laysOut(parseMarkdown(items(most)))).toBe(true)
    expect(laysOut(parseMarkdown(items(most + 1)))).toBe(false)
  })
})
