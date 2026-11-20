/**
 * @module apps/projects
 * @description The projects ticked for a connected app, by the names it asks
 * for them by, and a call run in one of them in this window.
 */

import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { heldProjects, holdsProject, letGoOfProject, takeProject } from '@/platform/windows.js'
import { saveNow } from '@/composables/useSaveBeforeClosing.js'

/** @typedef {import('@/platform/apps.js').AskingApp} AskingApp */

/**
 * A project as an app is told of it.
 * @typedef {{id: string, name: string, summary: string}} AppProject
 */

/** How much of a project's summary a listing of projects gives, in characters. */
const SUMMARY_MOST = 600

/** Where the writer ticks projects, for an answer that sends an app's user there. */
const WHERE = 'Settings › Connections › Connected apps'

/**
 * The projects an app may work in: those ticked for it that are still here
 * and out of the trash, by their names as they are now.
 *
 * @param {AskingApp} app
 * @returns {Promise<AppProject[]>}
 */
export async function projectsOf(app) {
  const stories = useStoriesStore()
  const documents = useDocumentsStore()
  await stories.ensureInitialized()
  // One ticked in another window since this one read the list: read it again.
  if (app.projects.some(id => !stories.getStory(id))) await stories.refresh(heldProjects())

  const ids = app.projects.filter(id => {
    const story = stories.getStory(id)
    return story && !story.trashed
  })
  // A project not in this window may have been renamed in another.
  await documents.refreshRoots(ids.filter(id => !holdsProject(id)))
  await documents.loadRoots(ids)
  return ids.map(id => {
    const root = documents.getRoot(id)
    const summary = (root?.summary || '').trim()
    return {
      id,
      name: root?.title?.trim() || 'Untitled',
      summary:
        summary.length > SUMMARY_MOST ? `${summary.slice(0, SUMMARY_MOST).trimEnd()}…` : summary,
    }
  })
}

/**
 * The project an app named, among its own, or why there is none: in words
 * for its model to act on.
 *
 * @param {AskingApp} app
 * @param {unknown} named - Its name, or nothing where the app has only one
 * @returns {Promise<AppProject|{error: string}>}
 */
export async function findProject(app, named) {
  const all = await projectsOf(app)
  if (all.length === 0) {
    return {
      error: `No project is open to this connection. The user ticks the projects it may work in, in inksprite: ${WHERE}.`,
    }
  }
  const listed = all.map(project => `"${project.name}"`).join(', ')
  if (typeof named !== 'string' || !named.trim()) {
    return all.length === 1 ? all[0] : { error: `Say which project. The projects are: ${listed}.` }
  }
  const wanted = named.trim()
  const found =
    all.find(project => project.name === wanted) ??
    all.find(project => project.name.toLowerCase() === wanted.toLowerCase())
  return found ?? { error: `No project named "${wanted}". The projects are: ${listed}.` }
}

/** How many calls have taken a project, for each to hold it under its own reason. */
let calls = 0

/** @type {Map<string, Promise<unknown>>} What is being done in each project, by its id */
const turns = new Map()

/**
 * Do something in a project, in this window, if this is the window to do it
 * in. The window that has the project open does it. With the project in no
 * window, this one takes it for as long as the work takes, as a job does
 * (`platform/windows.js`), reading it afresh if it hadn't had it, and saves
 * what the work wrote before letting go, for the next window to read. A
 * window that can't, because another has the project or has had it since
 * this one did, passes, and says which.
 *
 * What is done in one project is done one thing at a time, in the order
 * asked: an app sends several calls at once, and two that write must not
 * cross.
 *
 * @template T
 * @param {string} storyId
 * @param {() => Promise<T>} work
 * @returns {Promise<{value: T}|{pass: 'elsewhere'|'behind'}>}
 */
export function inProject(storyId, work) {
  const before = turns.get(storyId) ?? Promise.resolve()
  const done = before.then(() => holding(storyId, work))
  /** @type {Promise<void>} */
  const settled = done.then(
    () => {},
    () => {}
  )
  turns.set(storyId, settled)
  settled.then(() => {
    if (turns.get(storyId) === settled) turns.delete(storyId)
  })
  return done
}

/**
 * @template T
 * @param {string} storyId
 * @param {() => Promise<T>} work
 * @returns {Promise<{value: T}|{pass: 'elsewhere'|'behind'}>}
 */
async function holding(storyId, work) {
  const reason = /** @type {const} */ (`app:${++calls}`)
  const { held, stale, first } = await takeProject(storyId, reason)
  if (!held) return { pass: 'elsewhere' }
  let worked = false
  try {
    if (stale) return { pass: 'behind' }
    if (first) await useStoriesStore().readAfresh(storyId)
    worked = true
    return { value: await work() }
  } finally {
    // Open here, it stays, and is saved as anything typed in it is.
    if (worked && !holdsProject(storyId, 'open')) {
      await saveNow().catch(error => console.error('Failed to save a connected app’s work:', error))
    }
    letGoOfProject(storyId, reason)
  }
}
