/**
 * @module composables/useDriveImport
 * @description Files picked in Google Drive, brought into a folder of the
 * project.
 *
 * The steps are `drive/`'s: Google's sign-in with its picker, in a popup or
 * the system browser, then each picked file looked up and fetched. This puts
 * them in order and hands what came back to the bulk importer, as a batch
 * chosen from disk would be, so a Doc or a Word file is a text document and
 * a PDF a file document. A Doc is read through the Docs API and converted
 * (`drive/convert.js`), its pictures fetched and handed on with it; a Doc the
 * converter is not given comes as Google's markdown export, its pictures
 * written into it. Either way, as a Word file's, they are its document's own
 * (see `files/pictures.js`), and those that could not come are counted. A
 * Doc with suggested edits still open is named, since it comes in as it was
 * before them, and its first sync brings them in as its comments come in
 * (`drive/suggestions.js`). A Doc's document is linked to
 * the Doc (`drive`): its id, its tab, and the account that picked it, for
 * syncing the two later, and the sign-in is kept for the syncs after it
 * (`drive/session.js`). See `.llm/google_docs_design.md`.
 */

import { useBulkImport } from './useBulkImport.js'
import { accountOf } from '@/drive/api.js'
import { driveConfig } from '@/drive/config.js'
import { SignInLapsedError } from '@/drive/errors.js'
import { convertPicked, describePicked, fetchPicked, linkFor } from '@/drive/fetch.js'
import { keepSession } from '@/drive/session.js'
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
   * The sign-in is kept for syncing what is imported, under the account
   * Drive says it is.
   *
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal] - Stops the wait, and closes the popup
   * @returns {Promise<(Picked & {account: string|null})|null>} Null when the
   *   writer cancelled or picked nothing
   */
  async function choose({ signal } = {}) {
    const config = driveConfig()
    if (!config) throw new Error('This build has no Google client.')
    const picked = await (config.kind === 'desktop'
      ? pickInBrowser(config, { signal })
      : pickInPopup(config.clientId, { signal }))
    if (!picked) return null
    const account = await accountOf(picked.token, { signal })
    keepSession(account, picked)
    return { ...picked, account }
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
   * @param {string|null} [options.account] - The account that picked them,
   *   which a Doc's link keeps
   * @param {AbortSignal} [options.signal]
   * @param {OnStep} [options.onStep]
   * @returns {Promise<Imported>}
   * @throws {SignInLapsedError} When Drive stopped taking the token
   */
  async function importPicked(ids, token, { parentId, account, signal, onStep } = {}) {
    /** @type {Gathered[]} */
    const gathered = []
    /** @type {Imported['skipped']} */
    const skipped = []
    /** @type {string[]} */
    const suggested = []
    let images = 0

    for (const [index, id] of ids.entries()) {
      signal?.throwIfAborted()
      onStep?.('downloading', index + 1, ids.length)
      // Named by its id until Drive says what it is called.
      let name = id
      try {
        const picked = await describePicked(id, token, { signal })
        name = picked.name
        const link = linkFor(picked)
        const converted = link ? await convertPicked(picked, token, { signal }) : null
        const tabId = converted?.base.tabId
        const drive = link && { ...link, ...(tabId && { tabId }), ...(account && { account }) }
        const file = converted?.file ?? (await fetchPicked(picked, token, { signal }))
        if (converted) {
          images += converted.images
          if (converted.suggestions > 0) suggested.push(picked.name)
        }
        gathered.push({
          file,
          folders: [],
          drive,
          pictures: converted?.pictures,
          base: converted?.base,
        })
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
    return {
      ...result,
      ...(images > 0 && { images }),
      ...(suggested.length > 0 && { suggested }),
      skipped: [...skipped, ...result.skipped],
    }
  }

  return { choose, importPicked }
}
