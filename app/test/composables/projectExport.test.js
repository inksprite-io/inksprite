// @vitest-environment node
/* global Blob, File */
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
import { buildBackup, serializeFiles } from '@/utils/backup.js'

// A project taken out of a backup and added beside the others through the
// real database: what of it is offered, and what comes in beside what was
// there. And the files of one project, or of a selection, that the app made
// until 26 Oct 2026, which still come in.

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
      options: { profileId: PROFILE },
      version: 1,
      created: 1,
      updated: 5,
    },
    {
      id: OTHER,
      overview: '',
      wordCount: 0,
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

/**
 * A file of the project's rows, as the app wrote a project file, or a
 * selection, until 26 Oct 2026: its documents, those named or every one, its
 * files' bytes, and its chats and their profile unless left out.
 *
 * @param {{scope?: 'project'|'selection', documentIds?: string[], chats?: boolean}} [options]
 */
async function savedBefore({ scope = 'project', documentIds, chats = true } = {}) {
  const documents = (await db.documents.where('storyId').equals(STORY).toArray()).filter(
    row => !documentIds || documentIds.includes(row.id)
  )
  const kept = new Set(documents.map(row => row.id))
  const files = (await db.files.where('storyId').equals(STORY).toArray()).filter(row =>
    kept.has(row.id)
  )
  const chatRows = chats ? await db.chats.where('storyId').equals(STORY).toArray() : []
  const chatIds = new Set(chatRows.map(row => row.id))
  return buildBackup(
    {
      stories: [await db.stories.get(STORY)],
      documents,
      files: await serializeFiles(files),
      chats: chatRows,
      messages: (await db.messages.toArray()).filter(row => chatIds.has(row.chatId)),
      chatProfiles: chats ? [await db.chatProfiles.get(PROFILE)] : [],
    },
    { dbVersion: db.verno, scope }
  )
}

/** The project as a whole backup of everything here offers it to be added. */
async function fromBackup(storyId = STORY) {
  const backup = useBackup()
  const read = await backup.readDataFile(asFile(await backup.createBackup()))
  expect(read.kind).toBe('backup')
  return read.addable.projects.find(project => project.story.id === storyId)
}

describe('a project added from a backup', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await Promise.all(db.tables.map((/** @type {import('dexie').Table} */ table) => table.clear()))
    await seed()
  })

  it('is offered with its chats, its files and the profile it runs on, without its trash', async () => {
    await db.documents.add(
      doc('doc_Gone000000000000000000', STORY, ROOT, { type: 'text', title: 'Cut', trashed: 9 })
    )
    await db.chats.add({
      id: 'chat_Gone0000000000000000',
      storyId: STORY,
      title: 'Old',
      titleSet: true,
      trashed: 9,
      version: 1,
      created: 1,
      updated: 1,
    })
    await db.stories.update(OTHER, { trashed: 9 })

    const project = await fromBackup()

    expect(project.documents.map(row => row.id).sort()).toEqual([CHAPTER, PDF, ROOT].sort())
    expect(project.chats.map(row => row.id)).toEqual([CHAT])
    expect(project.messages.map(row => row.content)).toEqual(['Tighten chapter one.', 'Done.'])
    expect(project.profiles.map(row => row.id)).toEqual([PROFILE])
    expect(project.files.map(row => row.id)).toEqual([PDF])
    // A project that was in the trash itself isn't offered.
    expect(await fromBackup(OTHER)).toBeUndefined()
  })

  it('comes in as a new project beside the one it came from', async () => {
    const story = await useBackup().importProject(await fromBackup())

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

  it('is numbered when its name is taken, and tells the stores, so the list shows it', async () => {
    // Loaded before, as they are in the app by the time a writer can pick a
    // file: they will not go back to the database on their own.
    const storiesStore = useStoriesStore()
    await storiesStore.ensureInitialized()
    expect(storiesStore.getAllStories()).toHaveLength(2)

    const done = await useBackup().addFromBackup({
      projects: [await fromBackup()],
      cards: { rows: [], files: [] },
    })

    expect(done).toEqual({ projects: ['The Salt Road (2)'], cards: [] })
    expect(storiesStore.getAllStories()).toHaveLength(3)
    const added = storiesStore.getAllStories().find(story => ![STORY, OTHER].includes(story.id))
    expect(useDocumentsStore().getRoot(added.id)?.title).toBe('The Salt Road (2)')
    expect((await db.documents.get(rootIdFor(added.id)))?.title).toBe('The Salt Road (2)')
  })

  it('comes in twice without one overwriting the other', async () => {
    const backup = useBackup()
    const project = await fromBackup()
    const first = await backup.importProject(project)
    const second = await backup.importProject(project)

    expect(second.id).not.toBe(first.id)
    expect(await db.stories.count()).toBe(4)
    expect(await db.chats.count()).toBe(4)
    expect(await db.messages.count()).toBe(7)
  })

  it('brings a profile this library does not have, under its own id', async () => {
    const project = await fromBackup()
    await db.chatProfiles.clear()

    await useBackup().importProject(project)

    expect(useChatProfileStore().getProfile(PROFILE)).toMatchObject({
      name: 'Line editor',
      settings: { prompt: 'Cut.' },
    })
  })

  it('uses the profile this library has, as it stands', async () => {
    const project = await fromBackup()
    await db.chatProfiles.put({
      id: PROFILE,
      name: 'Line editor',
      settings: { prompt: 'Cut more.' },
      version: 2,
      created: 1,
      updated: 9,
    })

    await useBackup().importProject(project)

    expect(useChatProfileStore().getProfile(PROFILE).settings.prompt).toBe('Cut more.')
  })
})

