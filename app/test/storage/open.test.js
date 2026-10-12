// @vitest-environment node
/* global Blob */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dexieStorage } from '@/storage/dexie.js'
import { libraryStorage } from '@/storage/library.js'
import { storage, useStorage } from '@/storage/index.js'
import {
  keepProjectsInApp,
  moveIntoLibrary,
  moveProjects,
  openStorage,
  projectsToMove,
} from '@/storage/open.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { memoryLibrary } from './memoryLibrary.js'

const platform = vi.hoisted(() => ({
  desktop: true,
  settings: { path: '/library', enabled: true, moved: false },
  disk: /** @type {any} */ (null),
}))
const library = vi.hoisted(() => ({
  librarySettings: vi.fn(async () => platform.settings),
  markProjectsMoved: vi.fn(async () => {}),
  enableLibrary: vi.fn(async () => '/library'),
  disableLibrary: vi.fn(async () => {}),
  libraryDisk: vi.fn(() => platform.disk),
}))
vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => platform.desktop }))
vi.mock('@/platform/library.js', () => library)

/** A project of one chapter and one chat, its times all `at`. */
function project(id, title, content, at) {
  const root = rootIdFor(id)
  const times = { version: 1, created: 1, updated: at }
  return {
    story: { id, overview: '', wordCount: 0, ...times },
    documents: [
      {
        id: root,
        storyId: id,
        parentId: id,
        type: 'folder',
        title,
        order: 0,
        ordered: false,
        summary: '',
        content: '',
        wordCount: 0,
        ...times,
      },
      {
        id: `${id}_ch1`,
        storyId: id,
        parentId: root,
        type: 'text',
        title: 'Chapter',
        order: 0,
        ordered: false,
        summary: '',
        content,
        wordCount: 1,
        ...times,
      },
    ],
    files: [],
    chats: [
      {
        id: `${id}_chat`,
        storyId: id,
        title: 'Planning',
        titleSet: true,
        lastMessageAt: at,
        ...times,
      },
    ],
    messages: [
      { id: `${id}_m1`, chatId: `${id}_chat`, role: 'user', content: 'Next?', created: at },
    ],
  }
}

const textOf = async (from, id) =>
  (await from.documents(id)).find(row => row.id === `${id}_ch1`)?.content

beforeEach(async () => {
  vi.clearAllMocks()
  await dexieStorage.replaceAll({})
  useStorage(dexieStorage)
  platform.desktop = true
  platform.settings = { path: '/library', enabled: true, moved: false }
  platform.disk = memoryLibrary().disk
})

describe('opening the storage', () => {
  it('stays on IndexedDB in a browser', async () => {
    platform.desktop = false
    await dexieStorage.addProject(project('story_a', 'Novel', 'Here.', 5))

    await openStorage()

    expect(library.librarySettings).not.toHaveBeenCalled()
    expect((await storage.stories()).map(row => row.id)).toEqual(['story_a'])
  })

  it('keeps the projects in the app while the folder is switched off', async () => {
    platform.settings = { path: '/library', enabled: false, moved: false }
    await dexieStorage.addProject(project('story_a', 'Novel', 'Here.', 5))

    await openStorage()

    expect(library.libraryDisk).not.toHaveBeenCalled()
    expect(library.markProjectsMoved).not.toHaveBeenCalled()
    expect(await textOf(storage, 'story_a')).toBe('Here.')
  })

  it('opens on the app’s own projects while they are still to be moved into the folder', async () => {
    await dexieStorage.addProject(project('story_a', 'Novel', 'Here.', 5))

    await openStorage()

    expect(projectsToMove()).toBe(true)
    expect(library.libraryDisk).not.toHaveBeenCalled()
    expect(library.markProjectsMoved).not.toHaveBeenCalled()
    expect(await textOf(storage, 'story_a')).toBe('Here.')
  })

  it('opens on the folder at once when the app has no projects to move', async () => {
    await libraryStorage(platform.disk).addProject(project('story_a', 'Novel', 'Kept.', 5))

    await openStorage()

    expect(projectsToMove()).toBe(false)
    expect(library.markProjectsMoved).toHaveBeenCalled()
    expect(await textOf(storage, 'story_a')).toBe('Kept.')
  })

  it('opens on the folder once the projects are in it', async () => {
    platform.settings = { path: '/library', enabled: true, moved: true }
    await dexieStorage.addProject(project('story_a', 'Novel', 'In the app.', 5))
    await libraryStorage(platform.disk).addProject(project('story_a', 'Novel', 'Moved.', 5))

    await openStorage()

    expect(projectsToMove()).toBe(false)
    expect(await textOf(storage, 'story_a')).toBe('Moved.')
  })
})

