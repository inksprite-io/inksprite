import { describe, it, expect } from 'vitest'
import { looksLikeCodebase } from '@/source/detect.js'

describe('looksLikeCodebase', () => {
  it('takes a folder of code for one', () => {
    expect(looksLikeCodebase(['src/foo.cpp', 'src/foo.h', 'Makefile', 'README.md'])).toBe(true)
  })

  it('counts what a repository import would take, not packages or version control', () => {
    const packages = Array.from({ length: 50 }, (_, at) => `node_modules/p${at}/index.js`)
    const history = Array.from({ length: 50 }, (_, at) => `.git/objects/${at}`)

    expect(
      looksLikeCodebase([...packages, 'src/a.ts', 'src/b.ts', 'package.json', 'README.md'])
    ).toBe(true)
    expect(looksLikeCodebase([...history, ...packages, 'notes.md', 'outline.md'])).toBe(false)
  })

  it('leaves alone a manuscript kept in git, and a folder of papers', () => {
    const chapters = Array.from({ length: 12 }, (_, at) => `chapters/${at + 1}.md`)

    expect(looksLikeCodebase(['.git/HEAD', '.gitignore', ...chapters, 'build.sh'])).toBe(false)
    expect(looksLikeCodebase(['a.pdf', 'b.pdf', 'figure.png', 'data.csv'])).toBe(false)
  })

  it('wants more than half to be code, and a few files of it', () => {
    expect(looksLikeCodebase(['a.py', 'b.py'])).toBe(false)
    expect(looksLikeCodebase(['a.py', 'b.py', 'c.py', 'one.md', 'two.md', 'three.md'])).toBe(false)
    expect(looksLikeCodebase(['a.py', 'b.py', 'c.py', 'one.md', 'two.md'])).toBe(true)
  })
})
