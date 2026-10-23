// @vitest-environment node
/* global Blob */
// Node's own Blob, which IndexedDB's structured clone keeps: happy-dom's comes
// back from fake-indexeddb as an empty object.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import db from '@/stores/db.js'
import { storage } from '@/storage/index.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

// Storage over the real schema, in fake-indexeddb.

const STORY = 'story_A'
const OTHER = 'story_B'

/** @param {string} id @param {string} storyId @param {object} [rest] */
const doc = (id, storyId, rest = {}) => ({
  id,
  storyId,
  parentId: storyId,
  order: 0,
  type: 'text',
  title: id,
  content: '',
  summary: '',
  wordCount: 0,
  version: 1,
  created: 1,
  updated: 1,
  ...rest,
})

/** @param {string} id @param {string} storyId @param {object} [rest] */
const chat = (id, storyId, rest = {}) => ({
  id,
  storyId,
  title: id,
  titleSet: true,
  lastMessageAt: null,
  version: 1,
  created: 1,
  updated: 1,
  ...rest,
})

/** @param {string} id @param {string} chatId @param {object} [rest] */
const message = (id, chatId, rest = {}) => ({
  id,
  chatId,
  role: 'user',
  content: id,
  created: 1,
  ...rest,
})

/** @param {string} id */
const story = id => ({
  id,
  overview: '',
  wordCount: 0,
  version: 1,
  created: 1,
  updated: 1,
})