describe('moving the projects into the folder', () => {
  it('turns the folder on, and moves them in saying how far it has got', async () => {
    const novel = project('story_a', 'Novel', 'Here.', 5)
    for (const n of [2, 3, 4]) {
      novel.documents.push({ ...novel.documents[1], id: `story_a_ch${n}`, title: `Chapter ${n}` })
    }
    await dexieStorage.addProject(novel)
    await dexieStorage.addProject(project('story_b', 'Notes', 'There.', 5))
    /** @type {any[]} */
    const told = []

    await moveIntoLibrary(progress => told.push(progress))

    expect(library.enableLibrary.mock.invocationCallOrder[0]).toBeLessThan(
      library.libraryDisk.mock.invocationCallOrder[0]
    )
    expect(library.markProjectsMoved).toHaveBeenCalled()
    expect(await platform.disk.projects()).toMatchObject({ projects: ['Notes', 'Novel'] })
    expect(told.map(progress => progress.title)).toEqual(expect.arrayContaining(['Novel', 'Notes']))
    expect(told.every(progress => progress.count === 2)).toBe(true)
    const fractions = told.map(progress => progress.fraction)
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    expect(fractions.at(-1)).toBe(1)
    // The novel, of five documents and a chat, is two thirds of the move.
    expect(told.find(progress => progress.title === 'Notes').fraction).toBeCloseTo(2 / 3)
    expect(await textOf(dexieStorage, 'story_a')).toBe('Here.')
  })

  it('keeps them in the app when they cannot be moved', async () => {
    await dexieStorage.addProject(project('story_a', 'Novel', 'Here.', 5))
    platform.disk = {
      ...platform.disk,
      apply: async () => {
        throw new Error('disk full')
      },
    }

    await expect(moveIntoLibrary()).rejects.toThrow('disk full')
    expect(library.disableLibrary).toHaveBeenCalled()
    expect(library.markProjectsMoved).not.toHaveBeenCalled()
  })
})

describe('moving projects', () => {
  it('writes over a copy already there only when its own was changed later', async () => {
    const memory = memoryLibrary()
    const folder = libraryStorage(memory.disk)
    await folder.addProject(project('story_a', 'Novel', 'Old.', 5))
    await folder.addProject(project('story_b', 'Notes', 'Newer in the folder.', 50))
    await dexieStorage.addProject(project('story_a', 'Novel', 'Edited in the app.', 9))
    await dexieStorage.addProject(project('story_b', 'Notes', 'Older in the app.', 10))

    await moveProjects(dexieStorage, folder)

    const again = libraryStorage(memory.disk)
    expect(await textOf(again, 'story_a')).toBe('Edited in the app.')
    expect(await textOf(again, 'story_b')).toBe('Newer in the folder.')
    expect(memory.trashed).toEqual(['Novel'])
  })
})

describe('keeping the projects in the app again', () => {
  it('copies the folder’s projects over the app’s, and leaves the app’s own tables', async () => {
    const memory = memoryLibrary()
    const folder = libraryStorage(memory.disk)
    await dexieStorage.addProject(project('story_a', 'Novel', 'Before the move.', 5))
    await dexieStorage.addProject(project('story_gone', 'Gone', 'Deleted since.', 5))
    await dexieStorage.put('projectViews', {
      id: 'story_a',
      lastDocumentId: 'story_a_ch1',
      version: 1,
      updated: 5,
    })
    await folder.addProject(project('story_a', 'Novel', 'Written in the folder.', 20))

    await keepProjectsInApp(folder)

    expect((await dexieStorage.stories()).map(row => row.id)).toEqual(['story_a'])
    expect(await textOf(dexieStorage, 'story_a')).toBe('Written in the folder.')
    expect((await dexieStorage.messages('story_a_chat')).map(row => row.content)).toEqual(['Next?'])
    expect(await dexieStorage.get('projectViews', 'story_a')).toMatchObject({
      lastDocumentId: 'story_a_ch1',
    })
    expect(library.disableLibrary).toHaveBeenCalled()
    expect(memory.outside.list()).toContain('Novel/Chapter.md')
  })

  it('stays on the folder when the copy fails', async () => {
    const folder = {
      dump: vi.fn(async () => {
        throw new Error('unreadable')
      }),
    }

    await expect(keepProjectsInApp(/** @type {any} */ (folder))).rejects.toThrow('unreadable')
    expect(library.disableLibrary).not.toHaveBeenCalled()
  })
})

describe('removing a project from IndexedDB', () => {
  it('takes its story, documents, bytes, chats and messages, and no other project’s', async () => {
    await dexieStorage.addProject(project('story_a', 'Novel', 'A.', 5))
    await dexieStorage.addProject(project('story_b', 'Notes', 'B.', 5))
    await dexieStorage.putFileBytes('story_a_ch1', 'story_a', new Blob(['bytes']))

    await dexieStorage.removeProject('story_a')

    expect((await dexieStorage.stories()).map(row => row.id)).toEqual(['story_b'])
    expect(await dexieStorage.documents('story_a')).toEqual([])
    expect(await dexieStorage.projectFiles('story_a')).toEqual([])
    expect(await dexieStorage.chats('story_a')).toEqual([])
    expect(await dexieStorage.messages('story_a_chat')).toEqual([])
    expect(await dexieStorage.messages('story_b_chat')).toHaveLength(1)
  })
})
