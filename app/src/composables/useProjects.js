/**
 * @module composables/useProjects
 * @description The project list: every story, the one worked on most recently
 * first, and the actions the list offers on them. A project's name lives on
 * its root document, so the list loads those alongside the story records —
 * one keyed read, not a tree per project.
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
import { pushProjectToRoute } from '@/utils/routeHelpers'
import { dropJobsForStory } from '@/jobs/index.js'

/** @typedef {import('@/types/models.js').Story} Story */

/**
 * @returns {{
 *   projects: import('vue').ComputedRef<Story[]>,
 *   init: () => Promise<void>,
 *   nameOf: (storyId: string) => string,
 *   open: (storyId: string) => void,
 *   create: (title: string) => Promise<Story>,
 *   rename: (storyId: string, title: string) => Promise<void>,
 *   remove: (storyId: string) => Promise<void>,
 * }}
 */
export function useProjects() {
  const router = useRouter()
  const storiesStore = useStoriesStore()
  const documentsStore = useDocumentsStore()

  /** Every project, most recently worked on first. */
  const projects = computed(() => storiesStore.getAllStoriesOrdered())

  /** Load the story records and the root documents their names live on. */
  async function init() {
    await storiesStore.ensureInitialized()
    await documentsStore.loadRoots(projects.value.map(story => story.id))
  }

  /**
   * @param {string} storyId
   * @returns {string}
   */
  const nameOf = storyId => documentsStore.getRoot(storyId)?.title || 'Untitled'

  /**
   * Open a project. It opens on the document the writer left, which the
   * story remembers.
   * @param {string} storyId
   */
  const open = storyId => pushProjectToRoute(router, storyId)

  /**
   * Start a project and open it. A new project is empty, so the writer lands
   * on the invitation to make a first document.
   * @param {string} title
   * @returns {Promise<Story>}
   */
  async function create(title) {
    const story = await storiesStore.createStory(title)
    open(story.id)
    return story
  }

  /**
   * A project's name lives on its root node, the same one the tree renames.
   * @param {string} storyId
   * @param {string} title
   */
  const rename = async (storyId, title) => {
    await documentsStore.renameProject(storyId, title)
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

  return { projects, init, nameOf, open, create, rename, remove }
}
