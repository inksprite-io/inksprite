// @vitest-environment node
/* global Blob, File, btoa */
// Node's own Blob, which IndexedDB's structured clone keeps: happy-dom's comes
// back from fake-indexeddb as an empty object, and a file without its bytes.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import db from '@/stores/db.js'
import { useBackup } from '@/composables/useBackup.js'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { CHAT_PROFILE_ID } from '@/ai/profiles/index.js'

// A project exported and imported through the real database: what goes into
// the file, and what comes out of it beside what was there.

const STORY = 'story_V1StGXR8Z5jdHi6BmyT'
const OTHER = 'story_Kp3Wq8Zr1MxT5vLc9NbYe'
const ROOT = rootIdFor(STORY)
const CHAPTER = 'doc_q8L2nPw0xYtR3sVbKe7Zc'
const PDF = 'doc_Hn4Jw9pQz2LsXcV7bTm1R'
const CHAT = 'chat_Ua8sK1dFq3ZmW0pVyN6xT'
const PROFILE = 'chatprofile_Zx7Lm2Qw9RtY4bNc8VpKs'

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]

/** @param {string} id @param {string} storyId @param {string} parentId @param {object} rest */
const doc = (id, storyId, parentId, rest) => ({
  id,
  storyId,
  parentId,
  order: 0,
  summary: '',
  wordCount: 0,
  version: 1,
  created: 1,
  updated: 1,
  content: '',
  ...rest,
})

async function seed() {
  await db.stories.bulkAdd([
    {
      id: STORY,
      overview: '',
      wordCount: 2,
      lastDocumentId: CHAPTER,
      options: { profileId: PROFILE },
      version: 1,
      created: 1,
      updated: 5,
    },
    {
      id: OTHER,
      overview: '',
      wordCount: 0,
      lastDocumentId: null,
      options: {},
      version: 1,
      created: 1,
      updated: 1,
    },
  ])
  await db.documents.bulkAdd([
    doc(ROOT, STORY, STORY, { type: 'folder', title: 'The Salt Road' }),
    doc(CHAPTER, STORY, ROOT, {
      type: 'text',
      title: 'Chapter One',
      content: 'It rained.',
      wordCount: 2,
    }),
    doc(PDF, STORY, ROOT, { type: 'file', title: 'Map', mime: 'application/pdf' }),
    doc(rootIdFor(OTHER), OTHER, OTHER, { type: 'folder', title: 'Elsewhere' }),
  ])
  await db.files.add({
    id: PDF,
    storyId: STORY,
    blob: new Blob([new Uint8Array(PDF_BYTES)], { type: 'application/pdf' }),
  })
  await db.chats.bulkAdd([
    {
      id: CHAT,
      storyId: STORY,
      title: 'Plotting',
      titleSet: true,
      lastMessageAt: 3,
      profileId: PROFILE,
      pinnedIds: [CHAPTER],
      version: 1,
      created: 1,
      updated: 3,
    },
    {
      id: 'chat_Elsewhere000000000000',
      storyId: OTHER,
      title: 'Other',
      titleSet: true,
      lastMessageAt: 1,
      profileId: CHAT_PROFILE_ID,
      version: 1,
      created: 1,
      updated: 1,
    },
  ])
  await db.messages.bulkAdd([
    {
      id: 'message_Bq1Lp7Xz3Nw5Ty9Kc2Vm4',
      chatId: CHAT,
      role: 'user',
      content: 'Tighten chapter one.',
      version: 1,
      created: 2,
      updated: 2,
    },
    {
      id: 'message_Fh6Rj0Sd8Gw2Qa4Ez1Ub3',
      chatId: CHAT,
      role: 'assistant',
      content: 'Done.',
      metadata: {
        documentEdits: [
          {
            id: 'edit_1',
            documentId: CHAPTER,
            path: '/Chapter One',
            tool: 'edit_document',
            old: 'rained',
            new: 'poured',
          },
        ],
      },
      version: 1,
      created: 3,
      updated: 3,
    },
    {
      id: 'message_Elsewhere0000000000',
      chatId: 'chat_Elsewhere000000000000',
      role: 'user',
      content: 'Hi.',
      version: 1,
      created: 1,
      updated: 1,
    },
  ])
  await db.chatProfiles.add({
    id: PROFILE,
    name: 'Line editor',
    settings: { prompt: 'Cut.' },
    version: 1,
    created: 1,
    updated: 1,
  })
}

/**
 * A backup as it comes back from a file.
 * @param {import('@/utils/backup.js').Backup} backup
 */
const asFile = backup =>
  new File([JSON.stringify(backup)], 'project.json', { type: 'application/json' })

