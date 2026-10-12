/**
 * Which storage the app opens with: IndexedDB in a browser, and in the
 * desktop app, when the writer keeps the projects in a folder, the library
 * in the app's data folder, the app's own tables in IndexedDB still.
 *
 * The projects the app kept until then are moved into the library with the
 * app open, so that it can say how far they are: when the writer turns the
 * folder on, and when the app opens on a library its projects have not been
 * moved into yet — a run from the checkout the first time, or an app closed
 * during a move. Each is written into it as a project of its own, and the
 * app's copy is left as it was. Keeping them in the app again copies the
 * library's back over it first, so nothing done since is lost.
 */

import { isDesktop } from '@/platform/desktop.js'
import {
  disableLibrary,
  enableLibrary,
  libraryDisk,
  librarySettings,
  markProjectsMoved,
} from '@/platform/library.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { dexieStorage } from './dexie.js'
import { libraryStorage } from './library.js'
import { PROJECT_TABLES, useStorage } from './index.js'

/** @typedef {import('./index.js').Storage} Storage */

/** @typedef {import('./library.js').ChangedElsewhere} ChangedElsewhere */

/**
 * How far a move of the projects has got.
 * @typedef {Object} MoveProgress
 * @property {string} title - The project being moved
 * @property {number} index - Which of them it is, from 0
 * @property {number} count - How many there are
 * @property {number} fraction - How much of the whole move is done, from 0 to 1
 */

/** @type {Set<(changed: ChangedElsewhere[]) => void>} */
const listeners = new Set()

/**
 * Hear of files changed somewhere else that the app put in the trash before
 * writing over them.
 *
 * @param {(changed: ChangedElsewhere[]) => void} listener
 * @returns {() => void} Stops listening
 */
export function onChangedElsewhere(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The library as storage. */
const openLibrary = () =>
  libraryStorage(libraryDisk(), {
    onConflict: changed => listeners.forEach(listener => listener(changed)),
  })

/** Whether the app opened on its own projects, which are to be moved into the library. */
let toMove = false

/**
 * Open the app's storage, before anything reads from it.
 *
 * @returns {Promise<void>}
 */
export async function openStorage() {
  toMove = false
  if (!isDesktop()) return
  const settings = await librarySettings()
  if (!settings.enabled) return
  if (!settings.moved) {
    if ((await dexieStorage.stories()).length > 0) {
      toMove = true
      return
    }
    await markProjectsMoved()
  }
  useStorage(openLibrary())
}

/**
 * Whether the app opened on projects of its own that are to be moved into
 * the library, with `moveIntoLibrary`.
 */
export const projectsToMove = () => toMove

/**
 * Keep the projects in the library from now on, and move the app's own into
 * it. The app is to open again after, on the library. A move that fails
 * leaves them kept in the app: those moved before it are in the library,
 * and the next move passes over them unless they have changed since.
 *
 * @param {(progress: MoveProgress) => void} [onProgress]
 * @returns {Promise<void>}
 */
export async function moveIntoLibrary(onProgress) {
  await enableLibrary()
  try {
    await moveProjects(dexieStorage, openLibrary(), onProgress)
    await markProjectsMoved()
  } catch (error) {
    // Were even this to fail, the app would open on its own projects again,
    // and move them in then.
    await disableLibrary().catch(() => {})
    throw error
  }
}

/**
 * Write every project one storage holds into another. One the other holds
 * already is written over only when this copy was changed later: the app's
 * copy of a project kept in the app again for a while, say, and then put
 * back in the folder it was in. The copy written over goes to the trash.
 *
 * @param {Storage} from
 * @param {Storage} to
 * @param {(progress: MoveProgress) => void} [onProgress]
 */
export async function moveProjects(from, to, onProgress = () => {}) {
  const there = new Set((await to.stories()).map(story => story.id))
  const stories = await from.stories()
  // Each project's share of the move is as many documents and chats as it has.
  const shares = []
  for (const story of stories) {
    shares.push((await from.documents(story.id)).length + (await from.chats(story.id)).length)
  }
  const whole = shares.reduce((sum, share) => sum + share, 0) || 1
  let before = 0
  for (const [index, story] of stories.entries()) {
    const start = before
    before += shares[index]
    const documents = await from.documents(story.id)
    const root = documents.find(document => document.id === rootIdFor(story.id))
    /** @param {number} part - How much of this project is done */
    const told = part =>
      onProgress({
        title: root?.title || 'Untitled',
        index,
        count: stories.length,
        fraction: (start + part * shares[index]) / whole,
      })
    told(0)
    if (there.has(story.id)) {
      const theirs = await lastChanged(to, story.id)
      if ((await lastChanged(from, story.id)) <= theirs) continue
      await to.removeProject(story.id)
    }
    const chats = await from.chats(story.id)
    /** @type {import('../types/models.js').Message[]} */
    const messages = []
    for (const chat of chats) messages.push(...(await from.messages(chat.id)))
    await to.addProject(
      { story, documents, files: await from.projectFiles(story.id), chats, messages },
      (done, total) => told(total ? done / total : 1)
    )
  }
}

/**
 * When anything in a project last changed: its story, a document, a chat or
 * a message in one.
 *
 * @param {Storage} storage
 * @param {string} storyId
 * @returns {Promise<number>}
 */
async function lastChanged(storage, storyId) {
  let at = (await storage.story(storyId))?.updated || 0
  for (const document of await storage.documents(storyId)) at = Math.max(at, document.updated || 0)
  for (const chat of await storage.chats(storyId)) {
    at = Math.max(at, chat.updated || 0, chat.lastMessageAt || 0)
  }
  return at
}

/**
 * Keep the projects in the app again: the library's copy of every project,
 * as it is now, takes the place of the app's own, and the library is let go
 * of. Its files stay where they are. The app is to open again after; until
 * then the library is still the storage, and a copy that fails leaves it so.
 *
 * @param {Storage} library - The storage open on the library
 */
export async function keepProjectsInApp(library) {
  const tables = await library.dump()
  /** @type {Record<string, any[]>} */
  const projects = {}
  for (const table of PROJECT_TABLES) projects[table] = tables[table] || []
  const own = Object.keys(tables).filter(
    table => !PROJECT_TABLES.includes(/** @type {any} */ (table))
  )
  await dexieStorage.replaceAll(projects, own)
  await disableLibrary()
}
