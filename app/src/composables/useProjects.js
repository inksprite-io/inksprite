/**
 * @module composables/useProjects
 * @description Every project, and starting, importing, opening, trashing and
 * deleting them. A project's name, and when it was last edited, live on its root
 * document, so the list loads those alongside the story records — one keyed
 * read, not a tree per project.
 *
 * In the desktop app a project is open in one window at a time
 * (`platform/windows.js`), and one open in another window is shown there.
 * The list is read again once another window or tab has changed it, when it
 * is next wanted.
 *
 * @example
 * const projects = useProjects()
 * await projects.init()
 * projects.open(projects.projects.value[0].id)
 */

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useSyncStore } from '@/stores/syncStore'
import { storage } from '@/storage/index.js'
import { useBackup } from '@/composables/useBackup'
import { projectName } from '@/utils/backup.js'
import { goToProject } from '@/utils/routeHelpers'
import { dropJobsForStory } from '@/jobs/index.js'
import { askToKeepData } from '@/platform/persistence.js'
import { expired } from '@/utils/trash.js'
import { mayHoldProject, packageOfZip } from '@/scrivener/package.js'
import { isArchive } from '@/utils/backupArchive.js'
import { openProject, writeProject } from '@/scrivener/project.js'
import {
  askForProject,
  heldProjects,
  onNotice,
  openWindow,
  projectsElsewhere,
} from '@/platform/windows.js'

/** @typedef {import('@/types/models.js').Story} Story */

/**
 * @returns {{
 *   projects: import('vue').ComputedRef<Story[]>,
 *   init: () => Promise<void>,
 *   nameOf: (storyId: string) => string,
 *   editedOf: (storyId: string) => number|undefined,
 *   open: (storyId: string) => Promise<void>,
 *   openInNewWindow: (storyId?: string) => Promise<void>,
 *   elsewhere: import('vue').Ref<Set<string>>,
 *   lookElsewhere: () => Promise<void>,
 *   refresh: () => Promise<void>,
 *   create: (title: string, options?: {open?: boolean}) => Promise<Story>,
 *   importFile: (file: File) => Promise<Story>,
 *   remove: (storyId: string) => Promise<void>,
 *   trashed: import('vue').ComputedRef<Story[]>,
 *   trash: (storyId: string) => Promise<void>,
 *   restore: (storyId: string) => Promise<void>,
 * }}
 */
