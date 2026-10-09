import { describe, it, expect } from 'vitest'
import { documentPath, freeTitle, namesake, titleKey } from '@/utils/documentPath.js'

const docs = new Map(
  [
    { id: 'root_s', storyId: 's', parentId: 's', type: 'folder', title: 'Novel' },
    { id: 'chars', storyId: 's', parentId: 'root_s', type: 'folder', title: 'Characters' },
    { id: 'elara', storyId: 's', parentId: 'chars', type: 'text', title: 'Elara' },
    { id: 'unnamed', storyId: 's', parentId: 'chars', type: 'text', title: '' },
  ].map(doc => [doc.id, doc])
)
const get = id => docs.get(id) ?? null

describe('documentPath', () => {
  it('spells a document by its titles from the root down, and the root as "/"', () => {
    expect(documentPath(get, get('root_s'))).toBe('/')
    expect(documentPath(get, get('chars'))).toBe('Characters')
    expect(documentPath(get, get('elara'))).toBe('Characters/Elara')
  })

  it('reads an unnamed document as Untitled', () => {
    expect(documentPath(get, get('unnamed'))).toBe('Characters/Untitled')
  })

  it('names the document as it is given, not as it is now', () => {
    // A record of a change names the document as it was when the change was made.
    expect(documentPath(get, { ...get('elara'), title: 'Elara, before' })).toBe(
      'Characters/Elara, before'
    )
    expect(documentPath(get, null)).toBe('')
  })
})

describe('names in a folder', () => {
  const siblings = [
    { id: 'a', title: 'Elara' },
    { id: 'b', title: '' },
    { id: 'c', title: 'Elara (2)' },
  ]

  it('compares titles as a path is matched', () => {
    expect(titleKey('  Elara ')).toBe('elara')
    expect(titleKey('')).toBe('untitled')
    expect(titleKey(undefined)).toBe('untitled')
  })

  it('finds what already goes by a name, but not the document being named', () => {
    expect(namesake(siblings, 'ELARA')?.id).toBe('a')
    expect(namesake(siblings, 'Untitled')?.id).toBe('b')
    expect(namesake(siblings, 'Elara', 'a')).toBeNull()
    expect(namesake(siblings, 'Riley')).toBeNull()
  })

  it('numbers a name that is taken, past the numbers taken too', () => {
    expect(freeTitle(siblings, 'Riley')).toBe('Riley')
    expect(freeTitle(siblings, 'elara')).toBe('elara (3)')
    expect(freeTitle(siblings, '')).toBe('Untitled (2)')
    expect(freeTitle(siblings, 'Elara', 'a')).toBe('Elara')
  })
})
