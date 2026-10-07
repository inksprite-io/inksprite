/**
 * @module composables/useBulkImport
 * @description A batch of files written into the tree, folders and all.
 *
 * Many files at once — chosen together, a folder chosen whole, or dropped
 * from the desktop — each looked at and written the way one file is, into
 * the folders it came in. A folder that is already there under the same name
 * is used; one that is not is made. Nothing is asked along the way: a card
 * in the batch takes the import's defaults, and can be re-imported from its
 * folder afterwards to answer the questions. One file that cannot be read
 * is skipped and named at the end, rather than stopping the rest.
 */

import { useCardImport } from './useCardImport.js'
import { useDocuments } from './useDocuments.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/** @typedef {import('@/files/batch.js').Gathered} Gathered */

/**
 * What a batch left behind.
 *
 * @typedef {Object} Imported
 * @property {number} documents - Written, folders not counted
 * @property {number} folders - Made new; ones already there are not counted
 * @property {number} cards - Cards and lorebooks among them, written with the defaults
 * @property {number} scans - PDFs with no text in them
 * @property {Array<{name: string, reason: string}>} skipped - What could not be read, and why
 * @property {number} [images] - Pictures left out of what came in: a Google
 *   Doc's, which documents cannot hold yet
 */

/**
 * @param {string} storyId
 */
export function useBulkImport(storyId) {
  const api = useDocuments(storyId)
  const cards = useCardImport(storyId)

  /**
   * Write a batch of files, each into the folders above it.
   *
   * @param {Gathered[]} gathered
   * @param {Object} [options]
   * @param {string} [options.parentId] - Where the batch goes; the project's top otherwise
   * @param {(done: number, total: number) => void} [options.onProgress] - Told after each file
   * @param {AbortSignal} [options.signal] - Stops it before the next file; what
   *   was written stays
   * @returns {Promise<Imported>}
   */
  async function importMany(gathered, { parentId, onProgress, signal } = {}) {
    await api.init()
    const into = parentId || rootIdFor(storyId)
    /** @type {Imported} */
    const result = { documents: 0, folders: 0, cards: 0, scans: 0, skipped: [] }
    /** Folders made or found on the way, by their path under `into`. */
    const known = new Map([['', into]])

    /** @param {string[]} folders */
    const folderFor = folders => {
      let path = ''
      let parent = into
      for (const name of folders) {
        path = path ? `${path}/${name}` : name
        let id = known.get(path)
        if (!id) {
          const found = api
            .childrenOf(parent)
            .find(child => child.type === 'folder' && child.title === name)
          if (found) id = found.id
          else {
            id = api.createFolder(parent, name).id
            result.folders++
          }
          known.set(path, id)
        }
        parent = id
      }
      return parent
    }

    let done = 0
    for (const { file, folders } of gathered) {
      signal?.throwIfAborted()
      try {
        const found = await cards.inspect(file)
        signal?.throwIfAborted()
        const written = await cards.write(found, { parentId: folderFor(folders) })
        result.documents += written.documents
        if (found.shape === 'card' || found.shape === 'lorebook') result.cards++
        if (found.shape === 'file' && found.mime === 'application/pdf' && !found.text) {
          result.scans++
        }
      } catch (error) {
        if (signal?.aborted) throw error
        result.skipped.push({
          name: file.name,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
      done++
      onProgress?.(done, gathered.length)
    }
    return result
  }

  return { importMany }
}

/**
 * What to tell the writer when a batch is done.
 *
 * @param {Imported} result
 * @returns {{summary: string, detail: string, severity: 'success'|'warn'|'error'}}
 */
export function describeImport(result) {
  const count = (/** @type {number} */ n, /** @type {string} */ word) =>
    `${n} ${word}${n === 1 ? '' : 's'}`
  const bits = [count(result.documents, 'document')]
  if (result.folders > 0) bits.push(count(result.folders, 'new folder'))
  const notes = []
  if (result.cards > 0) {
    notes.push(
      `${count(result.cards, 'card')} written with the default name; re-import one to set yours.`
    )
  }
  if (result.scans > 0) notes.push(`${count(result.scans, 'PDF')} with no text: a scan.`)
  if (result.images) notes.push(`${count(result.images, 'image')} left out.`)
  if (result.skipped.length > 0) {
    const names = result.skipped
      .slice(0, 3)
      .map(skip => `${skip.name} (${skip.reason})`)
      .join(', ')
    const more = result.skipped.length > 3 ? ` and ${result.skipped.length - 3} more` : ''
    notes.push(`Skipped ${names}${more}.`)
  }
  const nothing = result.documents === 0
  return {
    severity: nothing ? 'error' : result.skipped.length > 0 ? 'warn' : 'success',
    summary: nothing ? 'Nothing imported' : `Imported ${bits.join(', ')}`,
    detail: notes.join(' '),
  }
}
