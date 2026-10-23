/**
 * @module stores/filesStore
 * @description The bytes behind a file document.
 *
 * A file — a PDF, an image — is a document in the tree like any other, with a
 * title, a summary, a place, and the text that was extracted from it as its
 * `content`. What it does not carry on its row is the file itself. Opening a
 * project reads every document row in it to draw the tree, and a project of
 * twenty papers is a hundred megabytes the tree does not need; so the blob
 * sits in a table of its own, keyed by the document's id, and is read when
 * something wants to show it or send it.
 *
 * Written straight to storage rather than through `syncStore`. The sync store
 * deep-clones a change through JSON on its way to storage, and a Blob comes
 * out of that as `{}`. A file's bytes never change after import, so there is
 * nothing to debounce either: they are put once and read. They go with their
 * document, which `documentsStore` removes through the sync store.
 *
 * Nothing here is reactive. There is no in-memory copy of a file; storage is
 * where it lives, and a reader is handed it from there. A document's row is
 * made before its bytes are put, so a file opened the moment it appears in
 * the tree is read while they are still on their way; a read waits for a put
 * of the same file that has started and not finished.
 *
 * On a device that syncs, a file another device imported may have only its
 * row here, its bytes on the sync server until they are wanted
 * (`cloud/onDemand.js`). Reading them fetches them, and keeps them.
 */

import { defineStore } from 'pinia'
import { storage } from '@/storage/index.js'
import { fetchElsewhere, fileElsewhere } from '@/cloud/onDemand.js'

export const useFilesStore = defineStore('files', () => {
  /** The puts that have started and not finished, by file. @type {Map<string, Promise<void>>} */
  const writing = new Map()

  /**
   * Keep a document's bytes.
   *
   * @param {string} id - The file document's id
   * @param {string} storyId - Its story, so a story's files can be found together
   * @param {Blob} blob - The file, with its media type
   * @returns {Promise<void>}
   */
  async function putFile(id, storyId, blob) {
    if (!id) throw new Error('A file needs the id of the document it belongs to')
    const write = storage.putFileBytes(id, storyId, blob)
    writing.set(id, write)
    try {
      await write
    } finally {
      if (writing.get(id) === write) writing.delete(id)
    }
  }

  /**
   * A document's bytes, fetched from the sync server when they are only
   * there, or null when it has none, or they couldn't be fetched.
   *
   * @param {string} id - The file document's id
   * @param {{progress?: import('@/cloud/onDemand.js').Progress}} [options] -
   *   Told how far a download has got, when there is one
   * @returns {Promise<Blob|null>}
   */
  async function getFile(id, { progress } = {}) {
    if (!id) return null
    try {
      await writing.get(id)?.catch(() => {})
      return (await storage.fileBytes(id)) ?? (await fetchElsewhere(id, progress))
    } catch (error) {
      console.error(`Failed to read file ${id}:`, error)
      return null
    }
  }

  /**
   * Whether a document's bytes are on the sync server and not here: a file
   * to download, rather than one with no bytes anywhere.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  const isElsewhere = id => fileElsewhere(id)

  return { putFile, getFile, isElsewhere }
})
