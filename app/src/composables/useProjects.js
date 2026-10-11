/**
 * @module composables/useProjects
 * @description Every project, and starting, importing, opening and deleting
 * them. A project's name, and when it was last edited, live on its root
 * document, so the list loads those alongside the story records — one keyed
 * read, not a tree per project.
 *
 * @example
 * const projects = useProjects()
 * await projects.init()
 * projects.open(projects.projects.value[0].id)
 */

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import db from '@/stores/db'
import { useBackup } from '@/composables/useBackup'
import { pushProjectToRoute } from '@/utils/routeHelpers'
import { dropJobsForStory } from '@/jobs/index.js'
import { askToKeepData } from '@/platform/persistence.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/** @typedef {import('@/types/models.js').Story} Story */

/**
 * @returns {{
 *   projects: import('vue').ComputedRef<Story[]>,
 *   init: () => Promise<void>,
 *   nameOf: (storyId: string) => string,
 *   editedOf: (storyId: string) => number|undefined,
 *   open: (storyId: string) => void,
 *   create: (title: string) => Promise<Story>,
 *   importFile: (file: File) => Promise<Story>,
 *   remove: (storyId: string) => Promise<void>,
 * }}
 */
export function useProjects() {
  const router = useRouter()
  const storiesStore = useStoriesStore()
  const documentsStore = useDocumentsStore()
  const backup = useBackup()

  /** Every project, most recently worked on first. */
  const projects = computed(() => storiesStore.getAllStoriesOrdered())

  /**
   * Load the story records and the root documents their names live on, and
   * work out when each project was last edited where its root does not say.
   * With a project to keep, the browser is asked to keep the page's data.
   */
  async function init() {
    await storiesStore.ensureInitialized()
    const storyIds = projects.value.map(story => story.id)
    if (storyIds.length > 0) askToKeepData()
    await documentsStore.loadRoots(storyIds)
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
        await db.documents
          .where('storyId')
          .equals(storyId)
          .each(document => (at = Math.max(at, document.updated || 0)))
        await db.chats
          .where('storyId')
          .equals(storyId)
          .each(chat => (at = Math.max(at, chat.updated || 0)))
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
   * story remembers.
   * @param {string} storyId
   */
  const open = storyId => pushProjectToRoute(router, storyId)

  /**
   * Start a project and open it. A new project is empty, so the writer lands
   * on the invitation to make a first document. Two projects of one name are
   * two rows nobody can tell apart, so a name already taken is numbered.
   * @param {string} title
   * @returns {Promise<Story>}
   */
  async function create(title) {
    await storiesStore.loadNames()
    const story = await storiesStore.createStory(storiesStore.freeName(title))
    askToKeepData()
    open(story.id)
    return story
  }

  /**
   * What a project file calls its project: the title on its root.
   * @param {import('@/utils/backup.js').ProjectRows} project
   * @returns {string}
   */
  const nameInFile = project =>
    project.documents.find(document => document.id === rootIdFor(project.story.id))?.title ||
    'Untitled'

  /**
   * Add a project file, exported from a project's menu, beside the others
   * with ids of its own, and open it. A project brought back beside the one
   * it was exported from is numbered, so the two can be told apart.
   * @param {File} file
   * @returns {Promise<Story>}
   */
  async function importFile(file) {
    const project = await backup.readProjectFile(file)
    await storiesStore.loadNames()
    const story = await backup.importProject(project, {
      title: storiesStore.freeName(nameInFile(project)),
    })
    askToKeepData()
    open(story.id)
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

  return { projects, init, nameOf, editedOf, open, create, importFile, remove }
}

/** Projects whose last edit is being worked out, so that it is read only once. */
const workingOut = new Set()
