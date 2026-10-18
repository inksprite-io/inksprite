/* global File */
/**
 * @module drive/fetch
 * @description A picked file fetched from Drive as a `File`, for the
 * importer to take as it takes one from disk.
 *
 * A Doc is read through the Docs API and converted (`drive/convert`), its
 * pictures fetched from the addresses the Docs API gives them. Where
 * it cannot be, and for Google's other types, which have no bytes of their
 * own, Drive exports it: a Doc as markdown, mended where Google's markdown
 * is wrong (`drive/export`), a Sheet as CSV (its first sheet), Slides as a
 * PDF, a Drawing as a PNG. Anything else is downloaded as it is. A Doc's
 * document keeps its id.
 */

import { fetch } from '@/platform/fetch.js'
import { isDesktop } from '@/platform/desktop.js'
import { FILES, ask, readDocument } from './api.js'
import { readDoc, tabsOf } from './convert.js'
import { DriveError, SignInLapsedError } from './errors.js'
import { mendExport } from './export.js'
import { takePictures } from '@/files/pictures.js'

/**
 * A picked file, as Drive describes it.
 *
 * @typedef {Object} PickedFile
 * @property {string} id
 * @property {string} name - As Drive shows it; a Google Doc's has no extension
 * @property {string} mimeType - A Google type (`application/vnd.google-apps.document`) or the file's own
 */

/** What Google's own types are prefixed with. */
const GOOGLE_TYPE = 'application/vnd.google-apps.'

/** A Google Doc's type. */
export const DOC_TYPE = `${GOOGLE_TYPE}document`

/**
 * Google's types that export, and as what.
 *
 * @type {Record<string, {mime: string, extension: string}>}
 */
export const EXPORTS = {
  document: { mime: 'text/markdown', extension: 'md' },
  spreadsheet: { mime: 'text/csv', extension: 'csv' },
  presentation: { mime: 'application/pdf', extension: 'pdf' },
  drawing: { mime: 'image/png', extension: 'png' },
}

/**
 * Google's types that do not, by what the writer would call them.
 *
 * @type {Record<string, string>}
 */
const UNEXPORTABLE = {
  form: 'Google Forms',
  site: 'Google Sites',
  map: 'Google My Maps',
  jam: 'Jamboards',
  script: 'Apps Script projects',
  shortcut: 'Shortcuts',
  folder: 'Folders',
}

/**
 * How a picked file is fetched, or why it cannot be.
 *
 * @typedef {{url: string, name: string, mime: string}|{skip: string}} DriveRequest
 */

/**
 * The request for a picked file: an export for Google's types, the file's
 * bytes for anything else, or the reason there is nothing to fetch.
 *
 * A Doc comes back as `<name>.md`, which the importer reads as markdown
 * and titles without the `.md`, so a Doc named `Ch. 3` keeps its name.
 *
 * @param {PickedFile} picked
 * @returns {DriveRequest}
 */
export function requestFor(picked) {
  const id = encodeURIComponent(picked.id)
  if (!picked.mimeType.startsWith(GOOGLE_TYPE)) {
    return {
      url: `${FILES}/${id}?alt=media&supportsAllDrives=true`,
      name: picked.name,
      mime: picked.mimeType,
    }
  }
  const kind = picked.mimeType.slice(GOOGLE_TYPE.length)
  const exported = EXPORTS[kind]
  if (!exported) {
    return { skip: `${UNEXPORTABLE[kind] || 'Files of this kind'} can’t be exported` }
  }
  return {
    url: `${FILES}/${id}/export?mimeType=${encodeURIComponent(exported.mime)}`,
    name: `${picked.name}.${exported.extension}`,
    mime: exported.mime,
  }
}

/**
 * What the document a picked file becomes keeps of it: a Google Doc's id,
 * so it can be synced with its Doc later without another pick. Anything else
 * comes in as a copy, linked to nothing.
 *
 * @param {PickedFile} picked
 * @returns {import('../types/models.js').DriveLink|undefined}
 */
export function linkFor(picked) {
  return picked.mimeType === DOC_TYPE ? { id: picked.id } : undefined
}

/**
 * Fetch a picked file from Drive.
 *
 * @param {PickedFile} picked
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<File>}
 * @throws {DriveError} When it cannot be exported or Drive refuses it
 * @throws {SignInLapsedError} When Drive no longer takes the token
 */
export async function fetchPicked(picked, token, { signal } = {}) {
  const request = requestFor(picked)
  if ('skip' in request) throw new DriveError(request.skip)
  const response = await ask(request.url, token, { signal })
  if (picked.mimeType === DOC_TYPE) {
    return new File([mendExport(await response.text())], request.name, { type: request.mime })
  }
  const blob = await response.blob()
  return new File([blob], request.name, { type: request.mime })
}

