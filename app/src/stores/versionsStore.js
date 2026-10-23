/**
 * @module stores/versionsStore
 * @description A text document's versions: its text as it stood, kept to
 * look back at and restore.
 *
 * One is taken just before the text changes:
 *
 * - after a pause, of the text as the writer left it (`changing`, from
 *   `documentsStore.updateDocument`, which every change of content goes
 *   through);
 * - during a long stretch of editing, once an hour;
 * - before a change from outside the editor: the model's, a Google Docs
 *   sync's, another device's merged in, a version restored (`around`, from
 *   `useDocuments.fromOutside`). A run of changes from one place, with no
 *   pause and nothing typed between, takes one;
 * - when the writer keeps one, under a name.
 *
 * Never one of an empty text, or of the text the newest already has. What is
 * kept thins with age (`utils/versions.js`), and goes when its document is
 * deleted for good. Versions are rows of their own, in IndexedDB on every
 * platform, and synced with their project. See `.llm/versions_design.md`.
 */

import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore'
import { storage } from '@/storage/index.js'
import { countWords } from '@/utils/wordCount.js'
import { picturesIn } from '@/utils/pictures.js'
import { CLASHED, PAUSE_MS, STRETCH_MS, thinned } from '@/utils/versions.js'

/** @typedef {import('../types/models.js').Document} Document */
/** @typedef {import('../types/models.js').Version} Version */
/** @typedef {import('../types/models.js').VersionBy} VersionBy */

/**
 * The newest version of a document as this window knows it: enough to tell
 * whether a text is already kept, and how long ago the last one was.
 * @typedef {{at: number, content: string}} Newest
 */

