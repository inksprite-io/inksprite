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
 * Written straight to Dexie rather than through `syncStore`. The sync store
 * deep-clones a change through JSON on its way to the database, and a Blob
 * comes out of that as `{}`. A file's bytes never change after import, so
 * there is nothing to debounce either: they are put once and read.
 *
 * Nothing here is reactive. There is no in-memory copy of a file; the
 * database is where it lives, and a reader is handed it from there.
 */

import { defineStore } from 'pinia'
import db from './db'

/** @typedef {import('../types/models.js').StoredFile} StoredFile */

export const useFilesStore = defineStore('files', () => {
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
    /** @type {StoredFile} */
    const row = { id, storyId, blob }
    await db.files.put(row)
  }

  /**
   * A document's bytes, or null when it has none.
   *
   * @param {string} id - The file document's id
   * @returns {Promise<Blob|null>}
   */
  async function getFile(id) {
    if (!id) return null
    try {
      /** @type {StoredFile|undefined} */
      const row = await db.files.get(id)
      return row?.blob ?? null
    } catch (error) {
      console.error(`Failed to read file ${id}:`, error)
      return null
    }
  }

  /**
   * Drop the bytes of documents that are gone for good.
   *
   * For the purge, once a deleted document's row is removed. Until then the
   * bytes stay with the row, so a document brought back from the trash still
   * has its file.
   *
   * @param {string[]} ids
   * @returns {Promise<void>}
   */
  async function deleteFiles(ids) {
    if (ids.length === 0) return
    await db.files.bulkDelete(ids)
  }

  return { putFile, getFile, deleteFiles }
})