describe('a project file made before', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await Promise.all(db.tables.map((/** @type {import('dexie').Table} */ table) => table.clear()))
    await seed()
  })

  it('comes in as a new project from Import project…', async () => {
    const backup = useBackup()
    const story = await backup.importProject(
      await backup.readProjectFile(asFile(await savedBefore()))
    )

    expect(story.id).not.toBe(STORY)
    const documents = await db.documents.where('storyId').equals(story.id).toArray()
    expect(documents.map(row => row.title).sort()).toEqual(['Chapter One', 'Map', 'The Salt Road'])
    expect(await db.chats.where('storyId').equals(story.id).count()).toBe(1)
  })

  it('sends a whole backup to Import in the settings', async () => {
    const backup = useBackup()
    const file = asFile(await backup.createBackup())
    await expect(backup.readProjectFile(file)).rejects.toThrow(
      'Restore it with Import in Settings › Sync and sharing › Backup'
    )
  })

  it('is taken as a selection of one project by Import in the settings', async () => {
    const read = await useBackup().readDataFile(asFile(await savedBefore()))
    expect(read.kind).toBe('selection')
    expect(read.selection.projects.map(project => project.story.id)).toEqual([STORY])
  })
})

describe('a selection made before', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await Promise.all(db.tables.map((/** @type {import('dexie').Table} */ table) => table.clear()))
    await seed()
  })

  it('adds its project beside the one it came from, numbered, with only what was in it', async () => {
    const file = await savedBefore({
      scope: 'selection',
      documentIds: [ROOT, CHAPTER],
      chats: false,
    })
    await useStoriesStore().loadNames()
    const read = await useBackup().readDataFile(asFile(file))
    expect(read.kind).toBe('selection')

    const done = await useBackup().importSelection(read.selection)

    expect(done).toEqual({ projects: ['The Salt Road (2)'], cards: [], settingsChanged: false })
    const stories = await db.stories.toArray()
    expect(stories).toHaveLength(3)
    const added = stories.find(story => ![STORY, OTHER].includes(story.id))
    const documents = await db.documents.where('storyId').equals(added.id).toArray()
    expect(documents.map(row => row.title).sort()).toEqual(['Chapter One', 'The Salt Road (2)'])
    // The project it came from is as it was.
    expect(await db.documents.where('storyId').equals(STORY).count()).toBe(3)
  })
})
