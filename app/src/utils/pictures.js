/**
 * @module utils/pictures
 * @description A document's own pictures, as its text refers to them.
 *
 * A picture pasted or dropped into a document is the document's, as in a
 * Google Doc: not a document of its own, not in the outline, not renamed or
 * edited once it is in. Its text refers to it by a path from the document's
 * folder, `.images/<document id>/<name>`, which on desktop is where the
 * picture is on disk, beside the document and moved with it. The id makes the
 * path the same however the document is renamed or moved, so it is read by the
 * id, wherever it is written and whatever comes before it.
 *
 * What the document knows of each picture (its media type and size) is on its
 * row, under `pictures`, by name. The bytes are kept under `pictureKey`: in
 * the `files` table in a browser, in `.images/<id>/` in the library.
 *
 * Design: `.llm/images_design.md`.
 */

import { encodeName } from './documentLinks.js'
import { extensionFor } from '@/files/inspect.js'
import { claimName, safeName, splitExtension } from '@/storage/names.js'

/** The folder a document's pictures are kept in, beside it. */
export const PICTURES_DIR = '.images'

/** The characters a document's id is made of: `doc_` and a nanoid, or an older id's prefix. */
const ID = '[A-Za-z0-9_-]+'

/** A picture's path, at the end of a destination: what is read of one. */
const PATH = new RegExp(`(?:^|/)\\.images/(${ID})/([^/]+)$`)

/**
 * Pictures in markdown, written plain (`](.images/doc_x/map.png)`) or in
 * `<…>`, where a name may have its spaces left in.
 */
const PLAIN = new RegExp(`\\.images/(${ID})/([^\\s()<>"/\\\\]+)`, 'g')
const ANGLED = new RegExp(`<[^<>\\n]*?\\.images/(${ID})/([^<>\\n/]+)>`, 'g')

/**
 * One of a document's pictures, as its row has it.
 *
 * @typedef {import('../types/models.js').PictureInfo} PictureInfo
 */

/**
 * A name as it was written, decoded. A `%` that starts no escape is a `%`.
 *
 * @param {string} name
 * @returns {string}
 */
function decoded(name) {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/**
 * The extension a picture of this type is named with: the usual one where
 * it is known, the type's own name otherwise (`image/heic`, `heic`).
 *
 * @param {string} mime
 * @returns {string} Without the dot; '' for no type at all
 */
function extensionOf(mime) {
  const known = extensionFor(mime)
  if (known) return known
  const subtype = /^image\/([a-z0-9.-]+)/i.exec(mime)?.[1] || ''
  return subtype.replace(/^x-/, '').toLowerCase()
}

/**
 * The name a picture takes in a document: the one it came with, made safe
 * for a file and given an extension when it has none, or `image`; and
 * `(2)`, `(3)` and on when the document has one by that name already.
 *
 * @param {string|undefined} wanted - What it was called, a file's name or a Doc's label
 * @param {string} mime - Its media type
 * @param {Set<string>} taken - The keys of the names in use (`nameKey`); the one chosen is added
 * @returns {string}
 */
export function pictureName(wanted, mime, taken) {
  const { stem, extension } = splitExtension(safeName(wanted?.trim() || 'image'))
  const own = extensionOf(mime)
  return claimName(taken, stem, extension || (own ? `.${own}` : ''))
}

/**
 * The path a document's text refers to one of its pictures by.
 *
 * @param {string} documentId
 * @param {string} name
 * @returns {string}
 */
export function pictureHref(documentId, name) {
  return `${PICTURES_DIR}/${documentId}/${encodeName(name)}`
}

/**
 * The picture a path refers to, or null when it is not one of a document's
 * own: a link to a file document, or an address on the web.
 *
 * @param {string|null|undefined} src
 * @returns {{documentId: string, name: string}|null}
 */
export function pictureOf(src) {
  let text = (src || '').trim()
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1).trim()
  const found = PATH.exec(text.replace(/[?#].*$/s, ''))
  if (!found) return null
  const name = decoded(found[2])
  return name ? { documentId: found[1], name } : null
}

/**
 * Where a picture's bytes are kept, in the `files` table and the stores'
 * calls for a file's bytes.
 *
 * @param {string} documentId
 * @param {string} name
 * @returns {string}
 */
export function pictureKey(documentId, name) {
  return `${documentId}/${name}`
}

/**
 * The document a key of `pictureKey`'s belongs to, or null for a file
 * document's own key, which has no `/` in it.
 *
 * @param {string} key
 * @returns {{documentId: string, name: string}|null}
 */
export function pictureOfKey(key) {
  const at = key.indexOf('/')
  if (at <= 0) return null
  return { documentId: key.slice(0, at), name: key.slice(at + 1) }
}

/**
 * The keys of every picture a document's text refers to, its own and any
 * other's, comment and suggestion markup and all. A look at the text, not a
 * parse of it: it may find a path in a code span too, which only keeps a
 * picture that would otherwise go.
 *
 * @param {string|null|undefined} markdown
 * @returns {Set<string>}
 */
export function picturesIn(markdown) {
  /** @type {Set<string>} */
  const keys = new Set()
  if (!markdown || !markdown.includes(`${PICTURES_DIR}/`)) return keys
  const add = (/** @type {string} */ documentId, /** @type {string} */ name) =>
    keys.add(pictureKey(documentId, decoded(name)))
  // The ones in `<…>` first, and out of the way, so that a name with a space
  // in it is not also found cut short at the space.
  const rest = markdown.replace(ANGLED, (_, documentId, name) => {
    add(documentId, name)
    return ''
  })
  for (const [, documentId, name] of rest.matchAll(PLAIN)) add(documentId, name)
  return keys
}

/**
 * A document's text with its paths to one document's pictures made paths to
 * another's: a copy's text, whose pictures are copied under its own id.
 *
 * @param {string} markdown
 * @param {string} fromId
 * @param {string} toId
 * @returns {string}
 */
export function repointPictures(markdown, fromId, toId) {
  if (!markdown || fromId === toId) return markdown
  return markdown.split(`${PICTURES_DIR}/${fromId}/`).join(`${PICTURES_DIR}/${toId}/`)
}

/**
 * The names of a document's pictures that no text refers to.
 *
 * @param {string} documentId
 * @param {Record<string, PictureInfo>|undefined} pictures - Its row's
 * @param {Set<string>} referred - Every key the project's text refers to
 * @returns {string[]}
 */
export function unreferencedPictures(documentId, pictures, referred) {
  return Object.keys(pictures || {}).filter(name => !referred.has(pictureKey(documentId, name)))
}
