/**
 * Which storage the app opens with: IndexedDB in a browser, and in the
 * desktop app, when the writer keeps the projects in a folder, the library
 * in the app's data folder, the app's own tables in IndexedDB still.
 *
 * The first time the desktop app opens on a library, the projects it kept
 * in the window until then are written into it, each as a project of its
 * own. The window's copy is left as it was. Keeping them in the app again
 * copies the library's back over it first, so nothing done since is lost.
 */

import { isDesktop } from '@/platform/desktop.js'
import {
  disableLibrary,
  libraryDisk,
  librarySettings,
  markProjectsMoved,
} from '@/platform/library.js'
import { dexieStorage } from './dexie.js'
import { libraryStorage } from './library.js'
import { PROJECT_TABLES, useStorage } from './index.js'

/** @typedef {import('./index.js').Storage} Storage */

/** @typedef {import('./library.js').ChangedElsewhere} ChangedElsewhere */

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

/**
 * Open the app's storage, before anything reads from it.
 *
 * @param {Object} [options]
 * @param {(path: string) => void} [options.onMoving] - Told when the window's projects are
 *   being moved into the library, which takes a moment
 * @returns {Promise<void>}
 */
export async function openStorage({ onMoving = () => {} } = {}) {
  if (!isDesktop()) return
  const settings = await librarySettings()
  if (!settings.enabled) return
  const library = libraryStorage(libraryDisk(), {
    onConflict: changed => listeners.forEach(listener => listener(changed)),
  })
  if (!settings.moved) {
    if ((await dexieStorage.stories()).length > 0) {
      onMoving(settings.path)
      await moveProjects(dexieStorage, library)
    }
    await markProjectsMoved()
  }
  useStorage(library)
}

/**
 * Write every project one storage holds into another. One the other holds
 * already is written over only when this copy was changed later: the app's
 * copy of a project kept in the app again for a while, say, and then put
 * back in the folder it was in. The copy written over goes to the trash.
 *
 * @param {Storage} from
 * @param {Storage} to
 */
export async function moveProjects(from, to) {
  const there = new Set((await to.stories()).map(story => story.id))
  for (const story of await from.stories()) {
    if (there.has(story.id)) {
      const theirs = await lastChanged(to, story.id)
      if ((await lastChanged(from, story.id)) <= theirs) continue
      await to.removeProject(story.id)
    }
    const chats = await from.chats(story.id)
    /** @type {import('../types/models.js').Message[]} */
    const messages = []
    for (const chat of chats) messages.push(...(await from.messages(chat.id)))
    await to.addProject({
      story,
      documents: await from.documents(story.id),
      files: await from.projectFiles(story.id),
      chats,
      messages,
    })
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
