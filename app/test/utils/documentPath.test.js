import { describe, it, expect } from 'vitest'
import { documentPath } from '@/utils/documentPath.js'

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
