/* global DOMParser */
/**
 * @module files/html
 * @description The text of a web page, without the page.
 *
 * A saved article is mostly not the article: stylesheets, scripts, the
 * navigation, the comment form. What a model should read, and what the text
 * view should show, is the words — with a line break where the page had one,
 * so paragraphs and headings stay paragraphs and headings.
 */

/** What is dropped whole: it is never the article. */
const DROPPED = 'script, style, noscript, template, svg, iframe, nav, header, footer, form'

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
