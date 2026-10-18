/* global Blob, createImageBitmap */
/**
 * @module files/pictures
 * @description Pictures that come inside what is imported, made the new
 * document's own.
 *
 * A Google Doc's markdown export writes each picture reference-style:
 * `![][image1]` or `![alt][image2]` where it was, and at the end a
 * definition for each, `[image1]: <data:image/png;base64,…>`, holding the
 * whole picture. Other markdown writes one inline, `![alt](data:…)`. Left
 * in, that is megabytes of base64 in the document and in front of the model.
 * So `takePictures` takes each out, its bytes kept and a marker left where it
 * was (`![alt](inksprite-picture-1)`); a Word file's pictures are taken out
 * the same way as it is read (`files/docx.js`). When the document is written,
 * `placePictures` names each, measures it, and puts its path where its
 * marker was.
 *
 * Design: `.llm/images_design.md`.
 */

import { decodeDataPayload } from '@/utils/dataUrl.js'
import { pictureHref, pictureKey, pictureName } from '@/utils/pictures.js'

/**
 * A picture taken out of what was imported.
 *
 * @typedef {Object} TakenPicture
 * @property {string} marker - The destination that stands for it in the markdown
 * @property {string} [name] - What it was called where it came from, a Doc's `image1`
 * @property {string} mime - Its media type
 * @property {Uint8Array} bytes - The picture
 * @property {string} [docsId] - A Google Doc's id for it, an inline object's,
 *   which its entry on the row keeps
 */

/** What a marker starts with: a path no document has, which the schema keeps. */
const MARKER = 'inksprite-picture-'

/**
 * The marker for the nth picture taken.
 *
 * @param {number} n - From 1
 * @returns {string}
 */
export const markerFor = n => `${MARKER}${n}`

/**
 * A use of a picture: `![alt][label]`, `![label][]` or `![label]`, the last
 * not followed by a link of its own.
 */
const REFERENCE = /!\[((?:\\.|[^\\\]\n])*)\](?:\[((?:\\.|[^\\\]\n])*)\]|(?![([]))/g

/** A picture written inline as a data URI: `![alt](data:…)`. */
const INLINE =
  /!\[((?:\\.|[^\\\]\n])*)\]\(\s*<?data:([^;,>\s)]*)((?:;[^;,>\s)]*)*),([^>\s)]*)>?(?:\s+"(?:\\.|[^"\\])*")?\s*\)/g

/** A definition holding a picture: `[label]: <data:…>`, on a line of its own. */
const DEFINITION =
  /^ {0,3}\[((?:\\.|[^\\\]\n])+)\]:[ \t]*<?data:([^;,>\s]*)((?:;[^;,>\s]*)*),([^>\s]*)>?[ \t]*$/

/**
 * @param {string} text
 * @returns {string}
 */
const unescape = text => text.replace(/\\(.)/g, '$1')

/**
 * Take the pictures written into markdown out of it: each definition that
 * holds one, and each written inline. Each use of one is left as a picture
 * whose destination is its marker, alt text and all. A reference to anything
 * else, a link or a picture on the web, is left where it is, and a
 * definition no use names goes with its bytes.
 *
 * @param {string} markdown
 * @returns {{markdown: string, pictures: TakenPicture[]}}
 */
export function takePictures(markdown) {
  if (!markdown.includes('data:')) return { markdown, pictures: [] }
  const lines = markdown.split('\n')
  /** @type {TakenPicture[]} */
  const pictures = []
  /** @type {Map<string, {label: string, mime: string, bytes: Uint8Array, marker?: string}>} */
  const defined = new Map()
  /** @type {Set<number>} */
  const definitions = new Set()

  lines.forEach((line, index) => {
    const match = line.match(DEFINITION)
    if (!match) return
    const label = unescape(match[1])
    definitions.add(index)
    if (defined.has(label.toLowerCase())) return
    defined.set(label.toLowerCase(), {
      label,
      mime: match[2] || 'application/octet-stream',
      bytes: decodeDataPayload(match[3], match[4]),
    })
  })

  /** @param {Omit<TakenPicture, 'marker'>} picture */
  const take = picture => {
    const marker = markerFor(pictures.length + 1)
    pictures.push({ marker, ...picture })
    return marker
  }

  let changed = definitions.size > 0
  /** @type {string[]} */
  const out = []
  for (const [index, line] of lines.entries()) {
    if (definitions.has(index)) continue
    const taken = line
      .replace(INLINE, (_, alt, mime, params, data) => {
        const marker = take({
          mime: mime || 'application/octet-stream',
          bytes: decodeDataPayload(params, data),
        })
        return `![${alt}](${marker})`
      })
      .replace(REFERENCE, (whole, alt, label) => {
        const picture = defined.get(unescape(label || alt).toLowerCase())
        if (!picture) return whole
        picture.marker ??= take({ name: picture.label, mime: picture.mime, bytes: picture.bytes })
        // `![label]` and `![label][]` name it, and say nothing of it.
        return `![${label ? alt : ''}](${picture.marker})`
      })
    if (taken !== line) changed = true
    out.push(taken)
  }

  if (!changed) return { markdown, pictures }
  const tidied = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  return { markdown: markdown.endsWith('\n') ? `${tidied}\n` : tidied, pictures }
}

/**
 * A picture's width and height, or nothing when the engine cannot decode
 * it: an iPhone's HEIC in Chromium.
 *
 * @param {Blob} blob
 * @returns {Promise<{width?: number, height?: number}>}
 */
export async function measurePicture(blob) {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      if (size.width && size.height) return size
    }
  } catch {
    // An SVG, say, which some engines will not make a bitmap of: an image reads it.
  }
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return {}
  const url = URL.createObjectURL(blob)
  try {
    const image = document.createElement('img')
    image.src = url
    await image.decode()
    return image.naturalWidth && image.naturalHeight
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : {}
  } catch {
    return {}
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Make taken pictures a new document's own: each named (Google's `image1`
 * as `image1.png`, the rest `image.png`, `image (2).png` and on), measured,
 * and its path put where its marker was.
 *
 * @param {string} markdown - With the markers in it
 * @param {TakenPicture[]} pictures
 * @param {string} documentId - The document they will be in
 * @returns {Promise<{
 *   markdown: string,
 *   pictures: Record<string, import('@/types/models.js').PictureInfo>,
 *   files: Array<{key: string, blob: Blob}>,
 * }>}
 */
export async function placePictures(markdown, pictures, documentId) {
  /** @type {Set<string>} */
  const taken = new Set()
  /** @type {Record<string, import('@/types/models.js').PictureInfo>} */
  const known = {}
  /** @type {Array<{key: string, blob: Blob}>} */
  const files = []
  let text = markdown
  for (const picture of pictures) {
    const name = pictureName(picture.name, picture.mime, taken)
    const blob = new Blob([/** @type {BlobPart} */ (picture.bytes)], { type: picture.mime })
    known[name] = {
      mime: picture.mime,
      ...(await measurePicture(blob)),
      ...(picture.docsId && { docsId: picture.docsId }),
    }
    files.push({ key: pictureKey(documentId, name), blob })
    text = text.split(`](${picture.marker})`).join(`](${pictureHref(documentId, name)})`)
  }
  return { markdown: text, pictures: known, files }
}