describe('storage in IndexedDB', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((/** @type {import('dexie').Table} */ table) => table.clear()))
  })

  it('names the schema version the rows are in', () => {
    expect(storage.schemaVersion()).toBe(db.verno)
  })

  it('reads a project’s tree, and nothing of another’s', async () => {
    await db.documents.bulkPut([doc('a', STORY), doc('b', STORY), doc('c', OTHER)])

    const rows = await storage.documents(STORY)

    expect(rows.map(row => row.id).sort()).toEqual(['a', 'b'])
  })

  it('reads the roots there are, and passes over a project without one', async () => {
    await db.documents.bulkPut([doc(rootIdFor(STORY), STORY), doc('a', STORY)])

    const roots = await storage.roots([STORY, OTHER])

    expect(roots.map(row => row.id)).toEqual([rootIdFor(STORY)])
  })

  it('reads a project’s chats, one chat, and a chat’s messages', async () => {
    await db.chats.bulkPut([chat('one', STORY), chat('two', OTHER)])
    await db.messages.bulkPut([message('m1', 'one'), message('m2', 'two')])

    expect((await storage.chats(STORY)).map(row => row.id)).toEqual(['one'])
    expect((await storage.chat('two'))?.storyId).toBe(OTHER)
    expect(await storage.chat('none')).toBeUndefined()
    expect((await storage.messages('one')).map(row => row.id)).toEqual(['m1'])
  })

  it('keeps a file’s bytes and hands them back', async () => {
    await storage.putFileBytes('pdf', STORY, new Blob(['%PDF'], { type: 'application/pdf' }))

    const blob = await storage.fileBytes('pdf')

    expect(blob?.type).toBe('application/pdf')
    expect(await blob?.text()).toBe('%PDF')
    expect(await storage.fileBytes('none')).toBeNull()
    expect((await storage.projectFiles(STORY)).map(row => row.id)).toEqual(['pdf'])
    expect(await storage.projectFiles(OTHER)).toEqual([])
  })

  it('writes and removes rows of one table together', async () => {
    await db.chats.bulkPut([chat('gone', STORY), chat('kept', STORY)])

    await storage.write('chats', [
      { entityType: 'chats', id: 'gone', op: 'delete', data: null, timestamp: 1 },
      {
        entityType: 'chats',
        id: 'kept',
        op: 'put',
        data: chat('kept', STORY, { title: 'Renamed' }),
        timestamp: 1,
      },
      { entityType: 'chats', id: 'new', op: 'put', data: chat('new', STORY), timestamp: 1 },
    ])

    const rows = await db.chats.toArray()
    expect(rows.map(row => [row.id, row.title]).sort()).toEqual([
      ['kept', 'Renamed'],
      ['new', 'new'],
    ])
  })

  it('knows which tables there are', () => {
    expect(storage.has('documents')).toBe(true)
    expect(storage.has('jobs')).toBe(true)
    expect(storage.has('nothing')).toBe(false)
  })

  it('changes every row a change asks for, open or not, and counts them', async () => {
    await db.messages.bulkPut([
      message('a', 'one', { metadata: { context: [] } }),
      message('b', 'two', { metadata: { context: [] } }),
      message('c', 'two', { metadata: {} }),
    ])

    const changed = await storage.updateEach('messages', row =>
      row.metadata.context ? { metadata: {} } : null
    )

    expect(changed).toBe(2)
    const rows = await db.messages.toArray()
    expect(rows.every(row => row.metadata.context === undefined)).toBe(true)
  })

  it('adds a project’s rows together', async () => {
    await storage.addProject({
      story: story(STORY),
      documents: [doc(rootIdFor(STORY), STORY)],
      files: [{ id: 'pdf', storyId: STORY, blob: new Blob(['x']) }],
      chats: [chat('one', STORY)],
      messages: [message('m1', 'one')],
    })

    expect(await storage.story(STORY)).toMatchObject({ id: STORY })
    expect(await storage.documents(STORY)).toHaveLength(1)
    expect(await storage.fileBytes('pdf')).not.toBeNull()
    expect(await storage.messages('one')).toHaveLength(1)
  })

  it('adds none of a project when any of it cannot go in', async () => {
    await db.chats.put(chat('taken', OTHER))

    await expect(
      storage.addProject({
        story: story(STORY),
        documents: [doc(rootIdFor(STORY), STORY)],
        files: [],
        chats: [chat('taken', STORY)],
        messages: [],
      })
    ).rejects.toThrow()

    expect(await storage.story(STORY)).toBeUndefined()
    expect(await storage.documents(STORY)).toEqual([])
  })

  it('reads and writes the app’s own tables as tables', async () => {
    await storage.put('jobs', { id: 'j1', storyId: STORY, status: 'queued' })
    await storage.put('jobs', { id: 'j2', storyId: OTHER, status: 'queued' })
    await storage.put('chatProfiles', { id: 'p1', name: 'Mine' })

    expect((await storage.all('jobs')).map(row => row.id).sort()).toEqual(['j1', 'j2'])
    expect(await storage.count('jobs')).toBe(2)
    expect((await storage.ofStory('jobs', STORY)).map(row => row.id)).toEqual(['j1'])
    expect(await storage.get('chatProfiles', 'p1')).toMatchObject({ name: 'Mine' })
    expect((await storage.getMany('chatProfiles', ['p1', 'none'])).map(row => row.id)).toEqual([
      'p1',
    ])

    await storage.remove('jobs', ['j1', 'j2'])
    expect(await storage.all('jobs')).toEqual([])
    expect(await storage.count('jobs')).toBe(0)
  })

  it('dumps every table, empty ones too, but the linked documents’ bases and sync’s own', async () => {
    await db.stories.put(story(STORY))

    const tables = await storage.dump()

    expect(Object.keys(tables).sort()).toEqual(
      db.tables
        .map(table => table.name)
        .filter(name => name !== 'docBases' && !name.startsWith('cloud'))
        .sort()
    )
    expect(tables.stories).toHaveLength(1)
    expect(tables.messages).toEqual([])
  })

  it('keeps a linked document’s base, and lets it go with its document or its project', async () => {
    const base = id => ({
      id,
      storyId: STORY,
      docId: 'doc_1',
      tabId: 't.0',
      revisionId: 'rev_1',
      markdown: 'Rain came.',
      at: 1,
    })
    await storage.writeBase(base('a'))
    await storage.writeBase(base('b'))
    await storage.writeBase(base('c'))
    expect(await storage.readBase(STORY, 'a')).toEqual(base('a'))
    expect(await storage.readBase(STORY, 'none')).toBeNull()

    await storage.removeBase(STORY, 'a')
    expect(await storage.readBase(STORY, 'a')).toBeNull()

    await db.documents.bulkPut([doc('b', STORY), doc('c', STORY)])
    await storage.write('documents', [{ op: 'delete', id: 'b' }])
    expect(await storage.readBase(STORY, 'b')).toBeNull()
    expect(await storage.readBase(STORY, 'c')).toEqual(base('c'))

    await storage.removeProject(STORY)
    expect(await storage.readBase(STORY, 'c')).toBeNull()
  })

  it('replaces every table with a backup’s rows, emptying those it leaves out', async () => {
    await db.stories.put(story(OTHER))
    await db.jobs.put({ id: 'j1', storyId: OTHER, status: 'queued' })

    const restored = await storage.replaceAll({
      stories: [story(STORY)],
      documents: [doc('a', STORY), doc('b', STORY)],
    })

    expect(restored).toBe(3)
    expect((await db.stories.toArray()).map(row => row.id)).toEqual([STORY])
    expect(await db.jobs.toArray()).toEqual([])
    // A restored document has no base: its next sync is a first sync.
    expect(await db.docBases.toArray()).toEqual([])
  })
})
