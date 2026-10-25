import { describe, it, expect } from 'vitest'
import { sharedWith, sharingOf, shareTree } from '@/utils/sharedDocuments.js'

/**
 * @param {string} id
 * @param {string} parentId
 * @param {object} [more]
 */
const doc = (id, parentId, more = {}) => ({
  id,
  storyId: 'story_1',
  parentId,
  type: 'text',
  title: id,
  content: '',
  order: 0,
  ...more,
})

/**
 * A project: a manuscript shared with a chapter held back, notes shared only
 * in part, and a plan not at all.
 */
const ROWS = [
  doc('root_story_1', 'story_1', { type: 'folder', title: 'Thief', unshared: true }),
  doc('manuscript', 'root_story_1', { type: 'folder' }),
  doc('ch1', 'manuscript'),
  doc('ch2', 'manuscript', { unshared: true }),
  doc('notes', 'root_story_1', { type: 'folder', unshared: true }),
  doc('note1', 'notes'),
  doc('note2', 'notes', { unshared: true }),
  doc('plan', 'root_story_1', { unshared: true }),
  doc('empty', 'root_story_1', { type: 'folder', unshared: true }),
  doc('card', 'root_story_1', { type: 'file', unshared: true }),
  doc('description', 'card', { unshared: true }),
  doc('scenario', 'card', { unshared: true }),
]

/** @param {string} id */
const documentOf = id => /** @type {any} */ (ROWS.find(row => row.id === id))

/** @param {string} parentId */
const childrenOf = parentId => /** @type {any[]} */ (ROWS.filter(row => row.parentId === parentId))

describe('what a project shared with only some documents shares', () => {
  it('says of each what the others see: shared, only on the way, or nothing', () => {
    expect(Object.fromEntries(sharingOf(/** @type {any[]} */ (ROWS), 'story_1'))).toEqual({
      root_story_1: 'partly',
      manuscript: 'shared',
      ch1: 'shared',
      ch2: 'hidden',
      notes: 'partly',
      note1: 'shared',
      note2: 'hidden',
      plan: 'hidden',
      empty: 'hidden',
      card: 'hidden',
      description: 'hidden',
      scenario: 'hidden',
    })
  })

  it('shares one with everything in it, and leaves the folders above as they are', () => {
    expect(sharedWith('notes', true, childrenOf, documentOf)).toEqual(
      new Map([
        ['notes', true],
        ['note1', true],
        ['note2', true],
      ])
    )
    expect(sharedWith('ch2', true, childrenOf, documentOf)).toEqual(new Map([['ch2', true]]))
    expect(sharedWith('manuscript', false, childrenOf, documentOf)).toEqual(
      new Map([
        ['manuscript', false],
        ['ch1', false],
        ['ch2', false],
      ])
    )
  })

  it('shares what a document holds with the document, and leaves the rest of what it holds', () => {
    expect(sharedWith('description', true, childrenOf, documentOf)).toEqual(
      new Map([
        ['description', true],
        ['card', true],
      ])
    )
    expect(sharedWith('description', false, childrenOf, documentOf)).toEqual(
      new Map([['description', false]])
    )
  })

  it('lays the project out as a tree from its root, into what a document holds', () => {
    const [root] = shareTree(/** @type {any} */ (ROWS[0]), childrenOf, document => document.title)
    expect(root.label).toBe('Thief')
    expect(root.children?.map(node => node.key)).toEqual([
      'manuscript',
      'notes',
      'plan',
      'empty',
      'card',
    ])
    expect(root.children?.[3].leaf).toBe(true)
    expect(root.children?.[4].children?.map(node => node.key)).toEqual(['description', 'scenario'])
  })
})