describe('project export and import', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await Promise.all(db.tables.map((/** @type {import('dexie').Table} */ table) => table.clear()))
    await seed()
  })

  it('exports the project, its chats, and the profile it runs on, and nothing else', async () => {
    const backup = await useBackup().createProjectBackup(STORY)

    expect(backup.scope).toBe('project')
    expect(backup.dbVersion).toBe(db.verno)
    expect(backup.tables.stories.map(row => row.id)).toEqual([STORY])
    expect(backup.tables.documents.map(row => row.id).sort()).toEqual([CHAPTER, PDF, ROOT].sort())
    expect(backup.tables.chats.map(row => row.id)).toEqual([CHAT])
    expect(backup.tables.messages.map(row => row.content)).toEqual([
      'Tighten chapter one.',
      'Done.',
    ])
    expect(backup.tables.chatProfiles.map(row => row.id)).toEqual([PROFILE])
    expect(backup.tables.files).toEqual([
      {
        id: PDF,
        storyId: STORY,
        mime: 'application/pdf',
        data: btoa(String.fromCharCode(...PDF_BYTES)),
      },
    ])
    expect(Object.keys(backup.tables).sort()).toEqual(
      ['chatProfiles', 'chats', 'documents', 'files', 'messages', 'stories'].sort()
    )
  })

  it('refuses a project that is not there', async () => {
    await expect(useBackup().createProjectBackup('story_missing')).rejects.toThrow('not found')
  })

  it('imports the file as a new project beside the one it came from', async () => {
    const backup = useBackup()
    const project = await backup.readProjectFile(asFile(await backup.createProjectBackup(STORY)))
    const story = await backup.importProject(project)

    expect(story.id).not.toBe(STORY)
    expect(await db.stories.count()).toBe(3)

    // The original is as it was.
    expect((await db.documents.where('storyId').equals(STORY).toArray()).length).toBe(3)
    expect((await db.chats.get(CHAT)).storyId).toBe(STORY)

    // The copy is whole, and points at itself.
    const documents = await db.documents.where('storyId').equals(story.id).toArray()
    const root = documents.find(row => row.id === rootIdFor(story.id))
    const chapter = documents.find(row => row.title === 'Chapter One')
    const pdf = documents.find(row => row.title === 'Map')
    expect(root.title).toBe('The Salt Road')
    expect(chapter.id).not.toBe(CHAPTER)
    expect(chapter.parentId).toBe(root.id)
    expect(chapter.content).toBe('It rained.')
    expect(story.lastDocumentId).toBe(chapter.id)

    const file = await db.files.get(pdf.id)
    expect(file.storyId).toBe(story.id)
    expect([...new Uint8Array(await file.blob.arrayBuffer())]).toEqual(PDF_BYTES)
    expect(file.blob.type).toBe('application/pdf')

    const [chat] = await db.chats.where('storyId').equals(story.id).toArray()
    expect(chat.id).not.toBe(CHAT)
    expect(chat.pinnedIds).toEqual([chapter.id])
    expect(chat.profileId).toBe(PROFILE)

    const messages = await db.messages.where('chatId').equals(chat.id).sortBy('created')
    expect(messages.map(row => row.content)).toEqual(['Tighten chapter one.', 'Done.'])
    expect(messages[1].metadata.documentEdits[0].documentId).toBe(chapter.id)
  })

  it('tells the stores about the project, so the list shows it by name', async () => {
    // Loaded before the import, as they are in the app by the time a writer
    // can pick a file: they will not go back to the database on their own.
    const storiesStore = useStoriesStore()
    await storiesStore.ensureInitialized()
    expect(storiesStore.getAllStories()).toHaveLength(2)

    const backup = useBackup()
    const story = await backup.importProject(
      await backup.readProjectFile(asFile(await backup.createProjectBackup(STORY)))
    )

    expect(storiesStore.getAllStories()).toHaveLength(3)
    expect(storiesStore.getStory(story.id)).toMatchObject({ id: story.id })
    expect(useDocumentsStore().getRoot(story.id)?.title).toBe('The Salt Road')
  })

  it('imports the same file twice without one overwriting the other', async () => {
    const backup = useBackup()
    const file = asFile(await backup.createProjectBackup(STORY))
    const first = await backup.importProject(await backup.readProjectFile(file))
    const second = await backup.importProject(await backup.readProjectFile(file))

    expect(second.id).not.toBe(first.id)
    expect(await db.stories.count()).toBe(4)
    expect(await db.chats.count()).toBe(4)
    expect(await db.messages.count()).toBe(7)
  })

  it('brings a profile this library does not have, under its own id', async () => {
    const backup = useBackup()
    const file = asFile(await backup.createProjectBackup(STORY))
    await db.chatProfiles.clear()

    await backup.importProject(await backup.readProjectFile(file))

    expect(useChatProfileStore().getProfile(PROFILE)).toMatchObject({
      name: 'Line editor',
      settings: { prompt: 'Cut.' },
    })
  })

  it('uses the profile this library has, as it stands', async () => {
    const backup = useBackup()
    const file = asFile(await backup.createProjectBackup(STORY))
    await db.chatProfiles.put({
      id: PROFILE,
      name: 'Line editor',
      settings: { prompt: 'Cut more.' },
      version: 2,
      created: 1,
      updated: 9,
    })

    await backup.importProject(await backup.readProjectFile(file))

    expect(useChatProfileStore().getProfile(PROFILE).settings.prompt).toBe('Cut more.')
  })

  it('sends a whole backup to the Data settings', async () => {
    const backup = useBackup()
    const file = asFile(await backup.createBackup())
    await expect(backup.readProjectFile(file)).rejects.toThrow('Restore it from the Data settings')
  })
})
