/**
 * @module stores/migrations/lore
 * @description Fold `lorebooks` and `loreEntries` into the document tree.
 *
 * A lore entry was always a document: a name, a summary, and a body of text.
 * What it lacked was somewhere to live. `category` was a folder that never got
 * to be one, and the lorebook itself held nothing but the category list.
 *
 * Pure over plain arrays, like the migrations before it, so the Dexie upgrade
 * hook and backup restore share one transform and cannot drift apart.
 *
 * IDs are preserved. An entry stays `lore_xxx`, so tool results replayed from
 * stored trajectories keep resolving.
 */

import he from 'he'
import { notesIdFor } from './projectTree.js'

/**
 * @typedef {import('../../types/models.js').Document} Document
 * @typedef {import('../../types/models.js').Lorebook} Lorebook
 * @typedef {import('../../types/models.js').LoreEntry} LoreEntry
 */

/**
 * Fold a category name down to something usable as an id.
 *
 * Case and punctuation differences collapse, so "Characters" and "characters"
 * land in one folder rather than two that look identical in the tree.
 *
 * @param {string} category
 * @returns {string}
 */
const slug = category =>
  (category || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * Deterministic id for a category folder, so re-running the migration finds
 * the folder it made last time instead of building a second one.
 *
 * @param {string} storyId
 * @param {string} category
 * @returns {string}
 */
export const categoryFolderIdFor = (storyId, category) => `lorecat_${storyId}_${slug(category)}`

/**
 * Where entries the writer had switched off end up.
 * @param {string} storyId
 * @returns {string}
 */
export const archiveFolderIdFor = storyId => `lorearchive_${storyId}`

/**
 * Convert a plain-text lore body into the Tiptap HTML a document holds.
 *
 * Lore was edited in a textarea, so its line breaks are the only structure it
 * has. Blank lines become paragraphs and single newlines become hard breaks;
 * dropping them would run a character sheet into one block of prose.
 *
 * @param {string} text
 * @returns {string}
 */
export function plainTextToHtml(text) {
  const normalized = (text || '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) return ''

  return normalized
    .split(/\n{2,}/)
    .map(block => `<p>${he.escape(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  return (text || '')
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0).length
}

/**
 * Build a folder document.
 *
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.storyId
 * @param {string} opts.parentId
 * @param {string} opts.title
 * @param {number} opts.order
 * @param {number} opts.now
 * @returns {Document}
 */
function folder({ id, storyId, parentId, title, order, now }) {
  return {
    id,
    storyId,
    parentId,
    order,
    type: 'folder',
    ordered: false,
    title,
    content: '',
    summary: '',
    wordCount: 0,
    version: 1,
    created: now,
    updated: now,
  }
}

/**
 * Convert lorebooks and their entries into documents under `notes`.
 *
 * Categories become folders, but only the ones an entry actually uses — a
 * lorebook declares five by default and most stories use two, so migrating the
 * declared list would hand every project a set of empty folders.
 *
 * Entries the writer had disabled go to `notes/archive/` rather than inline.
 * A document tree has no enabled flag, and handing the model material that was
 * switched off is worse than an extra folder.
 *
 * Idempotent: an entry whose id is already a document is skipped, so a retried
 * upgrade or a re-imported backup cannot migrate it twice.
 *
 * @param {Lorebook[]} lorebooks
 * @param {LoreEntry[]} loreEntries
 * @param {Document[]} documents - Every existing document, across all stories
 * @param {number} [now]
 * @returns {{documents: Document[], skipped: Array<{id: string, reason: string}>}} New documents only
 */
export function loreToDocuments(lorebooks, loreEntries, documents, now = Date.now()) {
  /** @type {Map<string, string>} */
  const storyIdByLorebook = new Map()
  for (const lorebook of lorebooks || []) {
    if (lorebook?.id && lorebook.storyId) storyIdByLorebook.set(lorebook.id, lorebook.storyId)
  }

  const existingIds = new Set((documents || []).map(document => document?.id))

  /** @type {Document[]} */
  const out = []
  /** @type {Array<{id: string, reason: string}>} */
  const skipped = []

  // Folders are emitted once, on first use, and counted so siblings get a
  // stable order. `notes` sorts by title anyway, but order survives a folder
  // being switched to ordered later.
  /** @type {Set<string>} */
  const emittedFolders = new Set()
  /** @type {Map<string, number>} */
  const folderCount = new Map()
  /** @type {Map<string, number>} */
  const entryCount = new Map()

  /** @param {string} parentId */
  const nextOrder = (/** @type {Map<string, number>} */ counter, parentId) => {
    const order = counter.get(parentId) ?? 0
    counter.set(parentId, order + 1)
    return order
  }

  for (const entry of loreEntries || []) {
    if (!entry || !entry.id) {
      skipped.push({ id: String(entry && entry.id), reason: 'entry has no id' })
      continue
    }
    // Rows from before v17 may still carry the old soft-delete flag.
    if (/** @type {any} */ (entry).deleted) {
      // Already invisible in the app. The row stays in `loreEntries`.
      skipped.push({ id: entry.id, reason: 'entry is deleted' })
      continue
    }
    if (existingIds.has(entry.id)) {
      skipped.push({ id: entry.id, reason: 'already migrated' })
      continue
    }

    const storyId = storyIdByLorebook.get(entry.lorebookId)
    if (!storyId) {
      skipped.push({
        id: entry.id,
        reason: `no lorebook '${entry.lorebookId}' to resolve a story from`,
      })
      continue
    }

    const notesId = notesIdFor(storyId)
    if (!existingIds.has(notesId)) {
      // Every story got a notes folder in the v4 restructure, so this is a
      // story whose tree never happened. Inventing one here would put lore in
      // a project that has no root to hang it from.
      skipped.push({ id: entry.id, reason: `story '${storyId}' has no notes folder` })
      continue
    }

    let parentId = notesId
    if (entry.enabled === false) {
      parentId = archiveFolderIdFor(storyId)
      if (!emittedFolders.has(parentId) && !existingIds.has(parentId)) {
        emittedFolders.add(parentId)
        out.push(
          folder({
            id: parentId,
            storyId,
            parentId: notesId,
            title: 'archive',
            order: nextOrder(folderCount, notesId),
            now,
          })
        )
      }
    } else if (entry.category?.trim()) {
      parentId = categoryFolderIdFor(storyId, entry.category)
      if (!emittedFolders.has(parentId) && !existingIds.has(parentId)) {
        emittedFolders.add(parentId)
        out.push(
          folder({
            id: parentId,
            storyId,
            parentId: notesId,
            title: entry.category.trim(),
            order: nextOrder(folderCount, notesId),
            now,
          })
        )
      }
    }

    const content = plainTextToHtml(entry.content)
    out.push({
      id: entry.id,
      storyId,
      parentId,
      order: nextOrder(entryCount, parentId),
      type: 'text',
      ordered: false,
      title: entry.name?.trim() || 'Untitled',
      content,
      // `description` was a one-line blurb shown under the entry name, which is
      // what a document summary already is.
      summary: entry.description ?? '',
      wordCount: countWords(entry.content),
      version: entry.version ?? 1,
      created: entry.created ?? now,
      updated: entry.updated ?? now,
    })
  }

  return { documents: out, skipped }
}
