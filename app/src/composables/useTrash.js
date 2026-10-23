/**
 * @module composables/useTrash
 * @description The trash, as the Trash dialog shows it: what a project's
 * trash holds of its documents and chats, and the projects in the trash, each
 * to restore or delete for good.
 *
 * What is in the trash stays 30 days, then goes as its project, its chats or
 * the list of projects load. See `utils/trash.js` and
 * `.llm/trash_design.md`.
 */

import { computed } from 'vue'
import { useDocuments } from './useDocuments.js'
import { useChats } from './useChats.js'
import { useProjects } from './useProjects.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { EPUB_MIME } from '@/files/inspect.js'
import { documentPath } from '@/utils/documentPath.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * Something in a project's trash.
 *
 * @typedef {Object} TrashItem
 * @property {'document'|'chat'} kind
 * @property {string} id
 * @property {string} title
 * @property {string} icon - A PrimeIcons class, as the outline or the chat list draws it
 * @property {string} where - The folder it was in, as a path; '' at the top of the project, or for a chat
 * @property {number} inside - How many documents went with it
 * @property {number} trashed - When it went
 */

/**
 * A project in the trash.
 *
 * @typedef {Object} TrashedProject
 * @property {string} id
 * @property {string} title
 * @property {number} trashed
 */

/**
 * What a document is drawn as: a folder, a page, or the kind of file it is.
 * @param {Document} document
 * @returns {string}
 */
const iconOf = document => {
  if (document.type === 'folder') return 'pi pi-folder'
  if (document.type !== 'file') return 'pi pi-file'
  const mime = document.mime || ''
  if (mime === 'application/pdf') return 'pi pi-file-pdf'
  if (mime.startsWith('image/')) return 'pi pi-image'
  if (mime === EPUB_MIME) return 'pi pi-book'
  return 'pi pi-file'
}

/**
 * @param {string|null} storyId - The project open, whose trash is shown; null with none open
 */
export function useTrash(storyId) {
  const documentsStore = useDocumentsStore()
  const documents = storyId ? useDocuments(storyId) : null
  const chats = storyId ? useChats(storyId) : null
  const projects = useProjects()
  // The chats in the trash are read with the rest of the project's.
  chats?.init().catch(error => console.error('Failed to read the chats for the trash:', error))

  /**
   * What this project's trash holds, the most recent first.
   * @type {import('vue').ComputedRef<TrashItem[]>}
   */
  const items = computed(() => {
    /** @type {TrashItem[]} */
    const out = []
    for (const document of documents?.trashed.value ?? []) {
      const folder = documentsStore.getDocument(document.parentId)
      const where =
        folder && folder.parentId !== storyId
          ? documentPath(documentsStore.getDocument, folder)
          : ''
      out.push({
        kind: 'document',
        id: document.id,
        title: documents?.displayTitle(document) ?? '',
        icon: iconOf(document),
        where,
        inside: documentsStore.trashedUnder(document.id).length,
        trashed: document.trashed ?? 0,
      })
    }
    for (const chat of chats?.trashedChats.value ?? []) {
      out.push({
        kind: 'chat',
        id: chat.id,
        title: chat.title,
        icon: 'pi pi-comments',
        where: '',
        inside: 0,
        trashed: chat.trashed ?? 0,
      })
    }
    return out.sort((a, b) => b.trashed - a.trashed)
  })

  /**
   * The projects in the trash, the most recent first.
   * @type {import('vue').ComputedRef<TrashedProject[]>}
   */
  const trashedProjects = computed(() =>
    projects.trashed.value.map(story => ({
      id: story.id,
      title: projects.nameOf(story.id),
      trashed: story.trashed ?? 0,
    }))
  )

  /** How much is in the trash, this project's and the projects. */
  const count = computed(() => items.value.length + trashedProjects.value.length)

  /**
   * Bring something back from this project's trash.
   * @param {TrashItem} item
   * @returns {Promise<void>}
   */
  const restore = async item => {
    if (item.kind === 'document') documents?.restore(item.id)
    else await chats?.restoreChat(item.id)
  }

  /**
   * Delete something in this project's trash for good.
   * @param {TrashItem} item
   * @returns {Promise<void>}
   */
  const deleteNow = async item => {
    if (item.kind === 'document') documents?.deleteTrashed(item.id)
    else await chats?.deleteTrashedChat(item.id)
  }

  /**
   * Bring a project back from the trash.
   * @param {string} id
   * @returns {Promise<void>}
   */
  const restoreProject = id => projects.restore(id)

  /**
   * Delete a project in the trash for good.
   * @param {string} id
   * @returns {Promise<void>}
   */
  const deleteProject = id => projects.remove(id)

  /**
   * Delete everything the trash shows for good: this project's, and the
   * projects in it.
   * @returns {Promise<void>}
   */
  const empty = async () => {
    for (const item of [...items.value]) await deleteNow(item)
    for (const project of [...trashedProjects.value]) await deleteProject(project.id)
  }

  return {
    items,
    trashedProjects,
    count,
    restore,
    deleteNow,
    restoreProject,
    deleteProject,
    empty,
  }
}
