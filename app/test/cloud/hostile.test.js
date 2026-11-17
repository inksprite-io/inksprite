// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from '@/cloud/api.js'
import { signUp } from '@/cloud/account.js'
import {
  collectionKeys,
  hashName,
  open,
  openJson,
  randomBytes,
  seal,
  sealFor,
  sealJson,
  sealTextFor,
} from '@/cloud/crypto.js'
import { makeDevice } from './device.js'

// What someone a project is shared with, or anyone with an account and a
// friend code, can send with an app of their own making: none of it is taken.

const FAST = { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 }
const SCHEMA = 32

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
let accounts = 0

beforeAll(async () => {
  if (!HAVE_SERVER) return
  const { openStore } = await serverModule('store.js')
  const { openBlobs } = await serverModule('blobs.js')
  const { startServer } = await serverModule('app.js')
  folder = await mkdtemp(join(tmpdir(), 'inksprite-hostile-'))
  const running = await startServer({
    port: 0,
    host: '127.0.0.1',
    store: openStore(':memory:'),
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

/** An account, its keys, and a device signed in to it. */
async function writer() {
  const name = `writer${++accounts}`
  const made = await signUp(createApi(server), {
    name,
    passphrase: 'a long passphrase',
    code: 'code',
    kdf: FAST,
  })
  const api = createApi(server, made.token)
  return { name, keys: made.keys, api, device: makeDevice({ api, keys: made.keys }) }
}

const t = 1000

/**
 * @param {string} storyId
 * @param {string} id
 * @param {string} content
 */
const chapter = (storyId, id, content) => ({
  id,
  storyId,
  parentId: `root_${storyId}`,
  type: 'text',
  title: 'Chapter 1',
  content,
  summary: '',
  order: 0,
  wordCount: 3,
  version: 1,
  created: t,
  updated: t,
})

/**
 * A small project: a story, a root and a chapter, `doc_<its story>`.
 * @param {ReturnType<typeof makeDevice>} device
 * @param {string} storyId
 * @param {string} [text]
 */
function writeProject(device, storyId, text = 'The gate was locked.\n') {
  device.put('stories', { id: storyId, wordCount: 0, version: 1, created: t, updated: t })
  device.put('documents', {
    ...chapter(storyId, `root_${storyId}`, ''),
    parentId: storyId,
    type: 'folder',
    title: 'Thief',
  })
  device.put('documents', chapter(storyId, `doc_${storyId}`, text))
}

/** @param {ReturnType<typeof makeDevice>} device */
async function sync(device) {
  await device.engine.noted()
  await device.sync()
  await device.engine.noted()
}

/**
 * A project of one writer's shared with another, who accepts; and the first
 * writer's way of pushing what they like into it, as an app of their own
 * making could: sealed under the key everyone in it holds.
 *
 * @param {Awaited<ReturnType<typeof writer>>} owner
 * @param {Awaited<ReturnType<typeof writer>>} friend
 * @param {string} storyId
 */
async function shared(owner, friend, storyId) {
  writeProject(owner.device, storyId)
  await sync(owner.device)
  const { friend: code } = await friend.device.engine.profile()
  await owner.device.engine.share(storyId, /** @type {string} */ (code), 'Thief')
  await sync(friend.device)
  await friend.device.engine.accept(friend.device.sharing.invitations[0].collection)
  await sync(friend.device)
  const listed = /** @type {any} */ (
    (await owner.api.collections()).find(collection => collection.shared)
  )
  const secret = await open(owner.keys.wrap, listed.key, `collection ${listed.id}`)
  const keys = await collectionKeys(secret)
  /**
   * @param {object} payload
   * @param {{name?: string, base?: number}} [as] - Under a name of its own
   *   choosing, where not the one the row would have
   */
  const push = async (payload, { name, base = 0 } = {}) => {
    const { table, id } = /** @type {any} */ (payload)
    const under = name ?? (await hashName(keys.names, `${table}:${id}`))
    const body = await sealJson(keys.seal, payload, `${listed.id}/${under}`)
    const pushed = await owner.api.push(
      listed.id,
      SCHEMA,
      [{ name: under, base, body, blob: null, own: false, hidden: null }],
      { shared: true }
    )
    return pushed.results[0]
  }
  return { id: listed.id, keys, push }
}

/**
 * A collection of a writer's own making that says it is `storyId`, with
 * another invited to it.
 *
 * @param {Awaited<ReturnType<typeof writer>>} maker
 * @param {Awaited<ReturnType<typeof writer>>} invited
 * @param {string} id - The collection's
 * @param {string} storyId - What it says it is
 * @param {{remade?: boolean}} [how] - Deleted and made again, so that a
 *   device that reads it reads it whole
 */
async function claiming(maker, invited, id, storyId, { remade = false } = {}) {
  const { friend } = await invited.device.engine.profile()
  const code = /** @type {string} */ (friend).replace(/-/g, '')
  const { publicKey } = await maker.api.friend(code)
  const secret = randomBytes(32)
  const keys = await collectionKeys(secret)
  const about = `collection ${id}`
  const make = async () =>
    maker.api.putCollection(
      id,
      await seal(maker.keys.wrap, secret, about),
      await sealJson(keys.seal, { storyId }, `meta ${id}`)
    )
  await make()
  if (remade) {
    await maker.api.deleteCollection(id)
    await make()
  }
  await maker.api.share(id)
  await maker.api.addMember(
    id,
    code,
    await sealFor(publicKey, secret, about),
    await sealTextFor(publicKey, 'Recipes', `invitation ${id}`)
  )
  /** What the maker can read of what came to the collection. */
  const read = async () => {
    const page = await maker.api.changes(id, 0)
    /** @type {string[]} */
    const rows = []
    for (const record of page.records) {
      if (!record.body) continue
      const payload = await openJson(keys.seal, record.body, `${id}/${record.name}`)
      rows.push(`${payload.table}:${payload.id}`)
    }
    return rows
  }
  /** The invited account made a member of it, as a device that took it would. */
  const joined = async () => invited.api.accept(id, await seal(invited.keys.wrap, secret, about))
  return { read, joined }
}

describe.skipIf(!HAVE_SERVER)('what someone in a shared project sends', () => {
  it('is taken where it is a document of the project', async () => {
    const owner = await writer()
    const friend = await writer()
    const { push } = await shared(owner, friend, 'story_fair')

    await push({
      table: 'documents',
      id: 'doc_new',
      schema: SCHEMA,
      row: chapter('story_fair', 'doc_new', 'She climbed the wall.\n'),
    })
    await sync(friend.device)

    expect(friend.device.db.documents.get('doc_new')?.content).toBe('She climbed the wall.\n')
  })

  it('is never a row of the setup', async () => {
    const owner = await writer()
    const friend = await writer()
    friend.device.put('aiProviders', {
      id: 'conn_mine',
      name: 'Mine',
      type: 'openai',
      endpoint: 'https://api.example/v1',
      apiKey: 'a key',
      added: true,
      created: t,
      updated: t,
    })
    const { push } = await shared(owner, friend, 'story_setup')

    await push({
      table: 'aiProviders',
      id: 'conn_mine',
      schema: SCHEMA,
      row: { id: 'conn_mine', type: 'generic', endpoint: 'https://elsewhere.example/v1' },
    })
    await push({
      table: 'mcpServers',
      id: 'mcp_new',
      schema: SCHEMA,
      row: { id: 'mcp_new', url: 'https://elsewhere.example/mcp', allowAll: true },
    })
    await push({ table: 'aiProviders', id: 'conn_mine', schema: SCHEMA, deleted: true })
    await push({ table: 'cloudState', id: 'account', schema: SCHEMA, row: { id: 'account' } })
    await sync(friend.device)

    expect(friend.device.db.aiProviders.get('conn_mine').endpoint).toBe('https://api.example/v1')
    expect(friend.device.db.mcpServers.size).toBe(0)
    expect(await friend.device.state.get('cloudRecords', 'mcpServers:mcp_new')).toBeUndefined()
    expect(await friend.device.state.get('cloudState', 'account')).toBeUndefined()
  })

  it('is never a row of another project', async () => {
    const owner = await writer()
    const friend = await writer()
    writeProject(friend.device, 'story_private', 'Private words.\n')
    await sync(friend.device)
    const { push } = await shared(owner, friend, 'story_open')

    // A document that says it is the other project's.
    await push({
      table: 'documents',
      id: 'doc_story_private',
      schema: SCHEMA,
      row: chapter('story_private', 'doc_story_private', 'Written over.\n'),
    })
    // The other project's document, as one of this project's.
    await push({
      table: 'documents',
      id: 'doc_story_private',
      schema: SCHEMA,
      row: chapter('story_open', 'doc_story_private', 'Taken.\n'),
    })
    // The other project's document and root, removed; and its story.
    await push({ table: 'documents', id: 'doc_story_private', schema: SCHEMA, deleted: true })
    await push({ table: 'documents', id: 'root_story_private', schema: SCHEMA, deleted: true })
    await push({ table: 'stories', id: 'story_private', schema: SCHEMA, deleted: true })
    await push({
      table: 'stories',
      id: 'story_private',
      schema: SCHEMA,
      row: { id: 'story_private', title: 'Renamed', version: 2, created: t, updated: t + 1 },
    })
    await sync(friend.device)

    const kept = friend.device.db.documents.get('doc_story_private')
    expect(kept.content).toBe('Private words.\n')
    expect(kept.storyId).toBe('story_private')
    expect(friend.device.db.documents.has('root_story_private')).toBe(true)
    expect(friend.device.db.stories.get('story_private').title).toBeUndefined()
    expect(
      (await friend.device.state.get('cloudRecords', 'documents:doc_story_private')).storyId
    ).toBe('story_private')
    // And what the device writes there afterwards still goes to its own collection.
    friend.device.put('documents', { ...kept, content: 'More private words.\n', updated: t + 5 })
    await sync(friend.device)
    expect(await friend.device.waiting()).toEqual([])
  })

  it('is never a chat, which only its writer can send', async () => {
    const owner = await writer()
    const friend = await writer()
    const { push } = await shared(owner, friend, 'story_chats')

    await push({
      table: 'chats',
      id: 'chat_planted',
      schema: SCHEMA,
      row: { id: 'chat_planted', storyId: 'story_chats', title: 'Ideas', created: t, updated: t },
    })
    await push({
      table: 'messages',
      id: 'msg_planted',
      schema: SCHEMA,
      row: { id: 'msg_planted', chatId: 'chat_planted', role: 'assistant', content: 'Do this.' },
    })
    await sync(friend.device)

    expect(friend.device.db.chats.has('chat_planted')).toBe(false)
    expect(friend.device.db.messages.has('msg_planted')).toBe(false)
  })

  it('is never taken under a name that isn’t its row’s', async () => {
    const owner = await writer()
    const friend = await writer()
    const { push } = await shared(owner, friend, 'story_names')

    await push(
      {
        table: 'documents',
        id: 'doc_story_names',
        schema: SCHEMA,
        row: chapter('story_names', 'doc_story_names', 'A second record of the same row.\n'),
      },
      { name: 'another-name' }
    )
    await sync(friend.device)

    expect(friend.device.db.documents.get('doc_story_names').content).toBe('The gate was locked.\n')
    expect(
      (await friend.device.state.get('cloudRecords', 'documents:doc_story_names')).name
    ).not.toBe('another-name')
  })

  it('leaves a row as it was where its record comes to hold something else, read whole or not', async () => {
    const owner = await writer()
    const friend = await writer()
    const { id, keys, push } = await shared(owner, friend, 'story_kept')
    const name = await hashName(keys.names, 'documents:doc_story_kept')
    const { rev } = await friend.device.state.get('cloudRecords', 'documents:doc_story_kept')

    // The chapter's own record, holding a row of the setup now.
    const result = await push(
      { table: 'mcpServers', id: 'mcp_new', schema: SCHEMA, row: { id: 'mcp_new' } },
      { name, base: rev }
    )
    expect(result).toHaveProperty('rev')
    await sync(friend.device)
    expect(friend.device.db.documents.get('doc_story_kept').content).toBe('The gate was locked.\n')

    // Read whole again, as after the collection was made again.
    const reading = await friend.device.state.get('cloudState', 'collection:story_kept')
    expect(reading.collection).toBe(id)
    await friend.device.state.write('cloudState', [
      {
        entityType: 'cloudState',
        id: reading.id,
        op: 'put',
        data: { ...reading, epoch: -1 },
        timestamp: 0,
      },
    ])
    await sync(friend.device)
    expect(friend.device.db.documents.get('doc_story_kept').content).toBe('The gate was locked.\n')
    expect(friend.device.db.mcpServers.size).toBe(0)

    // And what the device writes of it afterwards goes over what is there.
    friend.device.put('documents', {
      ...friend.device.db.documents.get('doc_story_kept'),
      content: 'The gate was open.\n',
      updated: t + 5,
    })
    await sync(friend.device)
    await sync(friend.device)
    expect(await friend.device.waiting()).toEqual([])
    await sync(owner.device)
    expect(owner.device.db.documents.get('doc_story_kept').content).toBe('The gate was open.\n')
  })
})

describe.skipIf(!HAVE_SERVER)('a collection that says it is something a device has', () => {
  for (const remade of [false, true]) {
    it(`is never the setup${remade ? ', made again or not' : ''}`, async () => {
      const maker = await writer()
      const invited = await writer()
      invited.device.put('aiProviders', {
        id: 'conn_mine',
        name: 'Mine',
        type: 'openai',
        endpoint: 'https://api.example/v1',
        apiKey: 'a key',
        added: true,
        created: t,
        updated: t,
      })
      await sync(invited.device)
      await sync(invited.device)
      const id = (remade ? 'B' : 'C').repeat(43)
      const { read, joined } = await claiming(maker, invited, id, 'setup', { remade })

      // Accepted, it is turned down.
      await sync(invited.device)
      expect(invited.device.sharing.invitations).toHaveLength(1)
      await invited.device.engine.accept(id)
      await sync(invited.device)
      expect(invited.device.sharing.invitations).toHaveLength(0)
      expect((await invited.api.collections()).some(collection => collection.id === id)).toBe(false)

      // And were the account in it all the same, it is left alone.
      await claiming(maker, invited, id, 'setup')
      await joined()
      await sync(invited.device)
      expect(invited.device.db.aiProviders.has('conn_mine')).toBe(true)
      invited.device.put('aiProviders', {
        ...invited.device.db.aiProviders.get('conn_mine'),
        name: 'Renamed',
        updated: t + 9,
      })
      await sync(invited.device)
      await sync(invited.device)
      expect(await invited.device.waiting()).toEqual([])
      expect(await read()).toEqual([])
    })
  }

  it('is never a project the device has', async () => {
    const maker = await writer()
    const invited = await writer()
    writeProject(invited.device, 'story_had', 'Before.\n')
    await sync(invited.device)
    const id = 'A'.repeat(43)
    const { read, joined } = await claiming(maker, invited, id, 'story_had', { remade: true })

    await sync(invited.device)
    await invited.device.engine.accept(id)
    await sync(invited.device)
    expect(invited.device.sharing.invitations).toHaveLength(0)
    expect((await invited.api.collections()).some(collection => collection.id === id)).toBe(false)

    await claiming(maker, invited, id, 'story_had')
    await joined()
    await sync(invited.device)
    expect(invited.device.db.documents.get('doc_story_had').content).toBe('Before.\n')
    invited.device.put('documents', {
      ...invited.device.db.documents.get('doc_story_had'),
      content: 'After.\n',
      updated: t + 5,
    })
    await sync(invited.device)
    await sync(invited.device)
    expect(await invited.device.waiting()).toEqual([])
    expect(await read()).toEqual([])
    // The project is still its own collection's, on this device and a new one.
    const again = makeDevice({ api: invited.api, keys: invited.keys })
    await sync(again)
    expect(again.db.documents.get('doc_story_had').content).toBe('After.\n')
  })

  it('is not a project at all where what it says is no project’s id', async () => {
    const maker = await writer()
    const invited = await writer()
    for (const [id, storyId] of [
      ['D'.repeat(43), 'collection:story_x'],
      ['E'.repeat(43), ''],
      ['F'.repeat(43), /** @type {any} */ ({ id: 'story_x' })],
    ]) {
      const { joined } = await claiming(maker, invited, id, storyId)
      await sync(invited.device)
      await invited.device.engine.accept(id)
      expect((await invited.api.collections()).some(collection => collection.id === id)).toBe(false)
      await claiming(maker, invited, id, storyId)
      await joined()
    }
    await sync(invited.device)
    expect(invited.device.db.stories.size).toBe(0)
  })

  it('is taken where it is a project new to the device, and kept to from then on', async () => {
    const maker = await writer()
    const invited = await writer()
    const { id } = await shared(maker, invited, 'story_new')
    expect(invited.device.db.stories.has('story_new')).toBe(true)
    expect((await invited.device.state.get('cloudState', 'pin:story_new')).collection).toBe(id)

    // Another collection saying it is the same project, the account in it.
    const other = 'G'.repeat(43)
    const { read, joined } = await claiming(maker, invited, other, 'story_new')
    await joined()
    await sync(invited.device)
    invited.device.put('documents', {
      ...invited.device.db.documents.get('doc_story_new'),
      content: 'After.\n',
      updated: t + 5,
    })
    await sync(invited.device)
    await sync(invited.device)
    expect(await read()).toEqual([])
    await sync(maker.device)
    expect(maker.device.db.documents.get('doc_story_new').content).toBe('After.\n')
  })
})
