// @vitest-environment node
/* global Blob, crypto */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from '@/cloud/api.js'
import { signIn, signUp } from '@/cloud/account.js'
import { makeKeyPair } from '@/cloud/crypto.js'
import { makeDevice } from './device.js'

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
let accounts = 0

beforeAll(async () => {
  if (!HAVE_SERVER) return
  const { openStore } = await serverModule('store.js')
  const { openBlobs } = await serverModule('blobs.js')
  const { startServer } = await serverModule('app.js')
  folder = await mkdtemp(join(tmpdir(), 'inksprite-sharing-'))
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

/**
 * An account, and a device signed in to it; more devices on asking.
 * @param {string} [display] - The name it shows the people it shares with,
 *   if not its own
 */
async function writer(display) {
  const name = `writer${++accounts}`
  const made = await signUp(createApi(server), {
    name,
    passphrase: 'a long passphrase',
    code: 'code',
    kdf: FAST,
  })
  const device = makeDevice({ api: createApi(server, made.token), keys: made.keys })
  if (display !== undefined) await device.engine.setDisplay(display)
  return {
    name,
    device,
    /** Another device, signed in to the same account. */
    async another() {
      const signedIn = await signIn(createApi(server), { name, passphrase: 'a long passphrase' })
      return makeDevice({ api: createApi(server, signedIn.token), keys: signedIn.keys })
    },
  }
}

/**
 * A small project: a story, a root, a chapter, a chat with a message.
 * @param {ReturnType<typeof makeDevice>} device
 */
function writeProject(device, storyId = 'story_s') {
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
    id: 'doc_s1',
    storyId,
    parentId: `root_${storyId}`,
    type: 'text',
    title: 'Chapter 1',
    content: 'The gate was locked.\n\nShe climbed the wall.\n',
    summary: '',
    order: 0,
    wordCount: 9,
    version: 1,
    created: t,
    updated: t,
  })
  device.put('chats', {
    id: 'chat_owner',
    storyId,
    title: 'Owner’s ideas',
    titleSet: true,
    lastMessageAt: t,
    version: 1,
    created: t,
    updated: t,
  })
  device.put('messages', {
    id: 'msg_owner',
    chatId: 'chat_owner',
    role: 'user',
    content: 'What does the reader not know yet?',
    version: 1,
    created: t,
    updated: t,
  })
}

/** @param {ReturnType<typeof makeDevice>} device */
const sync = async device => {
  await device.engine.noted()
  await device.sync()
  await device.engine.noted()
}

/**
 * An owner with a project synced on two devices, and a friend it is shared with.
 */
async function sharedProject() {
  const owner = await writer('Ada')
  const a = owner.device
  writeProject(a)
  await sync(a)
  const a2 = await owner.another()
  await sync(a2)
  const friend = await writer('Grace')
  const f = friend.device
  const { friend: code } = await f.engine.profile()
  await a.engine.share('story_s', code)
  return { owner, a, a2, friend, f, code }
}

