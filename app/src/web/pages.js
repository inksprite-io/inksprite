/**
 * @module web/pages
 * @description Pages read lately, kept for the session.
 *
 * A long page is read a slice at a time, each slice its own call. Asking the
 * service for the whole page again for every slice would pay for it again,
 * and send the address out again, so the last few pages read are kept here,
 * by service and address, and a slice further on is cut from the copy.
 *
 * The copy is also what the writer keeps when they save a slice to the
 * project: the whole page, not the part the model happened to be reading.
 */

import { serviceInUse } from './config.js'

/** @typedef {import('./answers.js').Page} Page */
/** @typedef {import('./services.js').WebService} WebService */
/** @typedef {import('./services.js').CallOptions} CallOptions */

/** How many pages are kept. */
const KEPT = 8

/** @type {Map<string, Promise<Page>>} */
const pages = new Map()

/**
 * A page, from the copy kept of it or from the service.
 *
 * @param {WebService} service
 * @param {string} url
 * @param {CallOptions} options
 * @returns {Promise<Page>}
 */
export function readPage(service, url, options) {
  const key = `${service.id} ${url}`
  const kept = pages.get(key)
  if (kept) {
    // The latest read goes to the back of the line.
    pages.delete(key)
    pages.set(key, kept)
    return kept
  }
  const reading = service.read(url, options)
  pages.set(key, reading)
  // A read that failed is not kept, so the next one asks again.
  reading.catch(() => {
    if (pages.get(key) === reading) pages.delete(key)
  })
  while (pages.size > KEPT) pages.delete(/** @type {string} */ (pages.keys().next().value))
  return reading
}

/**
 * The whole of a page, for the writer to keep: the copy kept of it, whichever
 * service read it, or else a read by the service in use.
 *
 * @param {string} url
 * @param {CallOptions} [options]
 * @returns {Promise<Page|null>} null when no copy is kept and no service is
 *   set up to read one
 * @throws When the service fails to read it
 */
export async function wholePage(url, options = {}) {
  for (const [key, kept] of pages) {
    if (key.slice(key.indexOf(' ') + 1) === url) return kept
  }
  const using = serviceInUse()
  if (!using) return null
  return readPage(using.service, url, { ...options, key: using.key })
}

/** Forget every page kept: for tests. */
export function forgetPages() {
  pages.clear()
}
