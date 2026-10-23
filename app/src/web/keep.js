/**
 * @module web/keep
 * @description What is at an address, to keep in the project: the file
 * itself where the app can fetch it, or else the page as its text.
 *
 * The desktop app can fetch anything from its site. A page in a browser is
 * refused by almost every site, so there it is tried once, and what is kept
 * otherwise is the page as a service read it: its text, even for a PDF.
 *
 * A page the model read is kept as it read it, since that is what it chose
 * to keep; a file it read from its site is kept from the same read, not
 * fetched again.
 */

import { fetchDirect } from './direct.js'
import { keptRead, wholePage } from './pages.js'

/** @typedef {import('./answers.js').Page} Page */

/**
 * What there is to keep: the file, or a page's text, and whether the page
 * came from a service rather than from its site.
 *
 * @typedef {{file: File}|{page: Page, read: boolean}} Keepable
 */

/**
 * What to keep of an address.
 *
 * @param {string} url
 * @param {{signal?: AbortSignal, timeout?: number}} [options]
 * @returns {Promise<Keepable>}
 * @throws When neither the site nor a service gives anything: the site's
 *   refusal, in the writer's words
 */
export async function fetchToKeep(url, options = {}) {
  const kept = keptRead(url)
  const read = kept ? await kept.catch(() => null) : null
  if (read?.file) return { file: read.file }

  /** @type {unknown} */
  let refused
  try {
    const fetched = await fetchDirect(url, options)
    if ('file' in fetched) return fetched
    return { page: read?.text.trim() ? read : fetched.page, read: false }
  } catch (error) {
    if (options.signal?.aborted) throw error
    refused = error
  }

  const page = read || (await wholePage(url, options).catch(() => null))
  if (page?.text.trim()) return { page, read: true }
  throw refused
}
