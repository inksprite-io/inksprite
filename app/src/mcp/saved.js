/**
 * @module mcp/saved
 * @description A server's tool result, or a web page the model read, kept in
 * the project as a document.
 *
 * What a tool returns stays in the conversation until a summary stands in for
 * the turn that called it, and then it is gone: an issue, or a page read
 * through a server or from the web. Saving it makes it a document like any
 * other, to pin, read again, or write from — the reference material a design
 * is written against.
 *
 * A line at the top says where it came from and when, for the writer and the
 * model alike: a saved page is a copy, and a copy should say it is one. A web
 * page is saved as its text, under its title, with its address in that line;
 * whole, though the model read it a slice at a time (`web/pages.js` has the
 * page), and only as the slice when the page can no longer be had.
 */

import { formatToolArguments } from '@/utils/formatters.js'

/** The longest a title made from a result's first line runs. */
const TITLE_LENGTH = 60

/**
 * @param {string} text
 * @returns {any}
 */
function parsed(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * The page a `read_web_page` result is, when it is one: its address, title,
 * and the text read.
 *
 * @param {string} result
 * @returns {{url: string, title?: string, content: string, from?: number, to?: number, length?: number}|null}
 */
export function webPageOf(result) {
  const read = parsed(result)
  return read &&
    typeof read === 'object' &&
    typeof read.url === 'string' &&
    typeof read.content === 'string'
    ? read
    : null
}

/**
 * Whether a result is one worth keeping: there is one, and it is not the
 * tool saying it failed.
 *
 * @param {string|null|undefined} result - What the tool returned, as the model read it
 * @returns {boolean}
 */
export function canSave(result) {
  if (typeof result !== 'string' || !result.trim()) return false
  const read = parsed(result)
  return !(read && typeof read === 'object' && !Array.isArray(read) && 'error' in read)
}

/** How far into a long line a colon still marks off a name: `ENG-123:`, `kenning:`. */
const NAME_BEFORE_COLON = 40

/**
 * A title for a saved result: its first heading or first line, or the tool's
 * name when it has neither. A line too long for a title gives the name before
 * its colon, when it starts with one, or its words up to the length, cut
 * between words: a title is a name in the tree, and one that trails off
 * reads like a mistake.
 *
 * @param {string} result
 * @param {string} fallback
 * @returns {string}
 */
export function savedTitle(result, fallback) {
  const page = webPageOf(result)
  if (page) return page.title ? savedTitle(page.title, fallback) : new URL(page.url).hostname
  if (parsed(result) !== undefined) return fallback
  const line = result
    .split('\n')
    .map(one => one.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  if (!line) return fallback
  if (line.length <= TITLE_LENGTH) return line

  const colon = line.indexOf(': ')
  if (colon > 0 && colon <= NAME_BEFORE_COLON) return line.slice(0, colon)
  const cut = line.slice(0, TITLE_LENGTH + 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, TITLE_LENGTH)).replace(
    /[,;:.-]+$/,
    ''
  )
}

/**
 * A read of part of a page as a read of all of it, the page's whole text in
 * place of the slice: what saving it keeps.
 *
 * @param {string} result - The read, as the model had it
 * @param {string} text - The whole page
 * @returns {string}
 */
export function wholeRead(result, text) {
  const page = webPageOf(result)
  if (!page) return result
  const length = text.length
  return JSON.stringify({ ...page, from: 0, to: length, length, next: null, content: text })
}

/**
 * Which part of a page a read was, as a reader counts, or '' for all of it.
 *
 * @param {{from?: number, to?: number, length?: number}} page
 * @returns {string}
 */
export function pagePart({ from = 0, to = 0, length = 0 }) {
  if (!from && to >= length) return ''
  const count = (/** @type {number} */ n) => n.toLocaleString('en')
  return `characters ${count(from + 1)}–${count(to)} of ${count(length)}`
}

/**
 * A result as the document it is saved as: where it came from, then the
 * result itself — as it read, or as a block of JSON when that is what it is.
 *
 * @param {{result: string, server: string, tool: string, args: any, date?: Date}} saved
 * @returns {string} Markdown
 */
export function savedContent({ result, server, tool, args, date = new Date() }) {
  const when = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const page = webPageOf(result)
  if (page) {
    const part = pagePart(page)
    return `*From ${page.url}${part ? ` (${part})` : ''}, saved ${when}.*\n\n${page.content.trim()}\n`
  }
  const asked = formatToolArguments(args)
  const source = `*From ${server}: ${tool}${asked ? ` (${asked})` : ''}, saved ${when}.*`
  const read = parsed(result)
  const body =
    read !== undefined ? `\`\`\`json\n${JSON.stringify(read, null, 2)}\n\`\`\`` : result.trim()
  return `${source}\n\n${body}\n`
}
