// @vitest-environment node
/* global Blob, Buffer */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CloudError, createApi } from '@/cloud/api.js'
import { signIn, signUp } from '@/cloud/account.js'
import { PART_SIZE, SETTLE_MS } from '@/cloud/engine.js'
import { CLASHED } from '@/utils/versions.js'
import { makeDevice } from './device.js'
import { createDiagnostics } from '@/cloud/diagnostics.js'

const FAST = { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 }

// The sync server is kept in the development repository only, and these run
// against it; without it they are skipped.
const SERVER_SOURCE = fileURLToPath(new URL('../../../server/src/', import.meta.url))
const HAVE_SERVER = existsSync(SERVER_SOURCE)

/** @param {string} name */
const serverModule = name => import(/* @vite-ignore */ join(SERVER_SOURCE, name))

/** @type {string} */
let server
/** @type {() => Promise<void>} */
let close
/** @type {string} */
let folder
/** The server's store, to set an account's quota. @type {any} */
let serverStore
let accounts = 0

beforeAll(async () => {
  if (!HAVE_SERVER) return
  const { openStore } = await serverModule('store.js')
  const { openBlobs } = await serverModule('blobs.js')
  const { startServer } = await serverModule('app.js')
  folder = await mkdtemp(join(tmpdir(), 'inksprite-cloud-'))
  serverStore = openStore(':memory:')
  const running = await startServer({
    port: 0,
    host: '127.0.0.1',
    store: serverStore,
    blobs: openBlobs(folder),
    signupCode: 'code',
  })
  const address = /** @type {import('node:net').AddressInfo} */ (running.server.address())
  server = `http://127.0.0.1:${address.port}`
  close = running.close
})

afterAll(async () => {
  if (!HAVE_SERVER) return
  await close()
  await rm(folder, { recursive: true, force: true })
})

/**
 * An account, and two devices signed in to it.
 * @param {{schema?: number, now?: () => number, at?: string, diagnostics?: import('@/cloud/diagnostics.js').Diagnostics}} [options]
 */
async function twoDevices({ schema, now, at = server, diagnostics } = {}) {
  const name = `writer${++accounts}`
  const made = await signUp(createApi(at), {
    name,
    passphrase: 'a long passphrase',
    code: 'code',
    kdf: FAST,
  })
  const other = await signIn(createApi(at), { name, passphrase: 'a long passphrase' })
  return {
    name,
    a: makeDevice({ api: createApi(at, made.token), keys: made.keys, now, diagnostics }),
    b: makeDevice({ api: createApi(at, other.token), keys: other.keys, schema, now }),
    /** A third device, signed in later. */
    async c() {
      const signedIn = await signIn(createApi(at), { name, passphrase: 'a long passphrase' })
      return makeDevice({ api: createApi(at, signedIn.token), keys: signedIn.keys })
    },
  }
}

/**
 * A small project: a story, a root, a chapter, a chat with a message.
 * @param {ReturnType<typeof makeDevice>} device
 */
function writeProject(device, storyId = 'story_1') {
  const t = 1000
  device.put('stories', { id: storyId, wordCount: 0, version: 1, created: t, updated: t })
  device.put('documents', {
    id: `root_${storyId}`,
    storyId,
    parentId: storyId,
    type: 'folder',
    title: 'Thief',
    content: '',
    summary: '',
    order: 0,
    wordCount: 0,
    version: 1,
    created: t,
    updated: t,
  })
  device.put('documents', {
    id: 'doc_ch1',
    storyId,
    parentId: `root_${storyId}`,
    type: 'text',
    title: 'Chapter 1',
    content: 'The gate was locked.\n\nShe climbed the wall.\n\nNobody saw her.\n',
    summary: '',
    order: 0,
    wordCount: 12,
    version: 1,
    created: t,
    updated: t,
  })
  device.put('chats', {
    id: 'chat_1',
    storyId,
    title: 'Ideas',
    titleSet: true,
    lastMessageAt: t,
    version: 1,
    created: t,
    updated: t,
  })
  device.put('messages', {
    id: 'msg_1',
    chatId: 'chat_1',
    role: 'user',
    content: 'How does she get in?',
    version: 1,
    created: t,
    updated: t,
  })
}

/**
 * A row to write into one of the engine's own tables.
 * @param {string} table
 * @param {any} data
 */
const put = (table, data) => ({ entityType: table, id: data.id, op: 'put', data, timestamp: 0 })

/** @param {ReturnType<typeof makeDevice>} device */
const settled = async device => {
  await device.engine.noted()
}

