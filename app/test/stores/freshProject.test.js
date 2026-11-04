/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// What reaches storage, by table.
const written = vi.hoisted(() => ({ rows: /** @type {Record<string, any[]>} */ ({}) }))
vi.mock('@/storage/index.js', () => ({
  storage: {
    has: () => true,
    stories: async () => [],
    story: async () => null,
    documents: async () => [],
    async write(/** @type {string} */ table, /** @type {any[]} */ changes) {
      ;(written.rows[table] ??= []).push(...changes)
    },
    putFileBytes: vi.fn(async () => {}),
  },
}))

import { useStoriesStore, UNTITLED_PROJECT } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useSyncStore } from '@/stores/syncStore'
import { useFilesStore } from '@/stores/filesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/** The ids written to a table. @param {string} table */
const ids = table => (written.rows[table] ?? []).map(change => change.id)

describe('a project not saved yet', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    written.rows = {}
  })

  it('is open under Untitled project, out of the lists, and saves nothing while untouched', async () => {
    const stories = useStoriesStore()
    const documents = useDocumentsStore()
    const story = await stories.createFresh()
    expect((await stories.createFresh()).id).toBe(story.id)
    expect(stories.getStory(story.id)?.id).toBe(story.id)
    expect(stories.isFresh(story.id)).toBe(true)
    expect(stories.getAllStories()).toEqual([])
    expect(documents.getRoot(story.id)?.title).toBe(UNTITLED_PROJECT)

    await useSyncStore().processSync()
    expect(written.rows).toEqual({})
  })

  it('is saved, into the lists, once a document is made in it', async () => {
    const stories = useStoriesStore()
    const documents = useDocumentsStore()
    const story = await stories.createFresh()
    documents.createDocument({
      storyId: story.id,
      parentId: rootIdFor(story.id),
      type: 'text',
      title: 'Prologue',
    })
    expect(stories.isFresh(story.id)).toBe(false)
    expect(stories.getAllStories().map(row => row.id)).toEqual([story.id])

    await useSyncStore().processSync()
    expect(ids('stories')).toEqual([story.id])
    expect(ids('documents')).toContain(rootIdFor(story.id))
    expect(ids('documents')).toHaveLength(2)
  })

  it('is saved under the settings given it', async () => {
    const stories = useStoriesStore()
    const story = await stories.createFresh()
    await stories.updateStory(story.id, { overview: 'A heist.' })
    expect(stories.isFresh(story.id)).toBe(false)
    expect(stories.getStory(story.id)?.overview).toBe('A heist.')
    await useSyncStore().processSync()
    expect(written.rows.stories.at(-1).data.overview).toBe('A heist.')
  })

  it('is saved before a file’s bytes go into it', async () => {
    const stories = useStoriesStore()
    const story = await stories.createFresh()
    await useFilesStore().putFile('doc_file', story.id, new Blob(['a rulebook']))
    expect(ids('stories')).toEqual([story.id])
  })

  it('is let go of, and nothing of it saved, when left untouched', async () => {
    const stories = useStoriesStore()
    const documents = useDocumentsStore()
    const story = await stories.createFresh()
    stories.dropFresh()
    expect(stories.getStory(story.id)).toBeNull()
    expect(documents.getRoot(story.id)).toBeFalsy()
    await useSyncStore().processSync()
    expect(written.rows).toEqual({})

    // The next is another.
    expect((await stories.createFresh()).id).not.toBe(story.id)
  })

  it('takes a name no other project has', async () => {
    const stories = useStoriesStore()
    const documents = useDocumentsStore()
    const taken = await stories.createStory(UNTITLED_PROJECT)
    expect(documents.getRoot(taken.id)?.title).toBe(UNTITLED_PROJECT)
    const story = await stories.createFresh()
    expect(documents.getRoot(story.id)?.title).toBe(`${UNTITLED_PROJECT} (2)`)
  })
})
