/**
 * @module files/download
 * @description A file handed back to the writer, named as it came in.
 */

import { extensionFor } from './inspect.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * The filename a file document is saved under: its title, with the extension
 * its media type takes. The title lost its extension at import; this is
 * where it comes back.
 *
 * @param {Pick<Document, 'title'|'mime'>} document
 * @returns {string}
 */
export function filenameFor(document) {
  const title = (document.title || '').trim() || 'Untitled'
  const extension = extensionFor(document.mime || '')
  if (!extension || title.toLowerCase().endsWith(`.${extension}`)) return title
  return `${title}.${extension}`
}

/**
 * Hand the browser a blob to save.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
