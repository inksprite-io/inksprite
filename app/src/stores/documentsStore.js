/**
 * @module stores/documentsStore
 * @description Store for a story's document tree — the single source of truth
 * for what used to live in `parts` and `scenes`.
 *
 * A document is either a folder (children, no content) or text (content, no
 * children). The story is the root of its own tree: a document sitting at the
 * top level is parented to its `storyId`, which keeps `parentId` a non-null
 * indexable string and lets one children index answer both "what is in this
 * story" and "what is in this folder".
 *
 * `partsStore` and `scenesStore` are thin projections over this store while the
 * UI still speaks in acts and chapters.
 *
 * @example
 * const store = useDocumentsStore()
 * await store.loadStory('story_123')
 * const chapters = store.getChildrenOrdered('part_456')
 */

import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore'
import { rootNode, rootIdFor } from './migrations/projectTree.js'
import db from './db'
import { countWords } from '@/utils/wordCount.js'

/** @typedef {import('../types/models.js').Document} Document */

/**
 * Generate a unique document ID
 * @returns {string} Document ID in format doc_xxx
 */
function generateDocumentId() {
  return `doc_${nanoid()}`
}

export const useDocumentsStore = defineStore('documents', () => {
  /**
   * Live documents by id. A deleted document is dropped from here as its row
   * is queued for removal.
   * @type {import('vue').ShallowRef<Map<string, Document>>}
   */
  const documents = shallowRef(new Map())

  /**
   * parentId -> set of child document ids
   * @type {import('vue').ShallowRef<Map<string, Set<string>>>}
   */
  const childrenByParent = shallowRef(new Map())

  /**
   * storyId -> in-flight load promise
   * @type {import('vue').ShallowRef<Map<string, Promise<void>>>}
   */
  const _loadingByStory = shallowRef(new Map())

  const syncStore = useSyncStore()

  /**
   * Add a document id to its parent's child set.
   * @param {string} parentId
   * @param {string} id
   */
  function indexChild(parentId, id) {
    // Replace the Set rather than mutating it so shallow reactivity sees it.
    const ids = new Set(childrenByParent.value.get(parentId) ?? [])
    ids.add(id)
    childrenByParent.value.set(parentId, ids)
  }

  /**
   * Remove a document id from its parent's child set.
   * @param {string} parentId
   * @param {string} id
   */
  function unindexChild(parentId, id) {
    const ids = new Set(childrenByParent.value.get(parentId) ?? [])
    ids.delete(id)
    childrenByParent.value.set(parentId, ids)
  }

  /**
   * Get a live document by id
   * @param {string} documentId
   * @returns {Document|null}
   */
  function getDocument(documentId) {
    return documents.value.get(documentId) || null
  }

  /**
   * Get the children of a parent, unsorted
   * @param {string} parentId - A document id, or a storyId for root documents
   * @returns {Document[]}
   */
  function getChildren(parentId) {
    const ids = childrenByParent.value.get(parentId)
    if (!ids) return []

    const out = []
    for (const id of ids) {
      const doc = documents.value.get(id)
      if (doc) out.push(doc)
    }
    return out
  }

  /**
   * Get the children of a parent in display order.
   *
   * An ordered folder sorts by `order`; anything else sorts by title, the way
   * a file explorer does. `order` is still maintained either way, so switching
   * a folder to ordered restores its original sequence rather than an
   * arbitrary one.
   *
   * @param {string} parentId
   * @returns {Document[]}
   */
  function getChildrenOrdered(parentId) {
    const children = getChildren(parentId).slice()
    // Stable tiebreak so equal keys don't shuffle between renders.
    const byId = (/** @type {Document} */ a, /** @type {Document} */ b) =>
      a.id > b.id ? 1 : a.id < b.id ? -1 : 0

    if (documents.value.get(parentId)?.ordered) {
      return children.sort((a, b) => a.order - b.order || byId(a, b))
    }
    return children.sort((a, b) => a.title.localeCompare(b.title) || byId(a, b))
  }

  /**
   * Whether `candidateId` is `documentId` or sits somewhere beneath it.
   *
   * Reparenting a folder into its own subtree would detach that whole branch
   * from the story and loop forever on render, and a drag-and-drop tree makes
   * that a two-finger gesture rather than a hypothetical.
   *
   * @param {string} documentId
   * @param {string} candidateId
   * @returns {boolean}
   */
  function containsDocument(documentId, candidateId) {
    let current = documents.value.get(candidateId)
    while (current) {
      if (current.id === documentId) return true
      current = documents.value.get(current.parentId)
    }
    return false
  }

  /**
   * Create a document.
   *
   * @param {object} opts
   * @param {string} opts.storyId - Owning story
   * @param {string} opts.parentId - Parent document id, or the storyId for a root document
   * @param {'folder'|'text'|'file'} opts.type
   * @param {string} opts.title
   * @param {string} [opts.id] - Explicit id, for callers that mint their own
   * @param {number} [opts.order] - Defaults to appending after existing siblings
   * @param {string} [opts.content] - Text documents and files only: markdown,
   *   or the text read out of the file
   * @param {boolean} [opts.ordered] - Folders only; new folders are unordered by default
   * @param {string} [opts.summary] - A short description, for the listing the model reads
   * @param {string} [opts.kind] - What this document is, for an importer and its exporter
   * @param {boolean} [opts.hidden] - Kept from the model, and so is anything under it
   * @param {boolean} [opts.plain] - Edited as plain text and stored as typed
   * @param {string} [opts.mime] - Files only: the media type
   * @param {number} [opts.size] - Files only: bytes
   * @param {number} [opts.pages] - Files only: how many pages, when the format has them
   * @returns {Document}
   * @throws {Error} If storyId or parentId is missing
   */
  function createDocument({
    storyId,
    parentId,
    type,
    title,
    id,
    order,
    content = '',
    ordered = false,
    summary = '',
    kind,
    hidden,
    plain,
    mime,
    size,
    pages,
  }) {
    if (!storyId) throw new Error('Story ID is required to create a document')
    if (!parentId) throw new Error('Parent ID is required to create a document')

    const isFolder = type === 'folder'
    const isFile = type === 'file'
    /** @type {Document} */
    const document = {
      id: id || generateDocumentId(),
      storyId,
      parentId,
      order: order ?? getChildren(parentId).length,
      type,
      ordered: isFolder ? ordered : false,
      title,
      content: isFolder ? '' : content,
      summary,
      wordCount: isFolder ? 0 : countWords(content),
      // Absent rather than false: every reader of these treats a missing flag
      // as the default, and an import writing a thousand documents should not
      // write a thousand copies of "no" into the database.
      ...(kind ? { kind } : {}),
      ...(hidden ? { hidden: true } : {}),
      // A file's text is what was read out of it, and it stays as read.
      ...(plain || isFile ? { plain: true } : {}),
      ...(isFile && mime ? { mime } : {}),
      ...(isFile && typeof size === 'number' ? { size } : {}),
      ...(isFile && typeof pages === 'number' ? { pages } : {}),
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    }

    documents.value.set(document.id, document)
    indexChild(parentId, document.id)

    triggerRef(documents)
    triggerRef(childrenByParent)

    syncStore.trackChange('documents', document.id, document)

    return document
  }

  /**
   * Update a document. Handles reparenting and keeps word count in step with
   * content.
   *
   * @param {string} documentId
   * @param {Partial<Document>} updates
   * @returns {Document}
   * @throws {Error} If the document is not found
   */
  function updateDocument(documentId, updates) {
    const previous = documents.value.get(documentId)
    if (!previous) {
      throw new Error(`Failed to update document, '${documentId}' not found`)
    }

    const parentId = updates.parentId || previous.parentId
    if (parentId !== previous.parentId && containsDocument(documentId, parentId)) {
      throw new Error(`Cannot move '${documentId}' into its own subtree`)
    }
    const hasBody = (updates.type || previous.type) !== 'folder'

    /** @type {Document} */
    const next = {
      ...previous,
      ...updates,
      // Preserve system fields
      id: previous.id,
      parentId,
      // A document follows its parent's story. Where the new parent isn't
      // loaded there is nothing better to go on than what it had.
      storyId: documents.value.get(parentId)?.storyId || previous.storyId,
      created: previous.created,
      // Version only increments at persist time.
      version: previous.version,
      updated: Date.now(),
    }
    if ('content' in updates && hasBody) {
      next.wordCount = countWords(next.content)
    }

    documents.value.set(documentId, next)

    if (parentId !== previous.parentId) {
      unindexChild(previous.parentId, documentId)
      indexChild(parentId, documentId)
      triggerRef(childrenByParent)
    }

    triggerRef(documents)
    syncStore.trackChange('documents', documentId, next)

    return next
  }

  /**
   * Delete a document. Children are left alone — cascading is the
   * caller's decision, as it was with parts and scenes.
   *
   * @param {string} documentId
   * @throws {Error} If the document is not found
   */
  function deleteDocument(documentId) {
    const document = documents.value.get(documentId)
    if (!document) {
      throw new Error(`Failed to delete document, '${documentId}' not found`)
    }

    unindexChild(document.parentId, documentId)
    triggerRef(childrenByParent)

    // The row goes, and a file's bytes with it. Queued behind any edit still
    // waiting to be written, so nothing puts the row back after.
    syncStore.trackDelete('documents', documentId)
    if (document.type === 'file') syncStore.trackDelete('files', documentId)

    documents.value.delete(documentId)
    triggerRef(documents)
  }

  /**
   * Delete every child of a parent, optionally of one type only.
   *
   * @param {string} parentId
   * @param {'folder'|'text'|'file'} [type] - Restrict to one kind of child
   * @returns {number} How many were deleted
   */
  function deleteChildren(parentId, type) {
    const targets = getChildren(parentId).filter(doc => !type || doc.type === type)

    let deleted = 0
    for (const doc of targets) {
      try {
        deleteDocument(doc.id)
        deleted++
      } catch (error) {
        console.warn(`Failed to delete document ${doc.id}: ${error.message}`)
      }
    }
    return deleted
  }

  /**
   * Reorder children of a parent. Ids from another parent are moved in, which
   * is how a drag between folders lands.
   *
   * @param {string} parentId
   * @param {string[]} documentIds - Child ids in their new order
   * @returns {Document[]} The reordered children
   * @throws {Error} If parentId is missing or an id is unknown
   */
  function reorderChildren(parentId, documentIds) {
    if (!parentId) throw new Error('Parent ID is required to reorder documents')

    for (const id of documentIds) {
      const doc = documents.value.get(id)
      if (!doc) throw new Error(`Document '${id}' not found`)
    }

    documentIds.forEach((id, index) => {
      const doc = documents.value.get(id)
      if (!doc) return

      /** @type {Partial<Document>} */
      const updates = { order: index }
      if (doc.parentId !== parentId) updates.parentId = parentId
      updateDocument(id, updates)
    })

    return getChildrenOrdered(parentId)
  }

  /**
   * Load a story's whole tree in one query.
   *
   * Parts and scenes needed a query per part; a story is on the order of a
   * hundred documents, so one read covers it.
   *
   * @param {string} storyId
   * @returns {Promise<void>}
   * @throws {Error} If storyId is missing or the read fails
   */
  async function loadStory(storyId) {
    if (!storyId) throw new Error('Story ID is required to load documents')
    if (isStoryLoaded(storyId)) return Promise.resolve()

    const inFlight = _loadingByStory.value.get(storyId)
    if (inFlight) return inFlight

    const promise = (async () => {
      try {
        const rows = await db.documents.where('storyId').equals(storyId).toArray()

        for (const row of rows) {
          documents.value.set(row.id, row)
          indexChild(row.parentId, row.id)
        }
        // A story with no documents still counts as loaded, so make sure the
        // root has an entry — otherwise every read re-queries an empty story.
        if (!childrenByParent.value.has(storyId)) {
          childrenByParent.value.set(storyId, new Set())
        }

        triggerRef(documents)
        triggerRef(childrenByParent)

        console.log(`Loaded ${rows.length} documents for story ${storyId}`)
      } catch (error) {
        console.error(`Failed to load documents for story ${storyId}:`, error)
        throw new Error(`Failed to load documents: ${error.message}`)
      } finally {
        _loadingByStory.value.delete(storyId)
      }
    })()

    _loadingByStory.value.set(storyId, promise)
    return promise
  }

  /**
   * Make sure a story has its root node.
   *
   * Idempotent, and safe to call on every load: a story migrated from the flat
   * structure already has one, and a brand new one needs it before anything
   * can be created inside it.
   *
   * The root only. It carries the project's name, `"/"` resolves to it, and
   * every path is relative to it, so a project without one is not a project.
   * The folders inside it are content — laid down once by a template, and the
   * writer's to rename, move, or delete from then on. Re-asserting those on
   * every open was necessary while the outline resolved acts through
   * `manuscript`; the outline is gone, and a folder that comes back from the
   * dead on the next reload is nothing but a bug.
   *
   * @param {string} storyId
   * @param {string} [storyTitle] - Seeds the root node's title; it is its own from then on
   * @returns {Document} The root, created or already present
   */
  function ensureRoot(storyId, storyTitle) {
    const existing = documents.value.get(rootIdFor(storyId))
    if (existing) return existing

    const root = rootNode(storyId, storyTitle)
    return createDocument({
      id: root.id,
      storyId: root.storyId,
      parentId: root.parentId,
      type: 'folder',
      title: root.title,
      order: root.order,
      ordered: root.ordered,
    })
  }

  /**
   * Delete every document in a story.
   *
   * Deleting a story used to walk parts and their scenes, which reached only
   * the manuscript. Now that notes and lore live in the same tree, the whole
   * tree has to go.
   *
   * @param {string} storyId
   * @returns {Promise<number>} How many were deleted
   */
  async function deleteStoryDocuments(storyId) {
    await loadStory(storyId)

    // Snapshot first: deleteDocument drops entries from the map it iterates.
    const ids = []
    for (const document of documents.value.values()) {
      if (document.storyId === storyId) ids.push(document.id)
    }

    let deleted = 0
    for (const id of ids) {
      try {
        deleteDocument(id)
        deleted++
      } catch (error) {
        console.warn(`Failed to delete document ${id}: ${error.message}`)
      }
    }
    return deleted
  }

  /**
   * A story's root node — the project itself, which carries its name.
   * @param {string} storyId
   * @returns {Document|null}
   */
  function getRoot(storyId) {
    return getDocument(rootIdFor(storyId))
  }

  /**
   * Load just the root nodes for a set of stories.
   *
   * The bookshelf needs project names without pulling in whole trees, and root
   * ids are derived from the story id, so this is one keyed read.
   *
   * Deliberately does not index the roots as children of their stories: that
   * index is what `isStoryLoaded` consults, and marking a story loaded from a
   * root-only read would make `loadStory` skip the rest of the tree.
   *
   * @param {string[]} storyIds
   * @returns {Promise<void>}
   */
  async function loadRoots(storyIds) {
    const missing = storyIds.filter(storyId => !documents.value.has(rootIdFor(storyId)))
    if (missing.length === 0) return

    try {
      const rows = await db.documents.bulkGet(missing.map(rootIdFor))
      for (const row of rows) {
        if (row) documents.value.set(row.id, row)
      }
      triggerRef(documents)
    } catch (error) {
      console.error('Failed to load project roots:', error)
    }
  }

  /**
   * Rename a project.
   *
   * The name lives on the root node, which the caller may not have loaded —
   * the bookshelf renames stories it has only the records for.
   *
   * @param {string} storyId
   * @param {string} title
   * @returns {Promise<Document>}
   * @throws {Error} If the story has no root node
   */
  async function renameProject(storyId, title) {
    await loadRoots([storyId])

    const root = getRoot(storyId)
    if (!root) throw new Error(`Story '${storyId}' has no root document to rename`)

    return updateDocument(root.id, { title })
  }

  /**
   * Whether a story's tree is already in memory.
   * @param {string} storyId
   * @returns {boolean}
   */
  function isStoryLoaded(storyId) {
    return childrenByParent.value.has(storyId)
  }

  return {
    // State
    documents,
    childrenByParent,

    // Actions
    getDocument,
    containsDocument,
    getChildren,
    getChildrenOrdered,
    createDocument,
    updateDocument,
    deleteDocument,
    deleteChildren,
    deleteStoryDocuments,
    reorderChildren,
    loadStory,
    loadRoots,
    getRoot,
    renameProject,
    isStoryLoaded,
    ensureRoot,
  }
})
