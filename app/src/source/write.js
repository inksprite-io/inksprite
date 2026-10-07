/**
 * @module source/write
 * @description A codebase written into the tree as a repository, and settled
 * against its source again on a refresh.
 *
 * Each file is a file document titled with its filename, extension and all,
 * whose `content` is its text and which has no bytes stored beside it: the
 * text is the file. Folders are made as the paths need them. The tree fills
 * in as it goes, and the loop gives the page a moment every few hundred
 * files so it can show it.
 *
 * A refresh goes by path. A file whose text is the same is left alone; one
 * whose text changed is updated in place, so it keeps its id, its marks in
 * each chat, and a chat that read it is told it changed; one that is gone
 * is removed, and a folder it leaves empty goes with it.
 */

import { useDocuments } from '@/composables/useDocuments.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { languageOf } from './language.js'

/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {import('@/types/models.js').RepositorySource} RepositorySource */
/** @typedef {import('./gather.js').SourceFile} SourceFile */

/** How many files are written between breaths. */
const BATCH = 200

const breathe = () => new Promise(resolve => setTimeout(resolve, 0))

/** @param {string} path */
const nameOf = path => path.slice(path.lastIndexOf('/') + 1)

/** @param {string} path */
const folderOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/**
 * What a repository holds, by path below it: its files and its folders.
 *
 * @param {(parentId: string) => Document[]} childrenOf
 * @param {string} folderId
 * @returns {{files: Map<string, Document>, folders: Map<string, Document>}}
 */
export function contentsOf(childrenOf, folderId) {
  /** @type {Map<string, Document>} */
  const files = new Map()
  /** @type {Map<string, Document>} */
  const folders = new Map()
  const walk = (/** @type {string} */ id, /** @type {string} */ prefix) => {
    for (const child of childrenOf(id)) {
      const path = prefix ? `${prefix}/${child.title}` : child.title
      if (child.type === 'folder') {
        folders.set(path, child)
        walk(child.id, path)
      } else files.set(path, child)
    }
  }
  walk(folderId, '')
  return { files, folders }
}

/**
 * The function that finds or makes the folder for a path, under a repository.
 *
 * @param {string} storyId
 * @param {string} rootId - The repository folder
 * @param {Map<string, Document>} folders - What is there already, by path; added to
 * @returns {(path: string) => string} The folder's id
 */
function foldersUnder(storyId, rootId, folders) {
  const store = useDocumentsStore()
  /** @type {Map<string, string>} */
  const ids = new Map([
    ['', rootId],
    ...[...folders].map(([path, doc]) => /** @type {[string, string]} */ ([path, doc.id])),
  ])
  const folderFor = (/** @type {string} */ path) => {
    const known = ids.get(path)
    if (known) return known
    const made = store.createDocument({
      storyId,
      parentId: folderFor(folderOf(path)),
      type: 'folder',
      title: nameOf(path),
    })
    ids.set(path, made.id)
    return made.id
  }
  return folderFor
}

/**
 * @param {string} storyId
 * @param {string} parentId
 * @param {SourceFile} file
 */
function createFile(storyId, parentId, file) {
  return useDocumentsStore().createDocument({
    storyId,
    parentId,
    type: 'file',
    title: nameOf(file.path),
    content: file.text,
    mime: languageOf(nameOf(file.path)).mime,
    size: file.size,
  })
}

/**
 * Write a codebase into the tree as a new repository folder.
 *
 * @param {string} storyId
 * @param {Object} options
 * @param {string} [options.parentId] - The folder it goes in; the project's top otherwise
 * @param {string} options.title - What to call the folder; made unique among its siblings
 * @param {RepositorySource} options.source
 * @param {SourceFile[]} options.files
 * @param {AbortSignal} [options.signal] - Stops between files; what was written stays
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{folderId: string, files: number}>}
 */
export async function writeRepository(
  storyId,
  { parentId, title, source, files, signal, onProgress }
) {
  const api = useDocuments(storyId)
  await api.init()
  const parent = parentId || rootIdFor(storyId)
  const folder = useDocumentsStore().createDocument({
    storyId,
    parentId: parent,
    type: 'folder',
    kind: 'repository',
    title: api.uniqueTitle(parent, title),
    source,
  })

  const folderFor = foldersUnder(storyId, folder.id, new Map())
  for (const [at, file] of files.entries()) {
    if (at % BATCH === 0) {
      await breathe()
      signal?.throwIfAborted()
    }
    createFile(storyId, folderFor(folderOf(file.path)), file)
    onProgress?.(at + 1, files.length)
  }
  return { folderId: folder.id, files: files.length }
}

/**
 * What a refresh changed.
 *
 * @typedef {Object} Refreshed
 * @property {number} added
 * @property {number} updated
 * @property {number} removed
 * @property {number} unchanged
 */

/**
 * Settle a repository against its source as it is now.
 *
 * @param {string} storyId
 * @param {string} folderId - The repository folder
 * @param {Object} options
 * @param {RepositorySource} options.source - Where it was read from this time
 * @param {SourceFile[]} options.files
 * @param {AbortSignal} [options.signal]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<Refreshed>}
 */
export async function refreshRepository(storyId, folderId, { source, files, signal, onProgress }) {
  const api = useDocuments(storyId)
  await api.init()
  const store = useDocumentsStore()
  const existing = contentsOf(api.childrenOf, folderId)
  /** @type {Refreshed} */
  const result = { added: 0, updated: 0, removed: 0, unchanged: 0 }

  // A path that was a folder and is now a file, or the other way about, is
  // cleared first, so the walk below finds nothing in its way.
  const incoming = new Set(files.map(file => file.path))
  for (const [path, folder] of existing.folders) {
    if (incoming.has(path)) {
      result.removed += api.remove(folder.id)
      existing.folders.delete(path)
    }
  }

  const folderFor = foldersUnder(storyId, folderId, existing.folders)
  for (const [at, file] of files.entries()) {
    if (at % BATCH === 0) {
      await breathe()
      signal?.throwIfAborted()
    }
    const there = existing.files.get(file.path)
    if (there && store.getDocument(there.id)) {
      if (there.content === file.text) result.unchanged++
      else {
        store.updateDocument(there.id, { content: file.text, size: file.size })
        result.updated++
      }
    } else {
      createFile(storyId, folderFor(folderOf(file.path)), file)
      result.added++
    }
    onProgress?.(at + 1, files.length)
  }

  for (const [path, document] of existing.files) {
    if (!incoming.has(path) && store.getDocument(document.id)) {
      api.remove(document.id)
      result.removed++
    }
  }
  // Folders left with nothing in them, the deepest first so that a folder
  // holding only empty folders goes too.
  const byDepth = [...contentsOf(api.childrenOf, folderId).folders.values()].sort(
    (a, b) => depthOf(api.get, b) - depthOf(api.get, a)
  )
  for (const folder of byDepth) {
    if (api.childrenOf(folder.id).length === 0) api.remove(folder.id)
  }

  store.updateDocument(folderId, { source })
  return result
}

/**
 * @param {(id: string) => Document|undefined} get
 * @param {Document} document
 */
function depthOf(get, document) {
  let depth = 0
  for (let at = get(document.parentId); at; at = get(at.parentId)) depth++
  return depth
}
