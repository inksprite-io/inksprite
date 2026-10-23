import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { appLocal } from '@/cloud/local.js'

/** A project's rows, as storage would hand them over. */
const rows = vi.hoisted(() => ({ documents: /** @type {any[]} */ ([]) }))
vi.mock('@/storage/index.js', () => ({
  storage: {
    stories: async () => [],
    story: async (/** @type {string} */ id) => ({ id }),
    documents: async () => rows.documents,
    chats: async () => [],
    messages: async () => [],
    ofStory: async () => [],
  },
}))

/**
 * @param {string} id
 * @param {string} parentId
 * @param {Record<string, any>} [fields]
 */
const doc = (id, parentId, fields = {}) => ({
  id,
  storyId: 'story_1',
  parentId,
  type: 'text',
  title: id,
  content: '',
  ...fields,
})

describe('cloud/local', () => {
  beforeEach(() => setActivePinia(createPinia()))

  describe('readProject', () => {
    it('lists the bytes of files and pictures, and none for a repository’s source files', async () => {
      rows.documents = [
        doc('root_story_1', 'story_1', { type: 'folder' }),
        doc('doc_pdf', 'root_story_1', { type: 'file', mime: 'application/pdf' }),
        doc('doc_ch1', 'root_story_1', { pictures: { 'map.png': { mime: 'image/png' } } }),
        doc('doc_repo', 'root_story_1', { type: 'folder', kind: 'repository' }),
        doc('doc_src', 'doc_repo', { type: 'folder' }),
        doc('doc_main', 'doc_src', { type: 'file', content: 'export const answer = 42\n' }),
      ]

      const project = await appLocal({ syncsForApp: () => true }).readProject('story_1')

      expect(project?.files).toEqual([
        { id: 'doc_pdf', storyId: 'story_1' },
        { id: 'doc_ch1/map.png', storyId: 'story_1' },
      ])
    })
  })
})