describe.skipIf(!HAVE_SERVER)('sync between two devices', () => {
  it('brings a project made on one device to the other, and sends nothing back', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    expect(await a.waiting()).toEqual([])

    await b.sync()
    await settled(b)
    expect(b.db.stories.get('story_1')).toBeDefined()
    expect(b.db.documents.get('doc_ch1').content).toContain('She climbed the wall.')
    expect(b.db.messages.get('msg_1').content).toBe('How does she get in?')
    expect(await b.waiting()).toEqual([])
  })

  it('carries an edit back the other way, and merges edits to different paragraphs', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    const chapter = a.db.documents.get('doc_ch1')
    a.put('documents', {
      ...chapter,
      content: chapter.content.replace('The gate was locked.', 'The iron gate was locked.'),
      updated: 2000,
    })
    b.put('documents', {
      ...chapter,
      content: chapter.content.replace('Nobody saw her.', 'Nobody saw her go.'),
      updated: 2100,
    })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await a.sync()

    const expected = 'The iron gate was locked.\n\nShe climbed the wall.\n\nNobody saw her go.\n'
    expect(a.db.documents.get('doc_ch1').content).toBe(expected)
    expect(b.db.documents.get('doc_ch1').content).toBe(expected)
    expect(await a.waiting()).toEqual([])
    expect(await b.waiting()).toEqual([])
  })

  it('keeps the other side’s words as a named version when both changed the same words', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    const chapter = a.db.documents.get('doc_ch1')
    a.put('documents', {
      ...chapter,
      content: chapter.content.replace('climbed', 'scaled'),
      updated: 2000,
    })
    b.put('documents', {
      ...chapter,
      content: chapter.content.replace('climbed', 'vaulted'),
      updated: 2100,
    })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await settled(b)
    await b.sync()
    await a.sync()

    // b met a's version as a conflict: b's words stand, a's are kept as a version.
    expect(b.db.documents.get('doc_ch1').content).toContain('vaulted')
    expect(a.db.documents.get('doc_ch1').content).toContain('vaulted')
    for (const device of [a, b]) {
      const kept = [...device.db.versions.values()].filter(row => row.name === CLASHED)
      expect(kept).toHaveLength(1)
      expect(kept[0]).toMatchObject({ documentId: 'doc_ch1', clash: 'small' })
      expect(kept[0].content).toContain('scaled')
      expect([...device.db.documents.values()].some(row => row.title.includes('(conflict)'))).toBe(
        false
      )
    }
  })

  it('keeps the later device’s text whole when much of it clashed, the other kept as a version', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    const chapter = a.db.documents.get('doc_ch1')
    // Every paragraph rewritten on each, as after a long time offline.
    a.put('documents', {
      ...chapter,
      content: 'The gate stood open.\n\nShe walked in.\n\nThe guard waved.\n',
      updated: 2000,
    })
    b.put('documents', {
      ...chapter,
      content: 'The gate was chained.\n\nShe dug under.\n\nThe dogs slept.\n',
      updated: 2100,
    })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await settled(b)
    await b.sync()
    await a.sync()

    const later = 'The gate was chained.\n\nShe dug under.\n\nThe dogs slept.\n'
    expect(a.db.documents.get('doc_ch1').content).toBe(later)
    expect(b.db.documents.get('doc_ch1').content).toBe(later)
    const kept = [...a.db.versions.values()].find(row => row.name === CLASHED)
    expect(kept).toMatchObject({
      clash: 'large',
      content: 'The gate stood open.\n\nShe walked in.\n\nThe guard waved.\n',
    })
  })

  it('removes a document removed on the other device', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    a.remove('documents', 'doc_ch1')
    await settled(a)
    await a.sync()
    await b.sync()
    expect(b.db.documents.has('doc_ch1')).toBe(false)
    await settled(b)
    expect(await b.waiting()).toEqual([])
  })

  it('brings back a document edited on one device and removed on the other', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    a.remove('documents', 'doc_ch1')
    const chapter = b.db.documents.get('doc_ch1')
    b.put('documents', { ...chapter, title: 'Chapter One', updated: 3000 })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await a.sync()
    // In the trash on both: nothing written is lost, and nothing deleted
    // comes back into the tree.
    expect(b.db.documents.get('doc_ch1').title).toBe('Chapter One')
    expect(a.db.documents.get('doc_ch1').title).toBe('Chapter One')
    expect(b.db.documents.get('doc_ch1').trashed).toBeTypeOf('number')
    expect(a.db.documents.get('doc_ch1').trashed).toBeTypeOf('number')
  })

  it('brings back into the trash a document edited here and removed there', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    a.remove('documents', 'doc_ch1')
    await settled(a)
    await a.sync()
    const chapter = b.db.documents.get('doc_ch1')
    b.put('documents', { ...chapter, title: 'Chapter One', updated: 3000 })
    await settled(b)
    await b.sync()
    await a.sync()

    expect(b.db.documents.get('doc_ch1')).toMatchObject({ title: 'Chapter One' })
    expect(b.db.documents.get('doc_ch1').trashed).toBeTypeOf('number')
    expect(a.db.documents.get('doc_ch1')).toMatchObject({ title: 'Chapter One' })
    expect(a.db.documents.get('doc_ch1').trashed).toBeTypeOf('number')
    await b.sync()
    expect(await b.waiting()).toEqual([])
  })

  it('carries a document to the trash on the other device, and back', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    const chapter = a.db.documents.get('doc_ch1')
    a.put('documents', { ...chapter, trashed: 5000 })
    await settled(a)
    await a.sync()
    await b.sync()
    expect(b.db.documents.get('doc_ch1').trashed).toBe(5000)

    const { trashed, ...restored } = b.db.documents.get('doc_ch1')
    b.put('documents', restored)
    await settled(b)
    await b.sync()
    await a.sync()
    expect(trashed).toBe(5000)
    expect('trashed' in a.db.documents.get('doc_ch1')).toBe(false)
  })

  it('takes a project away on the other device once it is deleted', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    await a.removeProject('story_1')
    await settled(a)
    await a.sync()
    await b.sync()
    await settled(b)
    expect(b.db.stories.has('story_1')).toBe(false)
    expect(b.db.documents.has('doc_ch1')).toBe(false)
    await b.sync()
    expect(await b.waiting()).toEqual([])
  })

  it('keeps a project deleted on one device that the other edited meanwhile', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    await a.removeProject('story_1')
    const chapter = b.db.documents.get('doc_ch1')
    b.put('documents', { ...chapter, content: `${chapter.content}\nShe was in.\n`, updated: 4000 })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await b.sync()
    await a.sync()

    // Kept, in the trash on both.
    expect(b.db.documents.get('doc_ch1').content).toContain('She was in.')
    expect(b.db.stories.get('story_1').trashed).toBeTypeOf('number')
    expect(a.db.stories.get('story_1').trashed).toBeTypeOf('number')
    expect(a.db.documents.get('doc_ch1').content).toContain('She was in.')
    expect(a.db.messages.get('msg_1')).toBeDefined()
  })

  it('carries a document’s versions to the other device, and their deletes', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    const version = {
      id: 'ver_1',
      storyId: 'story_1',
      documentId: 'doc_ch1',
      at: 2000,
      title: 'Chapter 1',
      content: 'The gate was locked.',
      words: 4,
      name: 'First draft',
    }
    a.put('versions', version)
    await settled(a)
    await a.sync()
    await b.sync()
    expect(b.db.versions.get('ver_1')).toEqual(version)

    b.remove('versions', 'ver_1')
    await settled(b)
    await b.sync()
    await a.sync()
    expect(a.db.versions.has('ver_1')).toBe(false)
  })

  it('carries a file’s bytes in parts, which the other device fetches when it wants them', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    const bytes = new Uint8Array(PART_SIZE + 1234).map((_, i) => i % 251)
    await a.putFile('doc_file', 'story_1', new Blob([bytes], { type: 'application/pdf' }))
    await settled(a)
    await a.sync()
    expect(await a.waiting()).toEqual([])

    await b.sync()
    expect(b.db.files.has('doc_file')).toBe(false)
    expect(await b.engine.hasFile('doc_file')).toBe(true)

    /** @type {Array<[number, number]>} */
    const told = []
    const [blob, again] = await Promise.all([
      b.engine.fetchFile('doc_file', (done, total) => told.push([done, total])),
      b.engine.fetchFile('doc_file'),
    ])
    expect(again).toBe(blob)
    expect(told).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
    const got = b.db.files.get('doc_file')
    expect(got.blob.type).toBe('application/pdf')
    expect(Buffer.from(await got.blob.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true)
    expect(await b.engine.hasFile('doc_file')).toBe(false)
    expect(await b.engine.fetchFile('doc_file')).toBeNull()
    await settled(b)
    await b.sync()
    expect(await b.waiting()).toEqual([])
  })

  it('brings a picture with its document, and every file a backup wants', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    const picture = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await a.putFile('doc_ch1/map.png', 'story_1', picture)
    await a.putFile('doc_file', 'story_1', new Blob(['a rulebook'], { type: 'application/pdf' }))
    await settled(a)
    await a.sync()

    await b.sync()
    expect(b.db.files.has('doc_ch1/map.png')).toBe(true)
    expect(b.db.files.has('doc_file')).toBe(false)
    expect(await b.engine.fetchProjectFiles(['story_2'])).toBe(0)
    expect(b.db.files.has('doc_file')).toBe(false)
    expect(await b.engine.fetchProjectFiles(['story_1'])).toBe(0)
    expect(await b.db.files.get('doc_file').blob.text()).toBe('a rulebook')
  })

  it('forgets a file still to fetch once it is removed', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await a.putFile('doc_file', 'story_1', new Blob(['a rulebook'], { type: 'application/pdf' }))
    await settled(a)
    await a.sync()
    await b.sync()
    expect(await b.engine.hasFile('doc_file')).toBe(true)

    a.remove('files', 'doc_file')
    await settled(a)
    await a.sync()
    await b.sync()
    expect(await b.engine.hasFile('doc_file')).toBe(false)
  })

  it('holds back a reply still being written', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    a.put('messages', {
      id: 'msg_2',
      chatId: 'chat_1',
      role: 'assistant',
      content: 'She could',
      streamingStartTime: Date.now(),
      streamingFinishTime: null,
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    })
    await settled(a)
    await a.sync()
    expect(await a.waiting()).toEqual(['messages:msg_2'])
    await b.sync()
    expect(b.db.messages.has('msg_2')).toBe(false)

    a.put('messages', {
      ...a.db.messages.get('msg_2'),
      content: 'She could climb.',
      streamingFinishTime: Date.now(),
    })
    await settled(a)
    await a.sync()
    await b.sync()
    expect(b.db.messages.get('msg_2').content).toBe('She could climb.')
  })

  it('merges a project both devices had before either synced', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    writeProject(b)
    const chapter = b.db.documents.get('doc_ch1')
    b.put('documents', { ...chapter, content: 'Another draft entirely.\n', updated: 9000 })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await a.sync()

    expect(b.db.documents.get('doc_ch1').content).toBe('Another draft entirely.\n')
    const kept = [...b.db.versions.values()].find(row => row.name === CLASHED)
    expect(kept.clash).toBe('large')
    expect(kept.content).toContain('She climbed the wall.')
    expect(a.db.documents.get('doc_ch1').content).toBe('Another draft entirely.\n')
  })
})

