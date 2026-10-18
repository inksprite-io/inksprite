/**
 * @module composables/usePictures
 * @description What a picture's path in a document is, and opening one.
 *
 * A path is one of a document's own pictures (`.images/<id>/<name>`, see
 * `utils/pictures.js`), a link to a file document that is a picture, or an
 * address on the web. The editor draws what this says (`editor/pictures.js`),
 * and opens one: a picture at its own size in the viewer, an address outside
 * the app as a link's is. A picture pasted, dropped or inserted becomes the
 * document's own here (`take`), and so does one copied from another
 * document (`adopt`), so that each document keeps its own whatever becomes
 * of the other.
 *
 * Design: `.llm/images_design.md`.
 */

import { openUrl } from '@/platform/open.js'
import { filenameFor } from '@/files/download.js'
import { MIME_BY_EXTENSION, isImage } from '@/files/inspect.js'
import { measurePicture } from '@/files/pictures.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useFilesStore } from '@/stores/filesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { nameKey, splitExtension } from '@/storage/names.js'
import { isDocumentHref, readableHref, resolveLink } from '@/utils/documentLinks.js'
import { pictureHref, pictureKey, pictureName, pictureOf } from '@/utils/pictures.js'
import { useDocuments } from './useDocuments.js'
import { usePictureViewer } from './usePictureViewer.js'

/** @typedef {import('@/editor/pictures.js').PictureSource} PictureSource */

/**
 * The bytes of pictures just taken, by key, until storage has them: the
 * editor shows a picture the moment it is pasted.
 *
 * @type {Map<string, Blob>}
 */
const fresh = new Map()

/**
 * The bytes of pictures being copied from another document, by the key of
 * the copy, until storage has them.
 *
 * @type {Map<string, Promise<Blob|null>>}
 */
const copying = new Map()

/**
 * The host an address on the web is on; for one with none, such as a
 * `data:` address, its scheme.
 *
 * @param {string} src
 * @returns {string}
 */
function hostOf(src) {
  try {
    const url = new URL(src)
    return url.host || url.protocol.replace(/:$/, '')
  } catch {
    return src.slice(0, 40)
  }
}

/**
 * @param {string} storyId
 * @returns {{
 *   describe: (src: string, fromId?: string|null) => PictureSource,
 *   open: (src: string, fromId?: string|null, alt?: string|null) => void,
 *   take: (documentId: string, blob: Blob, name?: string) => string|null,
 *   adopt: (documentId: string, src: string) => string,
 *   bytesOf: (src: string, fromId?: string|null) => Promise<{blob: Blob, name: string}|null>,
 * }}
 */