describe.skipIf(!HAVE_SERVER)('a project shared with a friend', () => {
  it('arrives whole on the friend’s device, without the owner’s chats', async () => {
    const { f } = await sharedProject()
    await sync(f)
    expect(f.db.stories.get('story_s')).toBeDefined()
    expect(f.db.documents.get('doc_s1').content).toContain('She climbed the wall.')
    expect(f.db.chats.size).toBe(0)
    expect(f.db.messages.size).toBe(0)
    expect(await f.waiting()).toEqual([])
  })

  it('carries edits both ways, and the owner’s other device still has its chats', async () => {
    const { a, a2, f } = await sharedProject()
    await sync(f)
    f.put('documents', {
      ...f.db.documents.get('doc_s1'),
      content: 'The gate was locked.\n\nShe climbed the wall.\n\nNobody saw her.\n',
    })
    await sync(f)
    await sync(a)
    expect(a.db.documents.get('doc_s1').content).toContain('Nobody saw her.')

    a.put('documents', { ...a.db.documents.get('doc_s1'), title: 'The wall' })
    await sync(a)
    await sync(f)
    expect(f.db.documents.get('doc_s1').title).toBe('The wall')

    await sync(a2)
    expect(a2.db.messages.get('msg_owner').content).toBe('What does the reader not know yet?')
    expect(a2.db.documents.get('doc_s1').content).toContain('Nobody saw her.')
  })

  it('keeps each one’s chats their own, synced between their own devices', async () => {
    const { a, a2, friend, f } = await sharedProject()
    await sync(f)
    f.put('chats', {
      id: 'chat_friend',
      storyId: 'story_s',
      title: 'Grace’s notes',
      titleSet: true,
      lastMessageAt: 2000,
      version: 1,
      created: 2000,
      updated: 2000,
    })
    f.put('messages', {
      id: 'msg_friend',
      chatId: 'chat_friend',
      role: 'user',
      content: 'Is the wall too easy?',
      version: 1,
      created: 2000,
      updated: 2000,
    })
    await sync(f)
    a2.put('messages', {
      ...a2.db.messages.get('msg_owner'),
      content: 'And what does she know?',
      updated: 4000,
    })
    await sync(a2)

    await sync(a)
    expect(a.db.chats.has('chat_friend')).toBe(false)
    expect(a.db.messages.get('msg_owner').content).toBe('And what does she know?')
    await sync(f)
    expect(f.db.messages.has('msg_owner')).toBe(false)

    const f2 = await friend.another()
    await sync(f2)
    expect(f2.db.messages.get('msg_friend').content).toBe('Is the wall too easy?')
    expect(f2.db.messages.has('msg_owner')).toBe(false)
  })

  it('has an owner’s device not yet told it was shared send its chat as its own', async () => {
    const owner = await writer('Ada')
    const a = owner.device
    writeProject(a)
    await sync(a)
    const a2 = await owner.another()
    await sync(a2)
    // Written on the second device before it hears the project was shared.
    a2.put('chats', {
      id: 'chat_late',
      storyId: 'story_s',
      title: 'Late',
      titleSet: true,
      lastMessageAt: 3000,
      version: 1,
      created: 3000,
      updated: 3000,
    })
    await a2.engine.noted()
    // Its round lists the collections before the project is shared, and pushes after.
    const stale = await a2.api.listing()
    const listing = a2.api.listing
    a2.api.listing = async () => {
      a2.api.listing = listing
      return stale
    }
    const friend = await writer('Grace')
    const f = friend.device
    await a.engine.share('story_s', (await f.engine.profile()).friend)
    await sync(a2)
    expect(await a2.waiting()).toEqual([])
    await sync(f)
    expect(f.db.chats.has('chat_late')).toBe(false)
    await sync(a)
    expect(a.db.chats.get('chat_late').title).toBe('Late')
  })

  it('says who is in it, by the names they show, on both sides', async () => {
    const { a, f } = await sharedProject()
    await sync(f)
    await sync(a)
    const names = (/** @type {ReturnType<typeof makeDevice>} */ device) =>
      device.sharing.projects.story_s.members.map(member => [member.display, member.owner])
    expect(names(a)).toEqual([
      ['Ada', true],
      ['Grace', false],
    ])
    expect(names(f)).toEqual(names(a))
    expect(a.sharing.projects.story_s.role).toBe('owner')
    expect(f.sharing.projects.story_s.role).toBe('member')
    expect(f.sharing.me).toBe(f.sharing.projects.story_s.members[1].account)
    expect(f.sharing.projects.story_s.owner).toBe(a.sharing.me)
  })

  it('shows an account by its own name until it gives another', async () => {
    const owner = await writer()
    const a = owner.device
    writeProject(a)
    await sync(a)
    const friend = await writer()
    const f = friend.device
    const { friend: code, display } = await f.engine.profile()
    expect(display).toBe(friend.name)
    await a.engine.share('story_s', code)
    await sync(f)
    expect(f.sharing.projects.story_s.members.map(member => member.display)).toEqual([
      owner.name,
      friend.name,
    ])

    await f.engine.setDisplay('Grace')
    expect((await f.engine.profile()).display).toBe('Grace')
  })

  it('refuses a friend code the server gives the wrong key for', async () => {
    const owner = await writer('Ada')
    const a = owner.device
    writeProject(a)
    await sync(a)
    const friend = await writer('Grace')
    const { friend: code } = await friend.device.engine.profile()
    // The server hands back a key of its own for the code.
    const wrap = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
    ])
    const its = await makeKeyPair(wrap)
    const real = a.api.friend
    a.api.friend = async typed => ({ ...(await real(typed)), publicKey: its.publicKey })
    try {
      await expect(a.engine.share('story_s', code)).rejects.toThrow('key for that friend code')
    } finally {
      a.api.friend = real
    }
    await sync(friend.device)
    expect(friend.device.db.stories.has('story_s')).toBe(false)
  })

  it('goes to a friend’s trash, out of sync, once they are removed, and comes back when added again', async () => {
    const { a, f, code } = await sharedProject()
    await sync(f)
    const grace = /** @type {any} */ (
      a.sharing.projects.story_s.members.find(member => !member.owner)
    )
    await a.engine.removeMember('story_s', grace.account)
    expect(a.sharing.projects.story_s).toBeUndefined()
    await sync(f)
    expect(f.db.stories.get('story_s').trashed).toBeGreaterThan(0)
    expect(f.db.stories.get('story_s').keptElsewhere).toBeGreaterThan(0)
    expect(f.db.documents.get('doc_s1').content).toContain('She climbed the wall.')
    f.put('documents', { ...f.db.documents.get('doc_s1'), title: 'Written after' })
    await sync(f)
    await sync(a)
    expect(a.db.documents.get('doc_s1').title).toBe('Chapter 1')

    await a.engine.share('story_s', code)
    await sync(f)
    expect(f.db.stories.get('story_s').keptElsewhere).toBeUndefined()
    expect(f.db.stories.get('story_s').trashed).toBeUndefined()
  })

  it('goes to the trash of a friend who leaves, and their chats leave the server', async () => {
    const { a, f } = await sharedProject()
    await sync(f)
    f.put('chats', {
      id: 'chat_friend',
      storyId: 'story_s',
      title: 'Mine',
      titleSet: true,
      lastMessageAt: 2000,
      version: 1,
      created: 2000,
      updated: 2000,
    })
    await sync(f)
    await f.engine.leave('story_s')
    expect(f.db.stories.get('story_s').trashed).toBeGreaterThan(0)
    expect(f.db.chats.get('chat_friend').title).toBe('Mine')
    await sync(f)
    expect(f.db.stories.get('story_s').keptElsewhere).toBeGreaterThan(0)
    await sync(a)
    expect(a.sharing.projects.story_s).toBeUndefined()
  })

  it('has a friend who deletes it leave it, still there for the owner', async () => {
    const { a, f } = await sharedProject()
    await sync(f)
    await f.removeProject('story_s')
    await sync(f)
    expect(await f.waiting()).toEqual([])
    expect(f.engine.status.phase).toBe('idle')
    await sync(a)
    expect(a.db.documents.get('doc_s1').content).toContain('She climbed the wall.')
    expect(a.sharing.projects.story_s).toBeUndefined()
  })

  it('deletes it for the friend when the owner deletes it', async () => {
    const { a, f } = await sharedProject()
    await sync(f)
    await a.removeProject('story_s')
    await sync(a)
    await sync(f)
    expect(f.db.stories.has('story_s')).toBe(false)
  })

  it('keeps it in the trash of a friend writing to it when the owner deletes it', async () => {
    const { a, f } = await sharedProject()
    await sync(f)
    f.put('documents', { ...f.db.documents.get('doc_s1'), title: 'Still writing' })
    await f.engine.noted()
    await a.removeProject('story_s')
    await sync(a)
    await sync(f)
    expect(f.db.stories.get('story_s').trashed).toBeGreaterThan(0)
    expect(f.db.documents.get('doc_s1').title).toBe('Still writing')
    expect(await f.waiting()).toEqual([])
  })
})