describe.skipIf(!HAVE_SERVER)('a newer app’s records', () => {
  it('hold an older device’s pull of a new project until it is updated', async () => {
    const { a, b } = await twoDevices({ schema: 31 })
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()
    expect(b.db.stories.has('story_1')).toBe(false)
    expect(b.engine.status).toMatchObject({ phase: 'held', error: null })

    b.update({ schema: 32 })
    await b.sync()
    expect(b.db.documents.get('doc_ch1').content).toContain('She climbed the wall.')
    expect(b.engine.status.phase).toBe('idle')
  })

  it('of a newer format hold the pull, while the older device’s own edits still go', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    a.update({ format: 3 })
    const chapter = a.db.documents.get('doc_ch1')
    a.put('documents', {
      ...chapter,
      content: chapter.content.replace('The gate was locked.', 'The iron gate was locked.'),
      updated: 2000,
    })
    await settled(a)
    await a.sync()

    const theirs = b.db.documents.get('doc_ch1')
    b.put('documents', {
      ...theirs,
      content: theirs.content.replace('Nobody saw her.', 'Nobody saw her go.'),
      updated: 3000,
    })
    b.put('chats', { ...b.db.chats.get('chat_1'), title: 'Ways in', updated: 3000 })
    await settled(b)
    await b.sync()

    expect(b.engine.status).toMatchObject({ phase: 'held', waiting: 1, error: null })
    expect(b.db.documents.get('doc_ch1').content).toContain('The gate was locked.')
    expect(await b.waiting()).toEqual(['documents:doc_ch1'])
    await a.sync()
    expect(a.db.chats.get('chat_1').title).toBe('Ways in')
    expect(a.db.documents.get('doc_ch1').content).toContain('Nobody saw her.\n')

    // Not sent again while it waits.
    /** @type {string[]} */
    const sent = []
    const push = b.api.push
    b.api.push = (id, schema, records) => {
      sent.push(...records.map(record => record.name))
      return push(id, schema, records)
    }
    await b.sync()
    expect(sent).toEqual([])

    b.update({ format: 3 })
    await b.sync()
    await a.sync()
    expect(b.engine.status.phase).toBe('idle')
    expect(await b.waiting()).toEqual([])
    for (const device of [a, b]) {
      expect(device.db.documents.get('doc_ch1').content).toBe(
        'The iron gate was locked.\n\nShe climbed the wall.\n\nNobody saw her go.\n'
      )
    }
  })

  it('of a document held by a text hold an older app’s pull of that project alone', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    const t = 1000
    const row = {
      summary: '',
      order: 0,
      version: 1,
      created: t,
      updated: t,
    }
    a.put('stories', { id: 'story_2', wordCount: 0, version: 1, created: t, updated: t })
    a.put('documents', {
      ...row,
      id: 'root_story_2',
      storyId: 'story_2',
      parentId: 'story_2',
      type: 'folder',
      title: 'Heist',
      content: '',
      wordCount: 0,
    })
    a.put('documents', {
      ...row,
      id: 'doc_plan',
      storyId: 'story_2',
      parentId: 'root_story_2',
      type: 'text',
      title: 'Plan',
      content: 'Go at night.\n',
      wordCount: 3,
    })
    await settled(a)
    await a.sync()
    b.update({ format: 1 })
    await b.sync()
    expect(b.db.documents.has('doc_plan')).toBe(true)

    a.put('documents', {
      ...row,
      id: 'doc_scene',
      storyId: 'story_1',
      parentId: 'doc_ch1',
      type: 'text',
      title: 'Over the wall',
      content: 'She climbed.\n',
      wordCount: 2,
    })
    a.put('documents', {
      ...a.db.documents.get('doc_plan'),
      content: 'Go at dawn.\n',
      updated: 2000,
    })
    await settled(a)
    await a.sync()
    await b.sync()

    expect(b.engine.status).toMatchObject({ phase: 'held', error: null })
    expect(b.db.documents.has('doc_scene')).toBe(false)
    expect(b.db.documents.get('doc_plan').content).toBe('Go at dawn.\n')

    b.update({})
    await b.sync()
    expect(b.engine.status.phase).toBe('idle')
    expect(b.db.documents.get('doc_scene')).toMatchObject({ parentId: 'doc_ch1' })
  })

  it('stop a whole read partway without removing what it hasn’t reached, read whole once updated', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()
    a.update({ format: 3 })
    a.put('documents', {
      ...a.db.documents.get('doc_ch1'),
      content: 'Another way in.\n',
      updated: 2000,
    })
    await settled(a)
    await a.sync()

    // As when the project was made again on the server: b reads it whole, and
    // a row the server no longer has at all goes once it has.
    const reading = await b.state.get('cloudState', 'collection:story_1')
    const ghost = { id: 'msg_ghost', chatId: 'chat_1', role: 'user', content: 'Gone.' }
    b.db.messages.set(ghost.id, ghost)
    await b.state.write('cloudState', [
      { ...put('cloudState', reading), data: { ...reading, epoch: reading.epoch + 1 } },
    ])
    await b.state.write('cloudRecords', [
      put('cloudRecords', {
        id: 'messages:msg_ghost',
        storyId: 'story_1',
        name: 'ghost',
        rev: 1,
        print: 'ghost',
      }),
    ])
    await b.sync()
    expect(b.engine.status.phase).toBe('held')
    expect(b.db.documents.get('doc_ch1').content).toContain('She climbed the wall.')
    expect(b.db.messages.has('msg_ghost')).toBe(true)

    b.update({ format: 3 })
    await b.sync()
    expect(b.engine.status.phase).toBe('idle')
    expect(b.db.documents.get('doc_ch1').content).toBe('Another way in.\n')
    expect(b.db.messages.has('msg_1')).toBe(true)
    expect(b.db.messages.has('msg_ghost')).toBe(false)
  })
})

