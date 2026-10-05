import { describe, it, expect } from 'vitest'
import {
  documentsToProjectTree,
  defaultProjectFolders,
  rootIdFor,
  manuscriptIdFor,
  draftsIdFor,
} from '@/stores/migrations/projectTree.js'

const doc = (overrides = {}) => ({
  id: 'doc_1',
  storyId: 'story_1',
  parentId: 'story_1',
  order: 0,
  type: 'folder',
  title: '',
  content: '',
  summary: '',
  wordCount: 0,
  version: 1,
  deleted: false,
  deletedAt: null,
  created: 1,
  updated: 1,
  ...overrides,
})

const act = (id, order, title = '') => doc({ id, order, title })
const scene = (id, parentId, order, title = '') => doc({ id, parentId, order, title, type: 'text' })

const byId = documents => new Map(documents.map(d => [d.id, d]))

const stories = [{ id: 'story_1', title: 'My Novel' }]

describe('defaultProjectFolders', () => {
  it('seeds the root title from the story name', () => {
    const [root] = defaultProjectFolders('story_1', 'My Novel', 5)
    expect(root).toMatchObject({ id: 'root_story_1', parentId: 'story_1', title: 'My Novel' })
  })

  it('falls back when a story has no title', () => {
    expect(defaultProjectFolders('story_1', '', 5)[0].title).toBe('Untitled')
  })

  it('orders the manuscript but not the root or notes', () => {
    const [root, manuscript, notes] = defaultProjectFolders('story_1', 'x', 5)

    // A manuscript is a sequence; notes and the root are not.
    expect(manuscript.ordered).toBe(true)
    expect(root.ordered).toBe(false)
    expect(notes.ordered).toBe(false)
  })
})

describe('documentsToProjectTree', () => {
  it('creates the default folders for a story that has none', () => {
    const { documents, restructured } = documentsToProjectTree([], stories, 5)

    expect(documents.map(d => d.id)).toEqual([
      rootIdFor('story_1'),
      manuscriptIdFor('story_1'),
      'notes_story_1',
    ])
    expect(restructured).toEqual(['story_1'])
  })

  it('moves acts under the manuscript, keeping their order', () => {
    const { documents } = documentsToProjectTree(
      [act('part_b', 1, 'Second'), act('part_a', 0, 'First')],
      stories,
      5
    )

    const map = byId(documents)
    expect(map.get('part_a')).toMatchObject({ parentId: manuscriptIdFor('story_1'), order: 0 })
    expect(map.get('part_b')).toMatchObject({ parentId: manuscriptIdFor('story_1'), order: 1 })
  })

  it('marks acts ordered so their chapters stay in sequence', () => {
    const { documents } = documentsToProjectTree([act('part_a', 0, 'First')], stories, 5)
    expect(byId(documents).get('part_a').ordered).toBe(true)
  })

  it('writes down the names the outline used to compute', () => {
    const { documents } = documentsToProjectTree(
      [
        act('part_a', 0),
        scene('scene_1', 'part_a', 0),
        act('part_b', 1),
        scene('scene_2', 'part_b', 0),
      ],
      stories,
      5
    )

    const map = byId(documents)
    // Nothing renumbers: these are the titles that were already on screen.
    expect(map.get('part_a').title).toBe('Act 1')
    expect(map.get('part_b').title).toBe('Act 2')
    expect(map.get('scene_1').title).toBe('Chapter 1')
    expect(map.get('scene_2').title).toBe('Chapter 2')
  })

  it('counts chapters across acts, the way the old outline did', () => {
    const { documents } = documentsToProjectTree(
      [
        act('part_a', 0),
        scene('s1', 'part_a', 0),
        scene('s2', 'part_a', 1),
        act('part_b', 1),
        scene('s3', 'part_b', 0),
      ],
      stories,
      5
    )

    // The first chapter of the second act was "Chapter 3", not "Chapter 1".
    expect(byId(documents).get('s3').title).toBe('Chapter 3')
  })

  it('leaves titles that were set by hand alone', () => {
    const { documents } = documentsToProjectTree(
      [act('part_a', 0, 'Prologue'), scene('scene_1', 'part_a', 0, 'The Ice Road')],
      stories,
      5
    )

    const map = byId(documents)
    expect(map.get('part_a').title).toBe('Prologue')
    expect(map.get('scene_1').title).toBe('The Ice Road')
  })

  it('moves drafts beside the manuscript and retires its ordering hack', () => {
    const { documents } = documentsToProjectTree(
      [
        doc({ id: draftsIdFor('story_1'), order: Number.MAX_SAFE_INTEGER, title: '' }),
        scene('draft_1', draftsIdFor('story_1'), 0),
      ],
      stories,
      5
    )

    const map = byId(documents)
    expect(map.get(draftsIdFor('story_1'))).toMatchObject({
      parentId: rootIdFor('story_1'),
      title: 'drafts',
      ordered: false,
    })
    expect(map.get(draftsIdFor('story_1')).order).not.toBe(Number.MAX_SAFE_INTEGER)
    expect(map.get('draft_1').title).toBe('Untitled Draft')
    // Drafts is not an act, so it must not land inside the manuscript.
    expect(map.get(draftsIdFor('story_1')).parentId).not.toBe(manuscriptIdFor('story_1'))
  })

  it('keeps stories separate', () => {
    const { documents } = documentsToProjectTree(
      [act('part_a', 0, 'A'), doc({ id: 'part_b', storyId: 'story_2', parentId: 'story_2' })],
      [
        { id: 'story_1', title: 'One' },
        { id: 'story_2', title: 'Two' },
      ],
      5
    )

    const map = byId(documents)
    expect(map.get('part_a').parentId).toBe(manuscriptIdFor('story_1'))
    expect(map.get('part_b').parentId).toBe(manuscriptIdFor('story_2'))
    expect(map.get(rootIdFor('story_2')).title).toBe('Two')
  })

  it('leaves a story that already has a root untouched', () => {
    const already = documentsToProjectTree([act('part_a', 0, 'A')], stories, 5).documents

    const { documents, restructured } = documentsToProjectTree(already, stories, 9)

    // A retried upgrade or a re-imported backup must not nest twice.
    expect(documents).toEqual(already)
    expect(restructured).toEqual([])
  })

  it('builds a tree for a story whose record is missing', () => {
    const { documents } = documentsToProjectTree([act('part_a', 0, 'A')], [], 5)
    expect(byId(documents).get(rootIdFor('story_1')).title).toBe('Untitled')
  })

  it('carries along documents it does not recognise', () => {
    const orphan = doc({ id: 'weird', parentId: 'part_missing', type: 'text' })
    const { documents } = documentsToProjectTree([orphan], stories, 5)

    expect(byId(documents).get('weird')).toEqual(orphan)
  })

  it('tolerates empty input', () => {
    expect(documentsToProjectTree([], [], 5)).toEqual({ documents: [], restructured: [] })
  })
})
