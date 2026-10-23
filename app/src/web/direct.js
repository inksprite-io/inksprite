/* global DOMParser, AbortSignal, File */
/**
 * @module web/direct
 * @description A page or a file read straight from its site: for a service
 * with no reader of its own (Brave's), and for keeping what is at an address
 * in the project. Only the desktop app can count on it, since a page in a
 * browser is refused by almost every other site; the request goes out from
 * Electron's main process (`platform/fetch.js`).
 *
 * A page is made markdown the way an editor document would be: the
 * clean-up `files/html.js` does (scripts, navigation, headers, footers and
 * forms out), the article where the page marks one, links made whole, and
 * then the editor's own parser and serialiser, so headings, lists and links
 * survive and nothing the editor cannot show comes through.
 *
 * Anything else at the address is a file: a PDF, a Word file, an epub, plain
 * text. Its text is read out the way an import reads it, and the read keeps
 * the file itself, so that saving it keeps the file rather than its words and
 * does not fetch it a second time.
 */

import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model'
import { fetch } from '@/platform/fetch.js'
import { DROPPED } from '@/files/html.js'
import { docxToMarkdown, isDocx } from '@/files/docx.js'
import { UNKNOWN_MIME, extensionFor, inspectFile, mimeOf, titleOf } from '@/files/inspect.js'
import { schema } from '@/editor/schema.js'
import { serializeMarkdown } from '@/editor/markdown.js'
import { ServiceError } from './answers.js'

/** @typedef {import('./answers.js').Page} Page */

/** The most of a page read, in characters, before it is made markdown. */
const SOURCE_LENGTH = 5_000_000

/** The largest file fetched, in bytes. */
export const FILE_BYTES = 100 * 1024 * 1024

/** An article shorter than this is taken for a teaser, and the whole page read instead. */
const ARTICLE_LENGTH = 500

/**
 * What is at an address, fetched from its site: a page, or the file it is.
 *
 * @typedef {{page: Page}|{file: File}} Fetched
 */

/**
 * The markdown of a page's HTML.
 *
 * @param {string} source
 * @param {string} url - Where it was read, for its links
 * @returns {Page}
 */
export function pageOfHtml(source, url) {
  const document = new DOMParser().parseFromString(source, 'text/html')
  const title = document.querySelector('title')?.textContent?.trim()
  for (const node of document.querySelectorAll(`${DROPPED}, title, img, picture, video, audio`)) {
    node.remove()
  }
  const article = document.querySelector('article, main, [role="main"]')
  const root =
    article && (article.textContent || '').trim().length >= ARTICLE_LENGTH
      ? article
      : document.body || document.documentElement
  for (const link of root.querySelectorAll('a[href]')) {
    try {
      link.setAttribute('href', new URL(link.getAttribute('href') || '', url).href)
    } catch {
      link.removeAttribute('href')
    }
  }
  const text = serializeMarkdown(ProseMirrorDOMParser.fromSchema(schema).parse(root)).trim()
  return { ...(title ? { title } : {}), text }
}

/**
 * The name a file at an address goes by: the one its site gives it, or else
 * the last part of the address, with the extension its type has when the
 * name has none.
 *
 * @param {string} url - Where it was fetched from, after any redirect
 * @param {string|null} disposition - The site's Content-Disposition
 * @param {string} type - The site's media type for it, '' when it gave none
 * @returns {string}
 */
export function fileNameOf(url, disposition, type) {
  const given =
    disposition?.match(/filename\*\s*=\s*[^']*''([^;]+)/i)?.[1] ||
    disposition?.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ||
    disposition?.match(/filename\s*=\s*([^;]+)/i)?.[1]
  let name = ''
  try {
    name = decodeURIComponent((given || new URL(url).pathname.split('/').pop() || '').trim())
  } catch {
    name = (given || '').trim()
  }
  if (!name) {
    try {
      name = new URL(url).hostname
    } catch {
      name = 'download'
    }
  }
  const extension = extensionFor(type)
  return extension && !/\.[a-z0-9]{1,5}$/i.test(name) ? `${name}.${extension}` : name
}

/**
 * Ask a site for what is at an address.
 *
 * @param {string} url
 * @param {{signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<Response>}
 * @throws {ServiceError} When the site cannot be reached, or will not answer
 */
async function askSite(url, { signal, timeout }) {
  const signals = [signal, timeout ? AbortSignal.timeout(timeout) : undefined].filter(Boolean)
  let response
  try {
    response = await fetch(url, {
      headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: signals.length ? AbortSignal.any(/** @type {AbortSignal[]} */ (signals)) : undefined,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ServiceError(`${url} couldn’t be reached.`)
  }
  if (response.status === 404 || response.status === 410) {
    throw new ServiceError(`There is no page at ${url} (${response.status}).`)
  }
  if (!response.ok) {
    throw new ServiceError(`${url} would not be read (${response.status}).`)
  }
  return response
}

/**
 * Fetch what is at an address from its site: a page as markdown, anything
 * else as the file it is.
 *
 * A type the site did not give is the address's to say, by its extension; an
 * address that says nothing either is a page if it reads like one.
 *
 * @param {string} url
 * @param {{signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<Fetched>}
 * @throws {ServiceError} When the site cannot be reached or will not answer,
 *   or the file is too big to fetch
 */
export async function fetchDirect(url, options) {
  const response = await askSite(url, options)
  const where = response.url || url
  const declared = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const name = fileNameOf(where, response.headers.get('content-disposition'), declared)
  const type = declared || mimeOf(name, '')
  if (/html|xhtml/.test(type)) {
    return { page: pageOfHtml((await response.text()).slice(0, SOURCE_LENGTH), where) }
  }

  const length = Number(response.headers.get('content-length'))
  if (length > FILE_BYTES) throw new ServiceError(`${url} is too big to fetch here.`)
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > FILE_BYTES) throw new ServiceError(`${url} is too big to fetch here.`)
  if (type === UNKNOWN_MIME) {
    const source = new TextDecoder().decode(bytes)
    if (/^\s*</.test(source)) return { page: pageOfHtml(source.slice(0, SOURCE_LENGTH), where) }
  }
  return { file: new File([bytes], name, { type }) }
}

/**
 * A file as a page to read: its text, read out the way an import reads it,
 * and the file itself.
 *
 * @param {File} file
 * @param {string} url - Where it came from, for saying what could not be read
 * @returns {Promise<Page>}
 * @throws {ServiceError} When it has no text to read
 */
export async function pageOfFile(file, url) {
  const keep = 'save_web_page can still keep the file.'
  let read
  try {
    read = isDocx(file)
      ? { mime: file.type, text: (await docxToMarkdown(await file.arrayBuffer())).markdown }
      : await inspectFile(file)
  } catch {
    throw new ServiceError(`${url} is a file that couldn’t be opened.`)
  }
  if (!read.text.trim()) {
    const kind = extensionFor(read.mime).toUpperCase() || read.mime
    throw new ServiceError(`${url} is a ${kind} file with no text to read. ${keep}`)
  }
  return {
    title: titleOf(file.name, read.mime),
    text: read.text.slice(0, SOURCE_LENGTH),
    file,
  }
}

/**
 * Read a page from its site, or the text of the file there.
 *
 * @param {string} url
 * @param {{signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<Page>}
 */
export async function readDirect(url, options) {
  const fetched = await fetchDirect(url, options)
  return 'page' in fetched ? fetched.page : pageOfFile(fetched.file, url)
}