export function usePictures(storyId) {
  const api = useDocuments(storyId)
  const viewer = usePictureViewer()
  /** @param {string} key */
  const bytes = async key =>
    fresh.get(key) ?? (await copying.get(key)) ?? useFilesStore().getFile(key)
  /** @type {import('@/utils/documentLinks.js').LinkTree} */
  const tree = { get: api.get, childrenOf: api.childrenOf, rootId: rootIdFor(storyId) }

  /**
   * What a picture's path is.
   *
   * @param {string} src
   * @param {string|null} [fromId] - The document it is in, which a link is read from
   * @returns {PictureSource}
   */
  const describe = (src, fromId) => {
    const own = pictureOf(src)
    if (own) {
      const known = api.get(own.documentId)?.pictures?.[own.name]
      if (!known) return { kind: 'missing', label: own.name }
      const key = pictureKey(own.documentId, own.name)
      const size =
        known.width && known.height ? { width: known.width, height: known.height } : undefined
      return { kind: 'picture', key, load: () => bytes(key), size }
    }
    if (!isDocumentHref(src)) return { kind: 'web', host: hostOf(src) }
    const document = resolveLink(tree, src, fromId)
    if (document?.type === 'file' && isImage(document.mime || '')) {
      return { kind: 'picture', key: document.id, load: () => bytes(document.id) }
    }
    return { kind: 'missing', label: readableHref(src) }
  }

  /**
   * Open a picture: at its own size, or an address on the web outside the
   * app. One that is not there is a placeholder that says so already.
   *
   * @param {string} src
   * @param {string|null} [fromId]
   * @param {string|null} [alt]
   */
  const open = (src, fromId, alt) => {
    const source = describe(src, fromId)
    if (source.kind === 'web') openUrl(src)
    else if (source.kind === 'picture') {
      viewer.show({ key: source.key, load: source.load, alt: alt || undefined })
    }
  }

  /**
   * Make a picture one of a document's own, and say the path its text
   * refers to it by. Named for what it came as (`market map.png`; a
   * screenshot's `image.png`, then `image (2).png`), its row said so at once
   * and its bytes kept; its size follows when it has been measured.
   *
   * @param {string} documentId - A text document
   * @param {Blob} blob - The picture, with its media type
   * @param {string} [name] - What it was called
   * @returns {string|null} Its path, or null when there is no such document
   */
  const take = (documentId, blob, name) => {
    const document = api.get(documentId)
    if (document?.type !== 'text') return null
    const store = useDocumentsStore()
    const mime = blob.type || 'application/octet-stream'
    const taken = new Set(Object.keys(document.pictures || {}).map(nameKey))
    const named = pictureName(name, mime, taken)
    store.updateDocument(documentId, {
      pictures: { ...(document.pictures || {}), [named]: { mime } },
    })

    const key = pictureKey(documentId, named)
    fresh.set(key, blob)
    useFilesStore()
      .putFile(key, storyId, blob)
      .catch(error => console.error(`Failed to keep the picture ${named}:`, error))
      .finally(() => fresh.delete(key))
    measurePicture(blob).then(size => {
      const now = api.get(documentId)?.pictures
      if (!size.width || !now?.[named]) return
      store.updateDocument(documentId, {
        pictures: { ...now, [named]: { ...now[named], ...size } },
      })
    })
    return pictureHref(documentId, named)
  }

  /**
   * Make a picture another document has this one's own: a copy under the
   * name it had, numbered when this one has that name, which shows at once
   * from the other's bytes until its own are kept. Anything else, and one of
   * this document's own, is its path as it is.
   *
   * @param {string} documentId - The text document it is pasted into
   * @param {string} src
   * @returns {string} The path to write
   */
  const adopt = (documentId, src) => {
    const other = pictureOf(src)
    const document = api.get(documentId)
    if (!other || other.documentId === documentId || document?.type !== 'text') return src
    const store = useDocumentsStore()
    // The other may be in another project, which the store holds if it has been opened.
    const known = store.getDocument(other.documentId)?.pictures?.[other.name]
    const extension = splitExtension(other.name).extension.slice(1).toLowerCase()
    const mime = known?.mime || MIME_BY_EXTENSION[extension] || 'application/octet-stream'
    const taken = new Set(Object.keys(document.pictures || {}).map(nameKey))
    const named = pictureName(other.name, mime, taken)
    const size = known?.width && known.height ? { width: known.width, height: known.height } : {}
    store.updateDocument(documentId, {
      pictures: { ...(document.pictures || {}), [named]: { mime, ...size } },
    })

    const key = pictureKey(documentId, named)
    const reading = bytes(pictureKey(other.documentId, other.name))
    copying.set(key, reading)
    reading
      .then(blob => blob && useFilesStore().putFile(key, storyId, blob))
      .catch(error => console.error(`Failed to copy the picture ${named}:`, error))
      .finally(() => copying.delete(key))
    return pictureHref(documentId, named)
  }

  /**
   * A picture's bytes and the name to save them under, for one that has
   * them here: a document's own, or a file document's.
   *
   * @param {string} src
   * @param {string|null} [fromId]
   * @returns {Promise<{blob: Blob, name: string}|null>}
   */
  const bytesOf = async (src, fromId) => {
    const source = describe(src, fromId)
    if (source.kind !== 'picture') return null
    const blob = await source.load()
    if (!blob) return null
    const own = pictureOf(src)
    const document = own ? null : resolveLink(tree, src, fromId)
    return { blob, name: own?.name || (document ? filenameFor(document) : 'picture') }
  }

  return { describe, open, take, adopt, bytesOf }
}