describe.skipIf(!HAVE_SERVER)('the setup between two devices', () => {
  /** A connection the writer made, with its key. */
  const proxy = {
    id: 'provider_proxy',
    name: 'Work proxy',
    type: 'generic',
    endpoint: 'https://proxy.example.com/v1',
    apiKey: 'sk-work',
    rememberKey: true,
    version: 1,
    created: 1000,
    updated: 1000,
  }

  it('brings connections, presets, prompts and settings to the other device', async () => {
    const { a, b } = await twoDevices()
    a.put('aiProviders', proxy)
    a.put('aiProfiles', {
      id: 'profile_work',
      name: 'Work',
      providerId: 'provider_proxy',
      model: 'big-model',
      created: 1000,
      updated: 1000,
    })
    a.put('skillWordings', { name: 'interpret', text: 'Read it closely.' })
    a.put('settings', { id: 'aiPreset', aiPreset: 'profile_work' })
    await settled(a)
    await a.sync()
    expect(await a.waiting()).toEqual([])

    await b.sync()
    await settled(b)
    expect(b.db.aiProviders.get('provider_proxy').apiKey).toBe('sk-work')
    expect(b.db.aiProfiles.get('profile_work').model).toBe('big-model')
    expect(b.db.skillWordings.get('interpret').text).toBe('Read it closely.')
    expect(b.db.settings.get('aiPreset').aiPreset).toBe('profile_work')
    expect(await b.waiting()).toEqual([])
  })

  it('knows the setup by its id alone, so an app from before passes over it', async () => {
    const { a } = await twoDevices()
    a.put('aiProviders', proxy)
    await settled(a)
    await a.sync()
    const listed = await a.api.collections()
    expect(listed).toHaveLength(1)
    expect(listed[0].meta).toBeNull()
  })

  it('never sends a new device’s untouched built-in first, and gives the account’s to it', async () => {
    const { a, b } = await twoDevices()
    const builtIn = {
      id: 'provider_openrouter_default',
      name: 'OpenRouter',
      type: 'openrouter',
      isDefault: true,
      version: 1,
    }
    a.put('aiProviders', { ...builtIn, apiKey: 'sk-mine', created: 1000, updated: 2000 })
    // Made later, on the new device's first start, and never changed.
    b.put('aiProviders', { ...builtIn, created: 9000, updated: 9000 })
    await settled(a)
    await settled(b)
    await b.sync()
    await a.sync()
    await b.sync()

    expect(b.db.aiProviders.get('provider_openrouter_default').apiKey).toBe('sk-mine')
    expect(a.db.aiProviders.get('provider_openrouter_default').apiKey).toBe('sk-mine')
    expect(await b.waiting()).toEqual([])
  })

  it('merges a settings group by setting, both devices’ changes kept', async () => {
    const { a, b } = await twoDevices()
    const preferences = { id: 'preferences', theme: 'system', applyEdits: 'auto' }
    a.put('settings', preferences)
    await settled(a)
    await a.sync()
    await b.sync()

    a.put('settings', { ...preferences, theme: 'dark' })
    b.put('settings', { ...preferences, applyEdits: 'ask' })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await a.sync()

    const merged = { id: 'preferences', theme: 'dark', applyEdits: 'ask' }
    expect(a.db.settings.get('preferences')).toEqual(merged)
    expect(b.db.settings.get('preferences')).toEqual(merged)
  })

  it('keeps a key the writer chose not to remember on its own device', async () => {
    const { a, b } = await twoDevices()
    a.put('aiProviders', { ...proxy, rememberKey: false })
    await settled(a)
    await a.sync()
    await b.sync()
    expect(b.db.aiProviders.get('provider_proxy').name).toBe('Work proxy')
    expect(b.db.aiProviders.get('provider_proxy')).not.toHaveProperty('apiKey')
  })

  it('sends a library card’s picture as a file, and a card without one as it is', async () => {
    const { a, b } = await twoDevices()
    const picture = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], {
      type: 'image/png',
    })
    a.put('cards', { id: 'libcard_1', name: 'Vex', title: 'Vex', hash: 'h1', added: 1000 })
    a.put('cardFiles', {
      id: 'libcard_1',
      card: { spec: 'chara_card_v2', data: { name: 'Vex' } },
      image: picture,
      thumbnail: null,
    })
    a.put('cards', { id: 'libcard_2', name: 'Ossa', title: 'Ossa', hash: 'h2', added: 1000 })
    a.put('cardFiles', { id: 'libcard_2', card: { name: 'Ossa' }, image: null })
    await settled(a)
    await a.sync()
    expect(await a.waiting()).toEqual([])

    await b.sync()
    await settled(b)
    expect(b.db.cards.get('libcard_1').title).toBe('Vex')
    const file = b.db.cardFiles.get('libcard_1')
    expect(file.card.data.name).toBe('Vex')
    expect(Buffer.from(await file.image.arrayBuffer())).toEqual(
      Buffer.from(await picture.arrayBuffer())
    )
    expect(b.db.cardFiles.get('libcard_2')).toEqual({ id: 'libcard_2', card: { name: 'Ossa' } })
    expect(await b.waiting()).toEqual([])
  })

  it('takes a row removed on one device off the other', async () => {
    const { a, b } = await twoDevices()
    a.put('aiProviders', proxy)
    a.put('cards', { id: 'libcard_1', name: 'Vex', title: 'Vex', hash: 'h1', added: 1000 })
    a.put('cardFiles', { id: 'libcard_1', card: { name: 'Vex' }, image: null })
    await settled(a)
    await a.sync()
    await b.sync()

    a.remove('aiProviders', 'provider_proxy')
    a.remove('cards', 'libcard_1')
    a.remove('cardFiles', 'libcard_1')
    await settled(a)
    await a.sync()
    await b.sync()
    expect(b.db.aiProviders.has('provider_proxy')).toBe(false)
    expect(b.db.cards.has('libcard_1')).toBe(false)
    expect(b.db.cardFiles.has('libcard_1')).toBe(false)
  })

  it('takes the account’s setup where both had a row, and sends what only this device had', async () => {
    const { a, b } = await twoDevices()
    a.put('settings', { id: 'preferences', theme: 'dark', applyEdits: 'auto' })
    a.put('aiProviders', proxy)
    await settled(a)
    await a.sync()

    // A device with a setup of its own, signed in later.
    b.put('settings', { id: 'preferences', theme: 'light', applyEdits: 'ask' })
    b.put('aiProfiles', { id: 'profile_b', name: 'Phone', created: 5000, updated: 9000 })
    await settled(b)
    await b.sync()
    await a.sync()

    const preferences = { id: 'preferences', theme: 'dark', applyEdits: 'auto' }
    expect(b.db.settings.get('preferences')).toEqual(preferences)
    expect(a.db.settings.get('preferences')).toEqual(preferences)
    expect(a.db.aiProfiles.get('profile_b').name).toBe('Phone')
    expect(b.db.aiProviders.get('provider_proxy').apiKey).toBe('sk-work')
    expect(await b.waiting()).toEqual([])
  })

  it('sends the setup whole once from a device that synced before the setup did', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    // Rows from before sync sent the setup: here, but never told of.
    a.db.aiProviders.set('provider_proxy', proxy)
    a.db.settings.set('preferences', { id: 'preferences', theme: 'dark' })
    await a.sync()
    await b.sync()
    expect(b.db.aiProviders.get('provider_proxy').apiKey).toBe('sk-work')
    expect(b.db.settings.get('preferences').theme).toBe('dark')

    // Once is enough: nothing goes again.
    await a.sync()
    expect(await a.waiting()).toEqual([])
  })

  it('gives a row both devices made after their first syncs to the newer', async () => {
    const { a, b } = await twoDevices()
    a.put('settings', { id: 'preferences', theme: 'system' })
    await settled(a)
    await a.sync()
    await b.sync()

    // Web search is kept only once it is changed: each device makes it.
    a.put('webSearch', { id: 'web', keys: { exa: 'exa-a' }, updated: 2000 })
    b.put('webSearch', { id: 'web', keys: { exa: 'exa-b' }, updated: 3000 })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await a.sync()
    expect(a.db.webSearch.get('web').keys.exa).toBe('exa-b')
    expect(b.db.webSearch.get('web').keys.exa).toBe('exa-b')
  })
})