export const useVersionsStore = defineStore('versions', () => {
  const syncStore = useSyncStore()

  /** documentId -> its newest version, or null for one with none. @type {Map<string, Newest|null>} */
  const newest = new Map()

  /** documentId -> the last change from outside the editor. @type {Map<string, {by: VersionBy, at: number}>} */
  const outside = new Map()

  /** documentId -> the work on its versions, one thing at a time. @type {Map<string, Promise<void>>} */
  const turns = new Map()

  /** The document a change from outside is being written to now, and by what. @type {{id: string, by: VersionBy}|null} */
  let writing = null

  /**
   * Do something to a document's versions once what was asked before it is
   * done.
   * @param {string} documentId
   * @param {() => Promise<void>} work
   * @returns {Promise<void>}
   */
  function inTurn(documentId, work) {
    const next = (turns.get(documentId) ?? Promise.resolve())
      .then(work)
      .catch(error => console.error(`Failed to keep the versions of ${documentId}:`, error))
    turns.set(documentId, next)
    return next
  }

  /**
   * A document's newest version, read once.
   * @param {string} documentId
   * @returns {Promise<Newest|null>}
   */
  async function newestOf(documentId) {
    const known = newest.get(documentId)
    if (known !== undefined) return known
    /** @type {Version|null} */
    let found = null
    for (const version of await storage.versionsOf(documentId)) {
      if (!found || version.at > found.at) found = version
    }
    if (!newest.has(documentId)) {
      newest.set(documentId, found ? { at: found.at, content: found.content } : null)
    }
    return /** @type {Newest|null} */ (newest.get(documentId))
  }

  /**
   * Keep a version of a document's text.
   * @param {Document} document - As it stood
   * @param {{at: number, by?: VersionBy, name?: string, clash?: Version['clash']}} how
   * @returns {Version}
   */
  function keep(document, { at, by, name, clash }) {
    /** @type {Version} */
    const version = {
      id: `ver_${nanoid()}`,
      storyId: document.storyId,
      documentId: document.id,
      at,
      title: document.title,
      content: document.content,
      words: countWords(document.content),
      ...(by ? { by } : {}),
      ...(name ? { name } : {}),
      ...(clash ? { clash } : {}),
    }
    syncStore.trackChange('versions', version.id, version)
    const known = newest.get(document.id)
    if (!known || at >= known.at) newest.set(document.id, { at, content: document.content })
    return version
  }

  /**
   * Let go of a document's versions that have aged out.
   * @param {string} documentId
   * @param {number} now
   */
  async function thin(documentId, now) {
    for (const id of thinned(await storage.versionsOf(documentId), now)) {
      syncStore.trackDelete('versions', id)
    }
  }

  /**
   * A text document's content is about to change: keep the text it had,
   * when it has stood unchanged for a pause, or the stretch it ends has gone
   * on an hour since the last version. A change from outside the editor has
   * been seen to by `around`, and the writer's own clears the run of one.
   *
   * @param {Document} previous - The row before the change
   * @param {number} [now]
   */
  function changing(previous, now = Date.now()) {
    if (previous.type !== 'text') return
    if (writing?.id === previous.id) return
    outside.delete(previous.id)
    if (!previous.content.trim()) return
    const paused = now - previous.updated >= PAUSE_MS
    inTurn(previous.id, async () => {
      const known = await newestOf(previous.id)
      if (known?.content === previous.content) return
      if (!paused && now - (known?.at ?? previous.created) < STRETCH_MS) return
      keep(previous, { at: previous.updated })
      await thin(previous.id, now)
    })
  }

  /**
   * A text document's text is about to change from outside the editor:
   * keep it as it stands, unless the same thing changed it last, with no
   * pause and nothing typed since.
   *
   * @param {Document} document - As it stands, the editor's typing in it
   * @param {VersionBy} by
   * @param {number} [now]
   */
  function before(document, by, now = Date.now()) {
    if (document.type !== 'text') return
    const last = outside.get(document.id)
    outside.set(document.id, { by, at: now })
    if (last?.by === by && now - last.at < PAUSE_MS) return
    if (!document.content.trim()) return
    inTurn(document.id, async () => {
      const known = await newestOf(document.id)
      if (known?.content === document.content) return
      keep(document, { at: now, by })
      await thin(document.id, now)
    })
  }

  /**
   * Write a change from outside the editor, keeping a version first when one
   * is due.
   *
   * @template T
   * @param {Document|null} document - As it stands, the editor's typing in it
   * @param {VersionBy} by
   * @param {() => T} write
   * @returns {T}
   */
  function around(document, by, write) {
    if (!document) return write()
    before(document, by)
    const was = writing
    writing = { id: document.id, by }
    try {
      return write()
    } finally {
      writing = was
    }
  }

  /**
   * Keep the text a document has now, under a name.
   * @param {Document} document
   * @param {string} name
   * @returns {Promise<Version|null>} Null for a document with no text
   */
  async function keepNamed(document, name) {
    if (document.type !== 'text' || !document.content.trim()) return null
    /** @type {Version|null} */
    let kept = null
    await inTurn(document.id, async () => {
      kept = keep(document, { at: Date.now(), name: name.trim() })
    })
    return kept
  }

  /**
   * Keep the text that lost a clash with another device's, under a name, so
   * that it never ages out.
   *
   * @param {Document} document - The document, with the text that lost
   * @param {boolean} large - Whether nothing of it was merged in
   * @returns {Promise<void>}
   */
  function keepClash(document, large) {
    return inTurn(document.id, async () => {
      keep(document, { at: Date.now(), name: CLASHED, clash: large ? 'large' : 'small' })
    })
  }

  /**
   * A document's versions, the newest first, those just kept among them.
   * @param {string} documentId
   * @returns {Promise<Version[]>}
   */
  async function list(documentId) {
    await turns.get(documentId)
    await syncStore.processSync()
    return (await storage.versionsOf(documentId)).sort((a, b) => b.at - a.at)
  }

  /**
   * Name a version, or with no name take its name away and let it age.
   * @param {Version} version
   * @param {string} name
   * @returns {Version}
   */
  function rename(version, name) {
    /** @type {Version} */
    const next = { ...version }
    if (name.trim()) next.name = name.trim()
    else delete next.name
    syncStore.trackChange('versions', next.id, next)
    return next
  }

  /**
   * Delete a version.
   * @param {Version} version
   */
  function remove(version) {
    syncStore.trackDelete('versions', version.id)
    newest.delete(version.documentId)
  }

  /**
   * Let go of a document's versions, once it is deleted for good.
   * @param {string} documentId
   * @returns {Promise<void>}
   */
  function dropFor(documentId) {
    outside.delete(documentId)
    return inTurn(documentId, async () => {
      await syncStore.processSync()
      for (const version of await storage.versionsOf(documentId)) {
        syncStore.trackDelete('versions', version.id)
      }
      newest.delete(documentId)
    })
  }

  /**
   * The pictures a document's versions refer to, by key: kept while one of
   * them does, so that a version restored has its pictures.
   * @param {string} documentId
   * @returns {Promise<Set<string>|null>} Null when they can't be read
   */
  async function picturesOf(documentId) {
    try {
      const versions = await storage.versionsOf(documentId)
      return new Set(versions.flatMap(version => [...picturesIn(version.content)]))
    } catch (error) {
      console.error(`Failed to read the versions of ${documentId}:`, error)
      return null
    }
  }

  /**
   * Versions as another device kept them, synced: the newest known follows.
   * @param {Array<Version|null>} rows - Null for one removed
   * @param {string[]} [removed] - The documents of those removed
   */
  function received(rows, removed = []) {
    for (const documentId of removed) newest.delete(documentId)
    for (const version of rows) {
      if (!version) continue
      const known = newest.get(version.documentId)
      if (known !== undefined && (!known || version.at > known.at)) {
        newest.set(version.documentId, { at: version.at, content: version.content })
      }
    }
  }

  return {
    changing,
    before,
    around,
    keepNamed,
    keepClash,
    list,
    rename,
    remove,
    dropFor,
    picturesOf,
    received,
  }
})