/**
 * A Doc read through the Docs API and converted, as the markdown `File` its
 * export would be, with what the converter found in it. Suggested edits
 * still open are read as if rejected, so it comes in as it was before them.
 * Its pictures come with the file, a marker in its text where each was. In
 * the desktop app they are fetched from the addresses the Docs API gives
 * them. A page cannot have them from there: Google answers a page's plain
 * request with 429 and its request with the token with no CORS (seen 17 Oct
 * 2026). So in a browser, and for any the desktop could not fetch, they are
 * taken from Google's export, where every picture is written in, if they can
 * be matched to the Doc's. One that will not come either way is left out,
 * and counted.
 *
 * Null when the export is to be used instead: the Docs API refused (a Cloud
 * project without it), the Doc has more than one tab, which the export may
 * hold all of, or the converter could not read it.
 *
 * @param {PickedFile} picked - A Doc
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{
 *   file: File,
 *   pictures: import('@/files/pictures.js').TakenPicture[],
 *   images: number,
 *   suggestions: number,
 *   base: import('@/files/batch.js').BaseRead,
 * }|null>}
 * @throws {SignInLapsedError} When Drive no longer takes the token
 */
export async function convertPicked(picked, token, { signal } = {}) {
  /** @type {import('./docsTypes.js').Document} */
  let document
  try {
    document = await readDocument(picked.id, token, { signal })
  } catch (error) {
    if (signal?.aborted || error instanceof SignInLapsedError) throw error
    return null
  }
  if (tabsOf(document).length !== 1) return null
  try {
    let read = readDoc(document)
    const got = await fetchDocPictures(picked, token, document, read, { signal })
    // Read again without those that would not come, so no marker is left
    // without its picture.
    if (got.size < read.pictures.length) {
      const missing = read.pictures.filter(each => !got.has(each.object)).map(each => each.object)
      read = readDoc(document, { leaveOut: new Set(missing) })
    }
    const { mime, extension } = EXPORTS.document
    return {
      file: new File([read.markdown], `${picked.name}.${extension}`, { type: mime }),
      pictures: read.pictures.map((each, i) => {
        const picture = /** @type {FetchedPicture} */ (got.get(each.object))
        // Named as the export names a Doc's: image1, image2 and on.
        return { marker: each.marker, name: `image${i + 1}`, ...picture, docsId: each.object }
      }),
      images: read.images,
      suggestions: read.suggestions,
      base: { revisionId: read.revisionId, tabId: read.tabId },
    }
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn(`Couldn’t convert “${picked.name}”, so its export is used`, error)
    return null
  }
}

/**
 * A picture's bytes, and what they are.
 *
 * @typedef {{mime: string, bytes: Uint8Array}} FetchedPicture
 */

/**
 * A Doc's pictures, by their inline objects' ids: those the read brought in,
 * or of those the ones asked for. In the desktop app they are fetched from
 * the addresses the Docs API gives them, one at a time, since the addresses
 * answer a crowd of requests with 429. A page cannot have them from there,
 * so in a browser, and for any the desktop could not fetch, they are taken
 * from Google's export. One that will not come either way is not in the map.
 *
 * @param {PickedFile} picked - The Doc
 * @param {string} token
 * @param {import('./docsTypes.js').Document} document - As read
 * @param {import('./convert.js').ReadDoc} read - It, read whole
 * @param {Object} [options]
 * @param {Set<string>} [options.wanted] - Those to fetch, by id; all otherwise
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Map<string, FetchedPicture>>}
 * @throws {SignInLapsedError} When Drive no longer takes the token
 */
export async function fetchDocPictures(picked, token, document, read, { wanted, signal } = {}) {
  const asked = read.pictures.filter(each => !wanted || wanted.has(each.object))
  /** @type {Map<string, FetchedPicture>} */
  const got = new Map()
  if (asked.length === 0) return got
  if (isDesktop()) {
    for (const each of asked) {
      const picture = await fetchPicture(each.uri, token, signal)
      if (picture) got.set(each.object, picture)
    }
  }
  if (got.size < asked.length) {
    const exported = await exportedPictures(picked, token, document, read, signal)
    for (const each of asked) {
      const picture = exported.get(each.object)
      if (picture && !got.has(each.object)) got.set(each.object, picture)
    }
  }
  return got
}

/**
 * A Doc's picture, from the address the Docs API gave it: for half an hour
 * after the read, to anyone with it, but not to a page. Asked for plainly,
 * again after the wait a 429 asks for, then with the token.
 *
 * @param {string} uri
 * @param {string} token
 * @param {AbortSignal} [signal]
 * @returns {Promise<{mime: string, bytes: Uint8Array}|null>} Null when it will not come
 */