describe.skipIf(!HAVE_SERVER)('a tree that merges broken', () => {
  it('puts a document whose folder went on the other device at the root, once it has lasted', async () => {
    let clock = 1_000_000
    const { a, b } = await twoDevices({ now: () => clock })
    writeProject(a)
    a.put('documents', {
      ...a.db.documents.get('doc_ch1'),
      id: 'folder_drafts',
      type: 'folder',
      title: 'Drafts',
      content: '',
      order: 1,
    })
    await settled(a)
    await a.sync()
    await b.sync()

    // B moves the chapter into Drafts; A deletes Drafts for good.
    b.put('documents', {
      ...b.db.documents.get('doc_ch1'),
      parentId: 'folder_drafts',
      updated: 2000,
    })
    a.remove('documents', 'folder_drafts')
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await a.sync()
    expect(a.db.documents.get('doc_ch1').parentId).toBe('folder_drafts')
    expect(a.db.documents.has('folder_drafts')).toBe(false)

    // Left as it is while it may be half of what is still coming.
    await a.sync()
    expect(a.db.documents.get('doc_ch1').parentId).toBe('folder_drafts')

    clock += SETTLE_MS
    await a.sync()
    await settled(a)
    await a.sync()
    await b.sync()
    expect(a.db.documents.get('doc_ch1').parentId).toBe('root_story_1')
    expect(b.db.documents.get('doc_ch1').parentId).toBe('root_story_1')
    expect(await a.waiting()).toEqual([])
  })

  it('renames the later of two siblings made with one name, the same on both devices', async () => {
    let clock = 1_000_000
    const { a, b } = await twoDevices({ now: () => clock })
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    const chapter = a.db.documents.get('doc_ch1')
    a.put('documents', { ...chapter, id: 'doc_a3', title: 'Chapter 3', created: 3000 })
    b.put('documents', { ...chapter, id: 'doc_b3', title: 'Chapter 3', created: 4000 })
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await a.sync()

    clock += SETTLE_MS
    // Both put it right, and agree.
    await a.sync()
    await b.sync()
    await settled(a)
    await settled(b)
    await a.sync()
    await b.sync()
    await a.sync()
    for (const device of [a, b]) {
      expect(device.db.documents.get('doc_a3').title).toBe('Chapter 3')
      expect(device.db.documents.get('doc_b3').title).toBe('Chapter 3 (2)')
    }
    expect(await a.waiting()).toEqual([])
    expect(await b.waiting()).toEqual([])
  })
})

