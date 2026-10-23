/**
 * Which storage the app opens with: IndexedDB in a browser, and in the
 * desktop app the library in the app's data folder for the projects, the
 * app's own tables in IndexedDB still.
 *
 * The projects the desktop app kept in IndexedDB before it had a library
 * are moved into it with the app open, so that it can say how far they are:
 * the first time it opens with one, and again if it was closed during the
 * move. Each is written into the library as a project of its own, and
 * IndexedDB's copy is left as it was.
 */

import { isDesktop } from '@/platform/desktop.js'
import { libraryDisk, librarySettings, markProjectsMoved } from '@/platform/library.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { dexieStorage } from './dexie.js'
import { libraryStorage } from './library.js'
import { useStorage } from './index.js'

/** @typedef {import('./index.js').Storage} Storage */

/**
 * How far a move of the projects has got.
 * @typedef {Object} MoveProgress
 * @property {string} title - The project being moved
 * @property {number} index - Which of them it is, from 0
 * @property {number} count - How many there are
 * @property {number} fraction - How much of the whole move is done, from 0 to 1
 */

/**
 * The library as storage. A file changed somewhere else goes to the trash
 * before the app's version is written over it, without a word: the app's
 * version is the one the writer has in front of them.
 */
const openLibrary = () => libraryStorage(libraryDisk())

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
 * Move the app's own projects into the library. The app is to open again
 * after, on the library. A move that fails leaves them kept in the app,
 * which moves them in again the next time it opens: those moved before it
 * are in the library, and are passed over unless they have changed since.
 *
 * @param {(progress: MoveProgress) => void} [onProgress]
 * @returns {Promise<void>}
 */
export async function moveIntoLibrary(onProgress) {
  await moveProjects(dexieStorage, openLibrary(), onProgress)
  await markProjectsMoved()
}

/**
 * Write every project one storage holds into another. One the other holds
 * already is written over only when this copy was changed later: a project
 * moved back into the app while the desktop app had a switch for the folder,
 * and changed there since. The copy written over goes to the trash, and so
 * does one only the other holds, which was deleted here since it was moved
 * back.
 *
 * @param {Storage} from
 * @param {Storage} to
 * @param {(progress: MoveProgress) => void} [onProgress]
 */
export async function moveProjects(from, to, onProgress = () => {}) {
  const there = new Set((await to.stories()).map(story => story.id))
  const stories = await from.stories()
  const here = new Set(stories.map(story => story.id))
  for (const id of there) if (!here.has(id)) await to.removeProject(id)
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
