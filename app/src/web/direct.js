/* global DOMParser, AbortSignal */
/**
 * @module web/direct
 * @description A page read straight from its site, for a service with no
 * reader of its own: Brave's. Only the desktop app can, since a page in a
 * browser is refused by almost every other site; the request goes out from
 * Electron's main process (`platform/fetch.js`).
 *
 * The page is made markdown the way an editor document would be: the
 * clean-up `files/html.js` does (scripts, navigation, headers, footers and
 * forms out), the article where the page marks one, links made whole, and
 * then the editor's own parser and serialiser, so headings, lists and links
 * survive and nothing the editor cannot show comes through.
 */

import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model'
import { fetch } from '@/platform/fetch.js'
import { DROPPED } from '@/files/html.js'
import { schema } from '@/editor/schema.js'
import { serializeMarkdown } from '@/editor/markdown.js'
import { ServiceError } from './answers.js'

/** @typedef {import('./answers.js').Page} Page */

/** The most of a page read, in characters, before it is made markdown. */
const SOURCE_LENGTH = 5_000_000

/** An article shorter than this is taken for a teaser, and the whole page read instead. */
const ARTICLE_LENGTH = 500

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
 * Read a page from its site.
 *
 * @param {string} url
 * @param {{signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<Page>}
 */
export async function readDirect(url, { signal, timeout }) {
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
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const source = (await response.text()).slice(0, SOURCE_LENGTH)
  if (/html|xml/.test(type) || (!type && /^\s*</.test(source))) {
    return pageOfHtml(source, response.url || url)
  }
  if (type.startsWith('text/') || type.endsWith('json')) return { text: source }
  throw new ServiceError(`${url} is not a page that can be read here (${type}).`)
}
