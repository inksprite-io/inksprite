import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { appLocal } from '@/cloud/local.js'

/** A project's rows, as storage would hand them over. */
const rows = vi.hoisted(() => ({ documents: /** @type {any[]} */ ([]) }))
/** What was written straight to storage, by table. */
const written = vi.hoisted(() => /** @type {Array<[string, any[]]>} */ ([]))
vi.mock('@/storage/index.js', () => ({
  storage: {
    stories: async () => [],
    story: async (/** @type {string} */ id) => ({ id }),
    documents: async () => rows.documents,
    chats: async () => [],
    messages: async () => [],
    ofStory: async () => [],
    write: async (/** @type {string} */ table, /** @type {any[]} */ changes) => {
      written.push([table, changes])
    },
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
  beforeEach(() => {
    setActivePinia(createPinia())
    written.length = 0
  })

  describe('write', () => {
    it('writes a project only its own rows, of a project’s tables', async () => {
      const local = appLocal({ syncsForApp: () => true })

      await local.write('story_1', [
        { table: 'files', id: 'doc_pdf', row: { id: 'doc_pdf', storyId: 'story_1' } },
        { table: 'files', id: 'doc_other', row: { id: 'doc_other', storyId: 'story_2' } },
        { table: 'mcpServers', id: 'mcp_1', row: { id: 'mcp_1', allowAll: true } },
        { table: 'aiProviders', id: 'conn_1', row: null },
        { table: 'cloudState', id: 'account', row: { id: 'account' } },
      ])

      expect(written.map(([table, changes]) => [table, changes.map(change => change.id)])).toEqual([
        ['files', ['doc_pdf']],
      ])
    })

    it('writes the setup only rows of the setup’s tables', async () => {
      const local = appLocal({ syncsForApp: () => true })

      await local.write('setup', [
        { table: 'skills', id: 'skill_1', row: { id: 'skill_1' } },
        { table: 'documents', id: 'doc_1', row: { id: 'doc_1', storyId: 'story_1' } },
        { table: 'cloudState', id: 'account', row: { id: 'account' } },
      ])

      expect(written.map(([table]) => table)).toEqual(['skills'])
    })
  })

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
