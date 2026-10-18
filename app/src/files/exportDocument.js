/* global Blob, TextEncoder */
/**
 * @module files/exportDocument
 * @description A text document handed out as a file: its markdown, and with
 * its pictures, a `.zip`.
 *
 * A document with no pictures goes as the markdown file it is kept as. One
 * with pictures goes as a `.zip` of that file and an `images` folder beside
 * it, holding each picture its text shows, its paths written to them: a
 * folder anyone can see, so that what is unzipped opens in any Markdown app
 * and comes back in as it went out, the pictures as files beside it.
 *
 * Design: `.llm/images_design.md`.
 */

import { zipSync } from 'fflate'
import { filenameFor } from './download.js'
import { encodeName } from '@/utils/documentLinks.js'
import { pictureHref, pictureName, pictureOfKey, picturesIn } from '@/utils/pictures.js'

/** The folder an export's pictures go in, beside the markdown. */
const IMAGES = 'images'

/**
 * A text document as the file to hand out.
 *
 * @param {{title: string}} document
 * @param {string} content - Its markdown as it stands
 * @param {(key: string) => Promise<Blob|null>} read - A picture's bytes, by its key
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function exportDocument(document, content, read) {
  const markdownName = filenameFor({ title: document.title, mime: 'text/markdown' })
  /** @type {Record<string, Uint8Array>} */
  const pictures = {}
  /** @type {Set<string>} */
  const taken = new Set()
  let text = content
  for (const key of picturesIn(content)) {
    const picture = pictureOfKey(key)
    const blob = picture && (await read(key))
    if (!picture || !blob) continue
    // Named as it is, numbered when two documents' pictures share a name.
    const name = pictureName(picture.name, blob.type, taken)
    pictures[`${IMAGES}/${name}`] = new Uint8Array(await blob.arrayBuffer())
    text = text
      .split(pictureHref(picture.documentId, picture.name))
      .join(`${IMAGES}/${encodeName(name)}`)
  }

  if (Object.keys(pictures).length === 0) {
    return { blob: new Blob([content], { type: 'text/markdown' }), filename: markdownName }
  }
  const zipped = zipSync({ [markdownName]: new TextEncoder().encode(text), ...pictures })
  // fflate's bytes are typed as possibly shared memory, which a Blob will not
  // take; what it makes is an ordinary buffer.
  const bytes = /** @type {Uint8Array<ArrayBuffer>} */ (zipped)
  const stem = markdownName.replace(/\.md$/, '')
  return { blob: new Blob([bytes], { type: 'application/zip' }), filename: `${stem}.zip` }
}
