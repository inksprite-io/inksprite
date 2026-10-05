import { describe, it, expect } from 'vitest'
import { lastSceneToLastDocument } from '../../../src/stores/migrations/lastDocument.js'

const story = (id, extra = {}) => ({ id, overview: '', version: 1, ...extra })

describe('lastSceneToLastDocument', () => {
  it('moves the id onto the new field', () => {
    const { stories, renamed } = lastSceneToLastDocument([story('s1', { lastSceneId: 'doc_1' })])

    expect(stories[0].lastDocumentId).toBe('doc_1')
    expect('lastSceneId' in stories[0]).toBe(false)
    expect(renamed).toBe(1)
  })

  it('carries a null through rather than dropping the field', () => {
    const { stories } = lastSceneToLastDocument([story('s1', { lastSceneId: null })])
    expect(stories[0].lastDocumentId).toBeNull()
  })

  it('leaves a story that has already been migrated alone', () => {
    const { stories, renamed } = lastSceneToLastDocument([story('s1', { lastDocumentId: 'doc_1' })])

    expect(stories[0].lastDocumentId).toBe('doc_1')
    expect(renamed).toBe(0)
  })

  it('keeps the newer value when a row somehow carries both', () => {
    // A re-imported backup must not walk a current pointer back to an old one.
    const { stories } = lastSceneToLastDocument([
      story('s1', { lastSceneId: 'doc_old', lastDocumentId: 'doc_new' }),
    ])

    expect(stories[0].lastDocumentId).toBe('doc_new')
  })

  it('tolerates empty and missing input', () => {
    expect(lastSceneToLastDocument([])).toEqual({ stories: [], renamed: 0 })
    expect(lastSceneToLastDocument(null)).toEqual({ stories: [], renamed: 0 })
  })
})
