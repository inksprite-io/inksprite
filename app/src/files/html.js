/* global DOMParser */
/**
 * @module files/html
 * @description The text of a web page, without the page.
 *
 * A saved article is mostly not the article: stylesheets, scripts, the
 * navigation, the comment form. What a model should read is the words — with
 * a line break where the page had one, so paragraphs and headings stay
 * paragraphs and headings. What the viewer shows is the same article as
 * markdown, its headings, lists, emphasis and links kept (`markdownOfHtml`),
 * which is also how a Word file's HTML becomes a document.
 */

import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model'
import { schema } from '@/editor/schema.js'
import { serializeMarkdown } from '@/editor/markdown.js'

/** What is dropped whole: it is never the article. */
export const DROPPED = 'script, style, noscript, template, svg, iframe, nav, header, footer, form'

/**
 * What is dropped besides, for reading: anything that would load or play,
 * and pictures, which a document has nowhere to put.
 */
const UNSHOWN = 'img, picture, video, audio, object, embed, canvas, math'

/** Where a link to another site may point. */
const LINKED = /^(https?|mailto):/i

/** Elements that begin and end a line of their own. */
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

/**
 * The words of a page, one block to a line.
 *
 * Without a DOM to parse with — under Node, outside the tests — the source is
 * handed back as it is, which is still text.
 *
 * @param {string} source - The HTML
 * @returns {string}
 */
export function textOfHtml(source) {
  if (typeof DOMParser === 'undefined') return source
  const document = new DOMParser().parseFromString(source, 'text/html')
  for (const node of document.querySelectorAll(DROPPED)) node.remove()

  const title = document.querySelector('title')?.textContent?.trim()
  for (const node of document.querySelectorAll('title')) node.remove()
  /** @type {string[]} */
  const parts = []
  walk(document.body || document.documentElement, parts)

  const body = parts
    .join('')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return title && !body.startsWith(title) ? `${title}\n\n${body}` : body
}

/**
 * @param {Node} node
 * @param {string[]} parts
 */
function walk(node, parts) {
  if (node.nodeType === 3) {
    parts.push(node.nodeValue || '')
    return
  }
  if (node.nodeType !== 1) return
  const name = /** @type {Element} */ (node).tagName.toLowerCase()
  const block = BLOCKS.has(name)
  if (block) parts.push('\n')
  if (name === 'pre') {
    parts.push(node.textContent || '')
  } else {
    for (const child of node.childNodes) walk(child, parts)
  }
  if (block) parts.push('\n')
}

/**
 * A page as markdown, for reading: the article's blocks, emphasis, lists,
 * tables and links, read through the editor's schema as a paste is, so the
 * schema decides what comes through and the rest is left out.
 *
 * Nothing of the page runs or loads. Its head goes before it is parsed, as
 * a parser may fetch what a head links to; scripts, frames and pictures are
 * dropped with the rest of `DROPPED`; and what comes out is markdown, which
 * is rendered as the app renders any (`utils/markdown.js`). A link to
 * another site stays a link. One within the page or its own site is its
 * words: there is no site here for it to go to.
 *
 * @param {string} source - The HTML
 * @returns {string}
 */
export function markdownOfHtml(source) {
  const body = source.replace(/<head\b[\s\S]*?<\/head>/i, '')
  const page = new DOMParser().parseFromString(body, 'text/html')
  for (const node of page.querySelectorAll(`${DROPPED}, ${UNSHOWN}`)) node.remove()
  for (const link of page.querySelectorAll('a')) {
    if (!LINKED.test(link.getAttribute('href')?.trim() || '')) link.replaceWith(...link.childNodes)
  }
  return serializeMarkdown(ProseMirrorDOMParser.fromSchema(schema).parse(page.body)).trim()
}
