import { describe, it, expect } from 'vitest'
import { partsAndScenesToDocuments } from '@/stores/migrations/documents.js'

const part = (overrides = {}) => ({
  id: 'part_1',
  storyId: 'story_1',
  order: 0,
  title: 'Act 1',
  summary: 'the setup',
  version: 3,
  created: 100,
  updated: 200,
  ...overrides,
})

const scene = (overrides = {}) => ({
  id: 'scene_1',
  partId: 'part_1',
  order: 0,
  title: 'Chapter 1',
  content: '<p>Once upon a time.</p>',
  summary: 'it begins',
  wordCount: 4,
  version: 2,
  created: 300,
  updated: 400,
  ...overrides,
})

const byId = documents => new Map(documents.map(d => [d.id, d]))

describe('partsAndScenesToDocuments', () => {
  it('turns a part into a folder parented to its story', () => {
    const { documents } = partsAndScenesToDocuments([part()], [])

    expect(documents).toHaveLength(1)
    expect(documents[0]).toEqual({
      id: 'part_1',
      storyId: 'story_1',
      // The story is the root of its own tree. Null would not be indexable.
      parentId: 'story_1',
      order: 0,
      type: 'folder',
      title: 'Act 1',
      content: '',
      summary: 'the setup',
      wordCount: 0,
      version: 3,
      created: 100,
      updated: 200,
    })
  })

  it('turns a scene into a text document parented to its part', () => {
    const { documents } = partsAndScenesToDocuments([part()], [scene()])
    const doc = byId(documents).get('scene_1')

    expect(doc).toEqual({
      id: 'scene_1',
      storyId: 'story_1',
      parentId: 'part_1',
      order: 0,
      type: 'text',
      title: 'Chapter 1',
      content: '<p>Once upon a time.</p>',
      summary: 'it begins',
      wordCount: 4,
      version: 2,
      created: 300,
      updated: 400,
    })
  })

  it('keeps every id, so existing references still resolve', () => {
    const { documents } = partsAndScenesToDocuments(
      [part(), part({ id: 'drafts_story_1', order: Number.MAX_SAFE_INTEGER, title: '' })],
      [scene()]
    )

    // Scene beats, persisted UI state, and scene ids stored in chat
    // trajectories all point at these.
    expect(documents.map(d => d.id).sort()).toEqual(['drafts_story_1', 'part_1', 'scene_1'])
  })

  it('preserves the drafts part ordering that keeps it last', () => {
    const { documents } = partsAndScenesToDocuments(
      [part({ id: 'drafts_story_1', order: Number.MAX_SAFE_INTEGER })],
      []
    )

    expect(documents[0].order).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('resolves a scene story through its part', () => {
    const { documents } = partsAndScenesToDocuments(
      [part({ id: 'part_a', storyId: 'story_a' }), part({ id: 'part_b', storyId: 'story_b' })],
      [scene({ id: 'scene_a', partId: 'part_a' }), scene({ id: 'scene_b', partId: 'part_b' })]
    )

    const map = byId(documents)
    expect(map.get('scene_a').storyId).toBe('story_a')
    expect(map.get('scene_b').storyId).toBe('story_b')
  })

  it('skips a scene whose part is gone rather than guessing a story', () => {
    const { documents, skipped } = partsAndScenesToDocuments(
      [part()],
      [scene(), scene({ id: 'scene_orphan', partId: 'part_missing' })]
    )

    // Orphans are already unreachable — scenes loaded per part, so one whose
    // part is gone was never read. Inventing a storyId would resurrect it in
    // the wrong story.
    expect(documents.map(d => d.id)).toEqual(['part_1', 'scene_1'])
    expect(skipped).toEqual([
      { id: 'scene_orphan', reason: "no part 'part_missing' to resolve a story from" },
    ])
  })

  it('skips a part with no story, and the scenes under it', () => {
    const { documents, skipped } = partsAndScenesToDocuments(
      [part({ id: 'part_lost', storyId: undefined })],
      [scene({ partId: 'part_lost' })]
    )

    expect(documents).toEqual([])
    expect(skipped.map(s => s.id)).toEqual(['part_lost', 'scene_1'])
  })

  it('carries a row deleted before v17 across still marked, for that upgrade to drop', () => {
    const { documents } = partsAndScenesToDocuments(
      [part()],
      [scene({ deleted: true, deletedAt: 999 })]
    )

    const doc = byId(documents).get('scene_1')
    expect(doc.deleted).toBe(true)
    expect(doc.deletedAt).toBe(999)
  })

  it('produces the same output when run twice', () => {
    const parts = [part()]
    const scenes = [scene()]

    // Dexie retries a failed upgrade, and restore re-runs this on every import.
    expect(partsAndScenesToDocuments(parts, scenes)).toEqual(
      partsAndScenesToDocuments(parts, scenes)
    )
  })

  it('fills in fields that old rows may predate', () => {
    const { documents } = partsAndScenesToDocuments(
      [{ id: 'part_bare', storyId: 'story_1' }],
      [{ id: 'scene_bare', partId: 'part_bare' }]
    )

    const map = byId(documents)
    expect(map.get('part_bare')).toMatchObject({ order: 0, title: '', summary: '', version: 1 })
    expect(map.get('scene_bare')).toMatchObject({ content: '', wordCount: 0 })
    expect(map.get('scene_bare')).not.toHaveProperty('deleted')
  })

  it('tolerates empty input', () => {
    expect(partsAndScenesToDocuments([], [])).toEqual({ documents: [], skipped: [] })
    expect(partsAndScenesToDocuments(null, null)).toEqual({ documents: [], skipped: [] })
  })
})
