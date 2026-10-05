/* global File */
import { describe, it, expect } from 'vitest'
import { carriesFiles, gatherDropped, gatherFiles, isJunk } from '@/files/batch.js'

/** A file as a folder chooser hands it over: with its path under the folder. */
const chosen = (path, type = 'text/plain') => {
  const file = new File(['x'], path.split('/').pop(), { type })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

/** A file-system entry as a drop hands them over. */
const fileEntry = name => ({
  isFile: true,
  isDirectory: false,
  name,
  file: resolve => resolve(new File(['x'], name)),
})
const dirEntry = (name, children) => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    // Handed out a batch at a time, then an empty one, as the API does.
    const batches = [children.slice(0, 2), children.slice(2), []]
    return { readEntries: resolve => resolve(batches.shift() || []) }
  },
})

describe('isJunk', () => {
  it('knows what a file system leaves lying around', () => {
    expect(isJunk('.DS_Store')).toBe(true)
    expect(isJunk('Thumbs.db')).toBe(true)
    expect(isJunk('.git')).toBe(true)
    expect(isJunk('paper.pdf')).toBe(false)
  })
})

describe('gatherFiles', () => {
  it('keeps the folders a chosen folder came with, the folder itself first', () => {
    const files = [chosen('papers/2011/cif.pdf'), chosen('papers/index.md'), chosen('notes.md')]

    expect(gatherFiles(files).map(g => [g.file.name, g.folders])).toEqual([
      ['cif.pdf', ['papers', '2011']],
      ['index.md', ['papers']],
      ['notes.md', []],
    ])
  })

  it('leaves out junk files and anything inside a junk folder', () => {
    const files = [chosen('papers/.DS_Store'), chosen('papers/.git/config'), chosen('papers/a.md')]

    expect(gatherFiles(files).map(g => g.file.name)).toEqual(['a.md'])
  })
})

describe('gatherDropped', () => {
  it('walks dropped folders to the bottom', async () => {
    const tree = dirEntry('research', [
      fileEntry('index.md'),
      dirEntry('papers', [fileEntry('a.pdf'), fileEntry('b.pdf'), fileEntry('c.pdf')]),
      fileEntry('.DS_Store'),
    ])
    const transfer = {
      items: [
        { kind: 'file', webkitGetAsEntry: () => tree },
        { kind: 'file', webkitGetAsEntry: () => fileEntry('loose.md') },
        { kind: 'string', webkitGetAsEntry: () => null },
      ],
      files: [],
    }

    const gathered = await gatherDropped(/** @type {any} */ (transfer))

    expect(gathered.map(g => [g.file.name, g.folders])).toEqual([
      ['index.md', ['research']],
      ['a.pdf', ['research', 'papers']],
      ['b.pdf', ['research', 'papers']],
      ['c.pdf', ['research', 'papers']],
      ['loose.md', []],
    ])
  })

  it('takes the files as they are when there are no entries to walk', async () => {
    const transfer = {
      items: [{ kind: 'file' }],
      files: [new File(['x'], 'a.pdf'), new File(['x'], '.DS_Store')],
    }

    const gathered = await gatherDropped(/** @type {any} */ (transfer))

    expect(gathered.map(g => [g.file.name, g.folders])).toEqual([['a.pdf', []]])
  })
})

describe('carriesFiles', () => {
  it('tells a drop of files from a drag within the page', () => {
    expect(carriesFiles(/** @type {any} */ ({ types: ['Files'] }))).toBe(true)
    expect(carriesFiles(/** @type {any} */ ({ types: ['text/plain'] }))).toBe(false)
    expect(carriesFiles(null)).toBe(false)
  })
})