export function useProjects() {
  const router = useRouter()
  const storiesStore = useStoriesStore()
  const documentsStore = useDocumentsStore()
  const backup = useBackup()

  /** Every project, most recently worked on first. */
  const projects = computed(() => storiesStore.getAllStoriesOrdered())

  /** The projects in the trash, the most recent first. */
  const trashed = computed(() => storiesStore.trashedStories())

  /**
   * Load the story records and the root documents their names live on, and
   * work out when each project was last edited where its root does not say.
   * With a project to keep, the browser is asked to keep the page's data.
   * Once a session, a project 30 days in the trash goes for good.
   */
  async function init() {
    await storiesStore.ensureInitialized()
    if (!sweptTrash) {
      sweptTrash = true
      for (const story of trashed.value) if (expired(story)) await remove(story.id)
    }
    const storyIds = projects.value.map(story => story.id)
    if (storyIds.length > 0) askToKeepData()
    await documentsStore.loadRoots([...storyIds, ...trashed.value.map(story => story.id)])
    await workOutEdited(storyIds.filter(id => documentsStore.getRoot(id) && !editedOf(id)))
  }

  /**
   * When projects whose roots were written before the time was kept were last
   * edited: the latest of their documents' times and their chats', which
   * move with every message. Each project is read whole for it, once; the
   * root keeps the answer.
   *
   * @param {string[]} storyIds
   */
  async function workOutEdited(storyIds) {
    for (const storyId of storyIds) {
      if (workingOut.has(storyId)) continue
      workingOut.add(storyId)
      try {
        let at = 0
        for (const row of [
          ...(await storage.documents(storyId)),
          ...(await storage.chats(storyId)),
        ]) {
          at = Math.max(at, row.updated || 0)
        }
        if (at > 0) documentsStore.markEdited(storyId, at)
      } catch (error) {
        console.error(`Failed to work out when ${storyId} was last edited:`, error)
      } finally {
        workingOut.delete(storyId)
      }
    }
  }

  /**
   * @param {string} storyId
   * @returns {string}
   */
  const nameOf = storyId => documentsStore.getRoot(storyId)?.title || 'Untitled'

  /**
   * When something in a project last changed, to the minute. Nothing for a
   * project whose root does not say yet; `init` works it out.
   * @param {string} storyId
   * @returns {number|undefined}
   */
  const editedOf = storyId => documentsStore.getRoot(storyId)?.edited

  /**
   * Open a project. It opens on the document the writer left, which the
   * story remembers. In the desktop app, one open in another window is shown
   * there instead.
   * @param {string} storyId
   * @returns {Promise<void>}
   */
  const open = storyId => goToProject(router, storyId)

  /**
   * Open a project in a window of its own, or with none the project there
   * finds for itself. One open in another window already is shown there.
   * @param {string} [storyId]
   * @returns {Promise<void>}
   */
  const openInNewWindow = async storyId => {
    if (!storyId) return openWindow()
    if ((await projectsElsewhere()).has(storyId)) askForProject(storyId)
    else await openWindow(`/project/${storyId}`)
  }

  /** Find out which projects are open in other windows, for the list. */
  const lookElsewhere = async () => {
    elsewhere.value = await projectsElsewhere()
  }

  /**
   * Read the list of projects again if another window has changed it since:
   * a project come, gone or renamed there. The projects this window holds are
   * its own and stay as they are, and what it has yet to save is saved
   * first, so that a project it has just made is not taken for gone.
   * @returns {Promise<void>}
   */
  async function refresh() {
    if (!listChanged) return
    listChanged = false
    await useSyncStore().processSync()
    const keep = heldProjects()
    await storage.refreshProjects(keep)
    await storiesStore.refresh(keep)
    await documentsStore.refreshRoots(
      projects.value.map(story => story.id).filter(id => !keep.includes(id))
    )
  }

  /**
   * Start a project and open it. A new project is empty, so the writer lands
   * on the invitation to make a first document. Two projects of one name are
   * two rows nobody can tell apart, so a name already taken is numbered.
   * One with something to be put in it first is opened by the caller once
   * it has been.
   * @param {string} title
   * @param {{open?: boolean}} [options]
   * @returns {Promise<Story>}
   */
  async function create(title, { open: opening = true } = {}) {
    await refresh()
    await storiesStore.loadNames()
    const story = await storiesStore.createStory(storiesStore.freeName(title))
    askToKeepData()
    if (opening) await open(story.id)
    return story
  }

  /**
   * Add a project file, exported from a project's menu, beside the others
   * with ids of its own, and open it. A project brought back beside the one
   * it was exported from is numbered, so the two can be told apart. A `.scriv`,
   * or a zip without a backup in it, is a Scrivener project.
   * @param {File} file
   * @returns {Promise<Story>}
   */
  async function importFile(file) {
    if (mayHoldProject(file) && !(await isArchive(file))) return importScrivener(file)
    const project = await backup.readProjectFile(file)
    await refresh()
    await storiesStore.loadNames()
    const story = await backup.importProject(project, {
      title: storiesStore.freeName(projectName(project)),
    })
    askToKeepData()
    await open(story.id)
    return story
  }

  /**
   * Make a project of a Scrivener project, named after it, and open it. A
   * `.scriv` chosen as a file comes zipped by the browser; one that came as
   * the folder it is cannot be read, and the writer can zip it themselves.
   * The project is read and checked before anything is made.
   * @param {File} file
   * @returns {Promise<Story>}
   */
  async function importScrivener(file) {
    const pack = await packageOfZip(file)
    if (!pack && /\.scriv$/i.test(file.name)) {
      throw new Error('This project could not be read. Compress it in Finder, then import the zip.')
    }
    if (!pack) throw new Error('There is no Scrivener project in this zip.')
    const project = await openProject(pack)
    await refresh()
    await storiesStore.loadNames()
    const story = await storiesStore.createStory(storiesStore.freeName(project.name))
    await writeProject(story.id, project)
    askToKeepData()
    await open(story.id)
    return story
  }

  /**
   * Delete a project and everything in it. Its jobs go first: one running
   * would otherwise go on asking about a document that is gone. They are
   * dropped here rather than in the store's cascade, which would make the
   * stores depend on the jobs that depend on them.
   *
   * @param {string} storyId
   * @returns {Promise<void>}
   */
  const remove = async storyId => {
    await dropJobsForStory(storyId)
    await storiesStore.deleteStory(storyId)
  }

  /**
   * Move a project to the trash, whole. Its jobs go, as on a delete: there is
   * no one to answer them while it is there. See `utils/trash.js`.
   *
   * @param {string} storyId
   * @returns {Promise<void>}
   */
  const trash = async storyId => {
    await dropJobsForStory(storyId)
    await storiesStore.trashStory(storyId)
  }

  /**
   * Bring a project back from the trash, under a name no other project has
   * taken since.
   *
   * @param {string} storyId
   * @returns {Promise<void>}
   */
  const restore = async storyId => {
    await storiesStore.restoreStory(storyId)
    await documentsStore.loadRoots([storyId])
    const name = nameOf(storyId)
    const free = storiesStore.freeName(name, storyId)
    if (free !== name) await documentsStore.renameProject(storyId, free)
  }

  return {
    projects,
    init,
    nameOf,
    editedOf,
    open,
    openInNewWindow,
    elsewhere,
    lookElsewhere,
    refresh,
    create,
    importFile,
    remove,
    trashed,
    trash,
    restore,
  }
}

/** The projects open in other windows, as last looked. */
const elsewhere = ref(/** @type {Set<string>} */ (new Set()))

/** Whether another window has changed the list of projects since it was read. */
let listChanged = false
onNotice('projects', () => {
  listChanged = true
})

/** Projects whose last edit is being worked out, so that it is read only once. */
const workingOut = new Set()

/** Whether this session has let go of the projects 30 days in the trash. */
let sweptTrash = false