describe.skipIf(!HAVE_SERVER)('rows a lost note kept back', () => {
  it('sends, at the next launch’s check, a change written here that never reached the outbox', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    // Written to storage, and the page closed before the outbox heard.
    const chapter = a.db.documents.get('doc_ch1')
    a.db.documents.set('doc_ch1', { ...chapter, content: 'Kept back.\n', updated: 5000 })
    a.db.aiProfiles.set('profile_work', { id: 'profile_work', name: 'Work', updated: 5000 })
    await a.sync()
    await b.sync()
    expect(b.db.documents.get('doc_ch1').content).not.toBe('Kept back.\n')

    a.engine.checkNextRound()
    await a.sync()
    await b.sync()
    expect(b.db.documents.get('doc_ch1').content).toBe('Kept back.\n')
    expect(b.db.aiProfiles.get('profile_work').name).toBe('Work')
    expect(await a.waiting()).toEqual([])
  })

  it('lets go of bytes waiting for a document that has none to send', async () => {
    const { a } = await twoDevices()
    writeProject(a)
    a.put('documents', {
      id: 'doc_src',
      storyId: 'story_1',
      parentId: 'root_story_1',
      type: 'file',
      title: 'main.js',
      content: 'export const answer = 42\n',
      summary: '',
      order: 1,
      wordCount: 0,
      version: 1,
      created: 1000,
      updated: 1000,
    })
    await settled(a)
    await a.sync()

    // A source file, put in the outbox as a file whose bytes were still to come.
    await a.state.write('cloudOutbox', [
      {
        entityType: 'cloudOutbox',
        id: 'files:doc_src',
        op: 'put',
        data: {
          id: 'files:doc_src',
          table: 'files',
          rowId: 'doc_src',
          op: 'put',
          storyId: 'story_1',
          at: 2000,
        },
        timestamp: 2000,
      },
    ])
    await a.sync()
    expect(await a.waiting()).toEqual(['files:doc_src'])

    a.engine.checkNextRound()
    await a.sync()
    expect(await a.waiting()).toEqual([])
  })

  it('sends nothing when every row is as the server has it, and never a removal', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    // A row gone here without a word: maybe one that couldn't be read.
    a.db.documents.delete('doc_ch1')
    a.engine.checkNextRound()
    await a.sync()
    expect(await a.waiting()).toEqual([])
    await b.sync()
    expect(b.db.documents.has('doc_ch1')).toBe(true)
  })
})

