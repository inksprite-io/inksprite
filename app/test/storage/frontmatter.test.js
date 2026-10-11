import { describe, it, expect } from 'vitest'
import { withFrontmatter, readFrontmatter } from '@/storage/frontmatter.js'

describe('frontmatter', () => {
  it('reads back the fields and the body it wrote', () => {
    const fields = { id: 'doc_1', title: 'A: b', summary: 'two\nlines', n: '123' }
    for (const body of ['', 'Text.', '\nStarts with a blank line', '---\nlooks: like it\n---\n']) {
      expect(readFrontmatter(withFrontmatter(fields, body))).toEqual({ fields, body })
    }
  })

  it('puts a blank line between the two and nothing after the body', () => {
    expect(withFrontmatter({ id: 'x' }, 'Body.')).toBe('---\nid: x\n---\n\nBody.')
    expect(withFrontmatter({ id: 'x' }, '')).toBe('---\nid: x\n---\n')
  })

  it('takes a file with none, or with YAML it cannot read, as all body', () => {
    expect(readFrontmatter('Just text.')).toEqual({ fields: null, body: 'Just text.' })
    const broken = '---\nid: [nope\n---\n\nText.'
    expect(readFrontmatter(broken)).toEqual({ fields: null, body: broken })
    expect(readFrontmatter('---\n- a list\n---\n').fields).toBeNull()
  })

  it('reads files written on Windows, and an empty block', () => {
    expect(readFrontmatter('---\r\nid: x\r\n---\r\n\r\nBody.')).toEqual({
      fields: { id: 'x' },
      body: 'Body.',
    })
    expect(readFrontmatter('---\n---\nBody.')).toEqual({ fields: {}, body: 'Body.' })
  })
})
