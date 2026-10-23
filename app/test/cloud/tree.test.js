import { describe, it, expect } from 'vitest'
import { treeFixes } from '@/cloud/tree.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'
const ROOT = rootIdFor(STORY)

/**
 * @param {string} id
 * @param {string} parentId
 * @param {object} [more]
 */
const doc = (id, parentId, more = {}) => ({
  id,
  storyId: STORY,
  parentId,
  type: 'text',
  title: id,
  content: '',
  order: 0,
  created: 1000,
  updated: 1000,
  ...more,
})

const root = doc(ROOT, STORY, { type: 'folder', title: 'Thief', ordered: true })

describe('putting a merged tree right', () => {
  it('leaves a whole tree alone', () => {
    const tree = [root, doc('part', ROOT, { type: 'folder' }), doc('ch1', 'part')]
    expect(treeFixes(tree, STORY, 5000)).toEqual([])
  })

  it('moves a document whose folder is gone to the root, after what is there', () => {
    const tree = [root, doc('ch1', ROOT, { order: 3 }), doc('ch2', 'gone_folder')]
    expect(treeFixes(tree, STORY, 5000)).toEqual([
      { ...doc('ch2', 'gone_folder'), parentId: ROOT, order: 4, updated: 5000 },
    ])
  })

  it('breaks a loop of folders at the same one on every device', () => {
    const tree = [
      root,
      doc('b_folder', 'a_folder', { type: 'folder' }),
      doc('a_folder', 'b_folder', { type: 'folder' }),
      doc('ch1', 'a_folder'),
    ]
    const fixes = treeFixes(tree, STORY, 5000)
    expect(fixes).toEqual([
      {
        ...doc('a_folder', 'b_folder', { type: 'folder' }),
        parentId: ROOT,
        order: 0,
        updated: 5000,
      },
    ])
    expect(treeFixes([...tree].reverse(), STORY, 5000)).toEqual(fixes)
  })

  it('gives the name to the sibling made first, and the next free one to the other', () => {
    const tree = [
      root,
      doc('ch3_b', ROOT, { title: 'Chapter 3', created: 2000 }),
      doc('ch3_a', ROOT, { title: 'chapter 3 ', created: 1500 }),
      doc('ch3_2', ROOT, { title: 'Chapter 3 (2)', created: 900 }),
    ]
    expect(treeFixes(tree, STORY, 5000)).toEqual([
      { ...doc('ch3_b', ROOT, { title: 'Chapter 3 (3)', created: 2000 }), updated: 5000 },
    ])
  })

  it('lets a name in the trash stand beside one in the tree', () => {
    const tree = [
      root,
      doc('ch3_a', ROOT, { title: 'Chapter 3' }),
      doc('ch3_b', ROOT, { title: 'Chapter 3', trashed: 4000 }),
    ]
    expect(treeFixes(tree, STORY, 5000)).toEqual([])
  })

  it('moves a document in the trash whose folder is gone, so it can come back', () => {
    const tree = [root, doc('ch2', 'gone_folder', { trashed: 4000 })]
    expect(treeFixes(tree, STORY, 5000)[0].parentId).toBe(ROOT)
  })

  it('makes no fixes in a tree without its root', () => {
    expect(treeFixes([doc('ch2', 'gone_folder')], STORY, 5000)).toEqual([])
  })
})