describe.skipIf(!HAVE_SERVER)('a hosted server', () => {
  it('that takes no pushes from a build too old has it wait for an update, still pulling', async () => {
    const { startServer } = await serverModule('app.js')
    const { openStore } = await serverModule('store.js')
    const { openBlobs } = await serverModule('blobs.js')
    const braked = await startServer({
      port: 0,
      host: '127.0.0.1',
      store: openStore(':memory:'),
      blobs: openBlobs(folder),
      signupCode: 'code',
      minApp: '0.1.0-dev.21',
    })
    const address = /** @type {import('node:net').AddressInfo} */ (braked.server.address())
    const at = `http://127.0.0.1:${address.port}`
    try {
      const made = await signUp(createApi(at), {
        name: 'braked',
        passphrase: 'a long passphrase',
        code: 'code',
        kdf: FAST,
      })
      const other = await signIn(createApi(at), { name: 'braked', passphrase: 'a long passphrase' })
      const a = makeDevice({
        api: createApi(at, made.token, { app: '0.1.0-dev.21' }),
        keys: made.keys,
      })
      const b = makeDevice({
        api: createApi(at, other.token, { app: '0.1.0-dev.20.1976' }),
        keys: other.keys,
      })
      writeProject(a)
      await settled(a)
      await a.sync()
      b.put('stories', { id: 'story_2', wordCount: 0, version: 1, created: 1, updated: 1 })
      await settled(b)
      await expect(b.sync()).rejects.toMatchObject({ status: 426 })
      expect(b.engine.status).toMatchObject({ phase: 'held', error: null, waiting: 1 })
      expect(b.db.documents.get('doc_ch1').content).toContain('She climbed the wall.')
    } finally {
      await braked.close()
    }
  })

  it('names a file’s blob beside its record, so the server can let go of it later', async () => {
    const { a } = await twoDevices()
    /** @type {any[]} */
    const pushed = []
    const push = a.api.push
    a.api.push = (id, schema, records) => {
      pushed.push(...records)
      return push(id, schema, records)
    }
    writeProject(a)
    await a.putFile('doc_file', 'story_1', new Blob([new Uint8Array([1, 2, 3])]))
    await settled(a)
    await a.sync()
    const named = pushed.filter(record => record.blob)
    expect(named).toHaveLength(1)
    expect(named[0].blob).toBe((await a.state.get('cloudRecords', 'files:doc_file')).file.blob)
  })

  it('keeps waiting what the quota has no room for, sends the rest, and says the storage is full', async () => {
    const { name, a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    const id = serverStore.account(name).id
    serverStore.setQuota(id, 1)
    await a.sync()
    expect(a.engine.status.full).toBe(true)
    expect((await a.waiting()).length).toBeGreaterThan(0)

    serverStore.setQuota(id, null)
    await a.sync()
    expect(a.engine.status.full).toBe(false)
    expect(await a.waiting()).toEqual([])
    await b.sync()
    expect(b.db.documents.get('doc_ch1').content).toContain('She climbed the wall.')
  })

  it('sends everything again once the server was put back from a backup, losing nothing', async () => {
    const { copyFile } = await import('node:fs/promises')
    const { openStore } = await serverModule('store.js')
    const { openBlobs } = await serverModule('blobs.js')
    const { startServer } = await serverModule('app.js')
    const path = join(folder, 'restored.db')
    const backup = join(folder, 'backup.db')
    /** @param {number} port */
    const run = async port => {
      const store = openStore(path)
      const running = await startServer({
        port,
        host: '127.0.0.1',
        store,
        blobs: openBlobs(join(folder, 'restored-blobs')),
        signupCode: 'code',
      })
      const address = /** @type {import('node:net').AddressInfo} */ (running.server.address())
      return { store, port: address.port, close: running.close }
    }
    let running = await run(0)
    const at = `http://127.0.0.1:${running.port}`
    const stop = async () => {
      await running.close()
      running.store.close()
    }
    try {
      const { a, b, c } = await twoDevices({ at })
      writeProject(a)
      await settled(a)
      await a.sync()
      await b.sync()

      // The backup, taken here.
      await stop()
      await copyFile(path, backup)
      running = await run(running.port)

      const chapter = a.db.documents.get('doc_ch1')
      a.put('documents', { ...chapter, content: 'Written after the backup.\n', updated: 3000 })
      a.put('documents', { ...chapter, id: 'doc_ch2', title: 'Chapter 2', updated: 3000 })
      await settled(a)
      await a.sync()
      await b.sync()
      expect(b.db.documents.get('doc_ch1').content).toBe('Written after the backup.\n')

      // The server is put back from it, and says so.
      await stop()
      await copyFile(backup, path)
      running = await run(running.port)
      running.store.newGeneration()

      await a.sync()
      await b.sync()
      await a.sync()
      expect(await a.waiting()).toEqual([])
      expect(await b.waiting()).toEqual([])
      expect(b.db.documents.get('doc_ch1').content).toBe('Written after the backup.\n')
      expect(b.db.documents.has('doc_ch2')).toBe(true)

      const fresh = await c()
      await fresh.sync()
      expect(fresh.db.documents.get('doc_ch1').content).toBe('Written after the backup.\n')
      expect(fresh.db.documents.has('doc_ch2')).toBe(true)
    } finally {
      await stop()
    }
  })

  it('counts what it does for the diagnostics, never what it carries', async () => {
    const diagnostics = createDiagnostics()
    const { a } = await twoDevices({ diagnostics })
    writeProject(a)
    await settled(a)
    await a.sync()
    const report = /** @type {any} */ (diagnostics.take({ app: 'test' }))
    expect(report.counts.rounds).toBe(1)
    expect(report.counts.pushed).toBeGreaterThan(0)
    expect(report.counts.bytesUp).toBeGreaterThan(0)
    expect(report.outbox.most).toBe(0)
    expect(JSON.stringify(report)).not.toMatch(/Chapter|climbed|story_1|doc_ch1/)
    expect(diagnostics.take({ app: 'test' })).toBeNull()
  })
})

describe.skipIf(!HAVE_SERVER)('a project kept off sync', () => {
  /**
   * Keep a project on one device only, as the app does: its story says so,
   * then the engine is told.
   * @param {ReturnType<typeof makeDevice>} device
   * @param {string} storyId
   */
  async function keepOff(device, storyId) {
    device.put('stories', { ...device.db.stories.get(storyId), syncOff: 4000 })
    await settled(device)
    await device.engine.keepOff(storyId)
  }

  it('leaves the server, goes to the other devices’ trash, and its writes stay here', async () => {
    const { a, b, c } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    await keepOff(a, 'story_1')
    await a.sync()
    expect((await a.api.collections()).find(collection => collection.deleted == null)).toBeFalsy()

    const chapter = a.db.documents.get('doc_ch1')
    a.put('documents', { ...chapter, content: 'Only here.\n', updated: 5000 })
    await settled(a)
    await a.sync()
    expect(await a.waiting()).toEqual([])

    await b.sync()
    await settled(b)
    // Kept in its trash, out of sync, and not sent up again.
    const kept = b.db.stories.get('story_1')
    expect(kept.trashed).toBeGreaterThan(0)
    expect(kept.keptElsewhere).toBeGreaterThan(0)
    expect(b.db.documents.has('doc_ch1')).toBe(true)
    await b.sync()
    expect(await b.waiting()).toEqual([])
    expect((await b.api.collections()).find(collection => collection.deleted == null)).toBeFalsy()

    const later = await c()
    await later.sync()
    expect(later.db.stories.has('story_1')).toBe(false)
    expect(a.db.documents.get('doc_ch1').content).toBe('Only here.\n')
  })

  it('keeps what another device was writing to it when it was kept elsewhere, in the trash there', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()

    const chapter = b.db.documents.get('doc_ch1')
    b.put('documents', { ...chapter, content: 'Written on the other device.\n', updated: 4500 })
    await settled(b)
    await keepOff(a, 'story_1')
    await a.sync()

    await b.sync()
    await settled(b)
    expect(b.db.documents.get('doc_ch1').content).toBe('Written on the other device.\n')
    expect(b.db.stories.get('story_1').trashed).toBeGreaterThan(0)
    expect(await b.waiting()).toEqual([])
    expect((await a.api.collections()).find(collection => collection.deleted == null)).toBeFalsy()
  })

  it('goes up whole once synced again, without what keeps it off', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    await b.sync()
    await keepOff(a, 'story_1')
    await a.sync()
    await b.sync()
    expect(b.db.stories.get('story_1').keptElsewhere).toBeGreaterThan(0)
    const chapter = a.db.documents.get('doc_ch1')
    a.put('documents', { ...chapter, content: 'Written while kept off.\n', updated: 5000 })

    const { syncOff: _syncOff, ...story } = a.db.stories.get('story_1')
    a.put('stories', { ...story, updated: 6000 })
    await settled(a)
    await a.engine.syncAgain('story_1')
    await a.sync()
    expect(await a.waiting()).toEqual([])

    await b.sync()
    await settled(b)
    expect(b.db.documents.get('doc_ch1').content).toBe('Written while kept off.\n')
    // Taken back out of the trash it was kept in, and syncing again.
    const back = b.db.stories.get('story_1')
    expect(back.trashed).toBeUndefined()
    expect(back.keptElsewhere).toBeUndefined()
    expect(back.syncOff).toBeUndefined()
    await b.sync()
    expect(await b.waiting()).toEqual([])
  })

  it('never goes up when kept off before its first sync, nor its story with what keeps it off', async () => {
    const { a, b } = await twoDevices()
    writeProject(a)
    // A second project, on this device only from the start.
    a.put('stories', {
      id: 'story_2',
      wordCount: 0,
      version: 1,
      created: 1,
      updated: 1,
      syncOff: 2,
    })
    a.put('documents', {
      id: 'doc_private',
      storyId: 'story_2',
      parentId: 'story_2',
      type: 'text',
      title: 'Private notes',
      content: 'Not for the server.\n',
      version: 1,
      created: 1,
      updated: 1,
    })
    await settled(a)
    await a.engine.enqueue()
    await a.sync()
    expect(await a.waiting()).toEqual([])

    await b.sync()
    expect(b.db.stories.has('story_1')).toBe(true)
    expect(b.db.stories.has('story_2')).toBe(false)
    expect(b.db.documents.has('doc_private')).toBe(false)
  })

  it('is taken off once the server can be reached, if it couldn’t be at once', async () => {
    const { a } = await twoDevices()
    writeProject(a)
    await settled(a)
    await a.sync()
    const listing = a.api.listing
    a.api.listing = async () => {
      throw new CloudError("The sync server at x can't be reached.", 0)
    }
    await keepOff(a, 'story_1')
    await expect(a.sync()).rejects.toThrow("can't be reached")
    a.api.listing = listing
    await a.sync()
    expect((await a.api.collections()).find(collection => collection.deleted == null)).toBeFalsy()
  })
})
