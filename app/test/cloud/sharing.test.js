// @vitest-environment node
/* global crypto */
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
 * @param {string} display - The name it shows the people it shares with
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
  await device.engine.setDisplay(display)
  return {
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
