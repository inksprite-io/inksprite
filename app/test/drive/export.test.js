import { describe, it, expect } from 'vitest'
import { mendExport } from '@/drive/export.js'
import { settleMarkdown } from '@/editor/markdown.js'

describe('mendExport', () => {
  it('parts a horizontal line from the paragraph above it, which it would make a heading', () => {
    // As Google's export writes a line: under the paragraph, after a hard break.
    const exported = 'The ferry left at six.  \n---\n\nThe crossing took an hour.\n'
    expect(settleMarkdown(exported)).toBe('## The ferry left at six.\n\nThe crossing took an hour.')

    const mended = mendExport(exported)

    expect(mended).toBe('The ferry left at six.\n\n---\n\nThe crossing took an hour.\n')
    expect(settleMarkdown(mended)).toBe(
      'The ferry left at six.\n\n---\n\nThe crossing took an hour.'
    )
  })

  it('parts each of two lines in a row, and a line under a list', () => {
    expect(mendExport('Text\n---\n---\n')).toBe('Text\n\n---\n\n---\n')
    expect(mendExport('- A stop\n---\n')).toBe('- A stop\n\n---\n')
  })

  it('leaves alone a line already apart, a table, and headings', () => {
    for (const text of [
      'The ferry left at six.\n\n---\n\nThe crossing took an hour.\n',
      '| Day | Miles |\n| :---- | :---- |\n| 1 | 12 |\n',
      '# The Title\n\n## The Subtitle\n\nText.\n',
      'A line ending in a hard break  \nand the next.\n',
    ]) {
      expect(mendExport(text)).toBe(text)
    }
  })
})
