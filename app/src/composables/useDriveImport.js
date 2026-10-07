/* global File */
/**
 * @module composables/useDriveImport
 * @description Files picked in Google Drive, brought into a folder of the
 * project.
 *
 * The steps are `drive/`'s: Google's sign-in with its picker, in a popup or
 * the system browser, then each picked file looked up and fetched. This puts
 * them in order and hands what came back to the bulk importer, as a batch
 * chosen from disk would be, so a Doc is a text document and a PDF a file
 * document. A Doc's pictures are taken out first and counted. See
 * `.llm/google_docs_design.md`.
 */

import { useBulkImport } from './useBulkImport.js'
import { driveConfig } from '@/drive/config.js'
import { SignInLapsedError } from '@/drive/errors.js'
import { describePicked, fetchPicked } from '@/drive/fetch.js'
import { takeImages } from '@/drive/images.js'
import { pickInBrowser, pickInPopup } from '@/drive/signIn.js'

/** @typedef {import('@/drive/signIn.js').Picked} Picked */
/** @typedef {import('./useBulkImport.js').Imported} Imported */
/** @typedef {import('@/files/batch.js').Gathered} Gathered */

/**
 * Where an import is, for the dialog to say.
 *
 * @typedef {(step: 'downloading'|'writing', done: number, total: number) => void} OnStep
 */

/**
 * @param {string} storyId
 */
export function useDriveImport(storyId) {
  const bulk = useBulkImport(storyId)

  /**
   * Sign in and pick on Google's own page: a popup in a browser, the system
   * browser in the desktop window. In a browser, call it straight from a
   * click, with nothing awaited first: the popup opens before this returns.
   *
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal] - Stops the wait, and closes the popup
   * @returns {Promise<Picked|null>} Null when the writer cancelled or picked nothing
   */
  function choose({ signal } = {}) {
    const config = driveConfig()
    if (!config) return Promise.reject(new Error('This build has no Google client.'))
    return config.kind === 'desktop'
      ? pickInBrowser(config, { signal })
      : pickInPopup(config.clientId, { signal })
  }

  /**
   * Fetch the picked files and write them into a folder. One that cannot be
   * fetched is skipped and named, as one that cannot be read is; a sign-in
   * that ran out stops the lot before anything is written.
   *
   * @param {string[]} ids - The picked files' Drive ids
   * @param {string} token
   * @param {Object} [options]
   * @param {string} [options.parentId] - The folder; the project's top otherwise
   * @param {AbortSignal} [options.signal]
   * @param {OnStep} [options.onStep]
   * @returns {Promise<Imported>}
   * @throws {SignInLapsedError} When Drive stopped taking the token
   */
  async function importPicked(ids, token, { parentId, signal, onStep } = {}) {
    /** @type {Gathered[]} */
    const gathered = []
    /** @type {Imported['skipped']} */
    const skipped = []
    let images = 0

    for (const [index, id] of ids.entries()) {
      signal?.throwIfAborted()
      onStep?.('downloading', index + 1, ids.length)
      // Named by its id until Drive says what it is called.
      let name = id
      try {
        const picked = await describePicked(id, token, { signal })
        name = picked.name
        let file = await fetchPicked(picked, token, { signal })
        if (file.type === 'text/markdown') {
          const taken = takeImages(await file.text())
          images += taken.images.length
          if (taken.images.length > 0) {
            file = new File([taken.markdown], file.name, { type: file.type })
          }
        }
        gathered.push({ file, folders: [] })
      } catch (error) {
        if (signal?.aborted || error instanceof SignInLapsedError) throw error
        skipped.push({
          name,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const result = await bulk.importMany(gathered, {
      parentId,
      signal,
      onProgress: (done, total) => onStep?.('writing', done, total),
    })
    return { ...result, images, skipped: [...skipped, ...result.skipped] }
  }

  return { choose, importPicked }
}