async function fetchPicture(uri, token, signal) {
  /** @type {RequestInit} */
  const plain = { signal, referrerPolicy: 'no-referrer', credentials: 'omit' }
  /**
   * @param {RequestInit} init
   * @param {string} how
   * @returns {Promise<Response|null>}
   */
  const ask = async (init, how) => {
    try {
      const response = await fetch(uri, init)
      if (!response.ok) console.warn(`A Doc's picture answered ${response.status}, asked ${how}`)
      return response
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn(`A Doc's picture would not come, asked ${how}`, error)
      return null
    }
  }
  let response = await ask(plain, 'plainly')
  if (response?.status === 429) {
    await wait(retryAfter(response), signal)
    response = await ask(plain, 'again')
  }
  if (!response?.ok) {
    response = await ask(
      { ...plain, headers: { Authorization: `Bearer ${token}` } },
      'with the token'
    )
  }
  if (!response?.ok) return null
  try {
    const blob = await response.blob()
    return {
      mime: blob.type.startsWith('image/') ? blob.type : 'image/png',
      bytes: new Uint8Array(await blob.arrayBuffer()),
    }
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn(`A Doc's picture broke off`, error)
    return null
  }
}

/**
 * How long a 429 asks to wait, in milliseconds: its `Retry-After`, a second
 * when it says nothing, three at most.
 *
 * @param {Response} response
 * @returns {number}
 */
function retryAfter(response) {
  const seconds = Number(response.headers.get('Retry-After'))
  return Math.min(3000, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000)
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

/**
 * A Doc's pictures from Google's markdown export, where each is written in
 * whole, by the inline object it is. The export has them in the Doc's order,
 * with no ids, so they are matched by place: one for each of the Doc's inline
 * objects, drawings and pictures in tables among them, or one for each
 * picture the converter brought in. Any other count matches none.
 *
 * @param {PickedFile} picked
 * @param {string} token
 * @param {import('./docsTypes.js').Document} document
 * @param {import('./convert.js').ReadDoc} read
 * @param {AbortSignal} [signal]
 * @returns {Promise<Map<string, {mime: string, bytes: Uint8Array}>>}
 */
async function exportedPictures(picked, token, document, read, signal) {
  /** @type {Map<string, {mime: string, bytes: Uint8Array}>} */
  const out = new Map()
  let pictures
  try {
    pictures = takePictures(await (await fetchPicked(picked, token, { signal })).text()).pictures
  } catch (error) {
    if (signal?.aborted || error instanceof SignInLapsedError) throw error
    console.warn(`Couldn’t take a Doc's pictures from its export`, error)
    return out
  }
  const objects = objectsOf(document, read.tabId)
  const order =
    pictures.length === objects.length
      ? objects
      : pictures.length === read.pictures.length
        ? read.pictures.map(each => each.object)
        : null
  if (!order) {
    console.warn(
      `A Doc's export has ${pictures.length} pictures, and the Doc ${objects.length} inline objects`
    )
    return out
  }
  order.forEach((object, i) =>
    out.set(object, { mime: pictures[i].mime, bytes: pictures[i].bytes })
  )
  return out
}

/**
 * A tab's inline objects, by id, in the order its body has them, tables'
 * cells included.
 *
 * @param {import('./docsTypes.js').Document} document
 * @param {string} tabId
 * @returns {string[]}
 */
function objectsOf(document, tabId) {
  const tab = tabsOf(document).find(each => (each.tabProperties?.tabId ?? '') === tabId)
  /** @type {string[]} */
  const out = []
  /** @param {import('./docsTypes.js').StructuralElement[]} content */
  const walk = content => {
    for (const element of content) {
      for (const part of element.paragraph?.elements ?? []) {
        const id = part.inlineObjectElement?.inlineObjectId
        if (id) out.push(id)
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) walk(cell.content ?? [])
      }
    }
  }
  walk(tab?.documentTab?.body?.content ?? [])
  return out
}

/**
 * A picked file's name and type, which the picker does not hand back: only
 * the ids come back from Google's sign-in.
 *
 * @param {string} id
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<PickedFile>}
 * @throws {DriveError} When Drive refuses it
 * @throws {SignInLapsedError} When Drive no longer takes the token
 */
export async function describePicked(id, token, { signal } = {}) {
  const url = `${FILES}/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`
  /** @type {any} */
  const body = await (await ask(url, token, { signal })).json()
  return { id: body.id || id, name: body.name || id, mimeType: body.mimeType || '' }
}