/**
 * A document of the small project.
 * @param {ReturnType<typeof makeDevice>} device
 * @param {string} id
 * @param {Record<string, any>} [fields]
 */
function writeDocument(device, id, fields = {}) {
  device.put('documents', {
    id,
    storyId: 'story_s',
    parentId: 'root_story_s',
    type: 'text',
    title: id,
    content: `What ${id} says.\n`,
    summary: '',
    order: 0,
    wordCount: 3,
    version: 1,
    created: 1000,
    updated: 1000,
    ...fields,
  })
}

/**
 * A version of a document.
 * @param {ReturnType<typeof makeDevice>} device
 * @param {string} id
 * @param {string} documentId
 */
function writeVersion(device, id, documentId) {
  device.put('versions', {
    id,
    storyId: 'story_s',
    documentId,
    at: 2000,
    title: documentId,
    content: 'What it said before.\n',
    words: 4,
  })
}

/** @param {ReturnType<typeof makeDevice>} device */
const documentsOf = device => [...device.db.documents.keys()].sort()

describe.skipIf(!HAVE_SERVER)('a project shared with only some of its documents', () => {
  it('hides the rest from a friend, files, pictures and versions with them, but for the folders on the way', async () => {
    const owner = await writer('Ada')
    const a = owner.device
    writeProject(a)
    writeDocument(a, 'fold_notes', { type: 'folder', title: 'Notes', content: '', unshared: true })
    writeDocument(a, 'doc_note', { parentId: 'fold_notes', title: 'A note' })
    writeDocument(a, 'fold_secret', {
      type: 'folder',
      title: 'Secret',
      content: '',
      unshared: true,
    })
    writeDocument(a, 'doc_plan', {
      parentId: 'fold_secret',
      title: 'The plan',
      unshared: true,
      pictures: { 'map.png': { type: 'image/png', width: 1, height: 1 } },
    })
    writeDocument(a, 'doc_book', { type: 'file', title: 'Rulebook', unshared: true })
    writeVersion(a, 'ver_plan', 'doc_plan')
    writeVersion(a, 'ver_s1', 'doc_s1')
    await a.putFile('doc_plan/map.png', 'story_s', new Blob([new Uint8Array([1, 2, 3])]))
    await a.putFile('doc_book', 'story_s', new Blob(['a rulebook'], { type: 'application/pdf' }))
    await sync(a)
    await a.engine.setSelective('story_s', true)
    expect(a.sharing.selective).toEqual(['story_s'])
    const friend = await writer('Grace')
    const f = friend.device
    await a.engine.share('story_s', (await f.engine.profile()).friend)

    await sync(f)
    expect(documentsOf(f)).toEqual(['doc_note', 'doc_s1', 'fold_notes', 'root_story_s'])
    expect([...f.db.versions.keys()]).toEqual(['ver_s1'])
    expect(f.db.files.size).toBe(0)
    // At most the removal of what the others had before it was hidden.
    expect((await f.state.get('cloudRecords', 'files:doc_book'))?.print ?? null).toBeNull()
    expect(await f.state.get('cloudState', 'file:doc_book')).toBeUndefined()
    expect(f.db.chats.size).toBe(0)

    // The owner's other devices have all of it.
    const a2 = await owner.another()
    await sync(a2)
    expect(documentsOf(a2)).toEqual(documentsOf(a))
    expect(a2.db.files.has('doc_plan/map.png')).toBe(true)
    expect(a2.db.versions.has('ver_plan')).toBe(true)
    expect(await a2.engine.fetchFile('doc_book')).toBeTruthy()
  })

  it('isn’t shared with anyone while something to hide is still everyone’s on the server', async () => {
    const owner = await writer('Ada')
    const a = owner.device
    writeProject(a)
    writeDocument(a, 'doc_plan', { title: 'The plan', unshared: true })
    await sync(a)
    // A newer app's copy holds it here, so it can't go as the owner's own yet.
    const record = await a.state.get('cloudRecords', 'documents:doc_plan')
    await a.state.write('cloudRecords', [
      {
        entityType: 'cloudRecords',
        id: record.id,
        op: 'put',
        data: { ...record, ahead: { schema: 999, format: 0 } },
        timestamp: 0,
      },
    ])
    await a.engine.setSelective('story_s', true)
    const friend = await writer('Grace')
    const f = friend.device
    await expect(a.engine.share('story_s', (await f.engine.profile()).friend)).rejects.toThrow(
      'Not all of it has synced yet'
    )
    expect((await f.api.listing()).collections).toEqual([])
  })

  it('takes a document from a friend once it is no longer shared, and brings it back once it is', async () => {
    const { a, f } = await sharedProject()
    writeVersion(a, 'ver_s1', 'doc_s1')
    await sync(a)
    await sync(f)
    expect(f.db.documents.has('doc_s1')).toBe(true)
    expect(f.db.versions.has('ver_s1')).toBe(true)

    await a.engine.setSelective('story_s', true)
    a.put('documents', { ...a.db.documents.get('doc_s1'), unshared: true })
    await sync(a)
    await sync(f)
    expect(f.db.documents.has('doc_s1')).toBe(false)
    expect(f.db.versions.has('ver_s1')).toBe(false)

    // What is written in it since reaches only the owner's devices.
    a.put('documents', { ...a.db.documents.get('doc_s1'), content: 'A secret.\n' })
    await sync(a)
    await sync(f)
    expect(f.db.documents.has('doc_s1')).toBe(false)

    const { unshared: _unshared, ...shown } = a.db.documents.get('doc_s1')
    a.put('documents', shown)
    await sync(a)
    await sync(f)
    expect(f.db.documents.get('doc_s1').content).toBe('A secret.\n')
    expect(f.db.versions.has('ver_s1')).toBe(true)
  })

  it('takes a document from a friend on an older app without holding the rest of the project', async () => {
    const { a, f } = await sharedProject()
    writeDocument(a, 'doc_s2', { title: 'Chapter 2' })
    await sync(a)
    f.update({ format: 1 })
    await sync(f)
    expect(f.db.documents.has('doc_s1')).toBe(true)

    await a.engine.setSelective('story_s', true)
    a.put('documents', { ...a.db.documents.get('doc_s1'), unshared: true })
    a.put('documents', { ...a.db.documents.get('doc_s2'), content: 'Later.\n' })
    await sync(a)
    await sync(f)
    expect(f.engine.status.phase).not.toBe('held')
    expect(f.db.documents.has('doc_s1')).toBe(false)
    expect(f.db.documents.get('doc_s2').content).toBe('Later.\n')
  })

  it('gives what is made since its folder’s answer, but not what a friend makes', async () => {
    const { a, f } = await sharedProject()
    await a.engine.setSelective('story_s', true)
    writeDocument(a, 'fold_secret', {
      type: 'folder',
      title: 'Secret',
      content: '',
      unshared: true,
    })
    writeDocument(a, 'fold_open', { type: 'folder', title: 'Open', content: '' })
    await sync(a)
    writeDocument(a, 'doc_in_secret', { parentId: 'fold_secret' })
    writeDocument(a, 'doc_in_open', { parentId: 'fold_open' })
    writeDocument(a, 'doc_top')
    await sync(a)
    expect(a.db.documents.get('doc_in_secret').unshared).toBe(true)
    expect(a.db.documents.get('doc_in_open').unshared).toBeUndefined()
    expect(a.db.documents.get('doc_top').unshared).toBeUndefined()
    await sync(f)
    expect(documentsOf(f)).toEqual([
      'doc_in_open',
      'doc_s1',
      'doc_top',
      'fold_open',
      'root_story_s',
    ])

    // The top level no longer shared: what the owner makes there isn't, and
    // what the friend makes there still is.
    a.put('documents', { ...a.db.documents.get('root_story_s'), unshared: true })
    await sync(a)
    writeDocument(a, 'doc_top_later')
    await sync(a)
    expect(a.db.documents.get('doc_top_later').unshared).toBe(true)
    await sync(f)
    writeDocument(f, 'doc_theirs', { title: 'Theirs' })
    await sync(f)
    await sync(a)
    a.put('documents', { ...a.db.documents.get('doc_theirs'), content: 'Seen by both.\n' })
    await sync(a)
    await sync(f)
    expect(a.db.documents.get('doc_theirs').unshared).toBeUndefined()
    expect(f.db.documents.get('doc_theirs').content).toBe('Seen by both.\n')
    expect(f.db.documents.has('doc_top_later')).toBe(false)
  })

  it('shares the whole project again, everything that was hidden with it', async () => {
    const { a, f } = await sharedProject()
    await a.engine.setSelective('story_s', true)
    writeDocument(a, 'doc_plan', { title: 'The plan', unshared: true })
    await sync(a)
    await sync(f)
    expect(f.db.documents.has('doc_plan')).toBe(false)

    await a.engine.setSelective('story_s', false)
    await sync(f)
    expect(f.db.documents.get('doc_plan').title).toBe('The plan')
    // The owner's choice is kept for the next time.
    expect(a.db.documents.get('doc_plan').unshared).toBe(true)
  })

  it('keeps what a friend writes in a folder only on the way theirs as well', async () => {
    const { a, f } = await sharedProject()
    await a.engine.setSelective('story_s', true)
    writeDocument(a, 'fold_notes', { type: 'folder', title: 'Notes', content: '', unshared: true })
    writeDocument(a, 'doc_note', { parentId: 'fold_notes', title: 'A note', unshared: false })
    await sync(a)
    await sync(f)
    expect(f.db.documents.get('fold_notes').title).toBe('Notes')

    writeDocument(f, 'doc_theirs', { parentId: 'fold_notes', title: 'Their note' })
    await sync(f)
    await sync(a)
    a.put('documents', { ...a.db.documents.get('doc_theirs'), content: 'Read by both.\n' })
    // The note on the way goes; the folder stays, for the friend's.
    a.put('documents', { ...a.db.documents.get('doc_note'), unshared: true })
    await sync(a)
    await sync(f)
    expect(f.db.documents.get('doc_theirs').content).toBe('Read by both.\n')
    expect(f.db.documents.has('doc_note')).toBe(false)
    expect(f.db.documents.has('fold_notes')).toBe(true)
  })

  it('has an owner’s device not yet told send nothing hidden as everyone’s', async () => {
    const { a, a2, f } = await sharedProject()
    await sync(f)
    // The second device edits the chapter before it hears it was hidden.
    a2.put('documents', { ...a2.db.documents.get('doc_s1'), content: 'Only for us.\n' })
    await a2.engine.noted()
    const stale = await a2.api.listing()
    const listing = a2.api.listing
    a2.api.listing = async () => {
      a2.api.listing = listing
      return stale
    }
    await a.engine.setSelective('story_s', true)
    a.put('documents', { ...a.db.documents.get('doc_s1'), unshared: true })
    await sync(a)
    await sync(a2)
    expect(await a2.waiting()).toEqual([])
    await sync(f)
    expect(f.db.documents.has('doc_s1')).toBe(false)
    await sync(a)
    expect(a.db.documents.get('doc_s1').content).toBe('Only for us.\n')
    expect(a.db.documents.get('doc_s1').unshared).toBe(true)
  })
})
