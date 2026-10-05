/**
 * @module mcp/saved
 * @description A server's tool result kept in the project as a document.
 *
 * What a tool returns is the model's for one turn: the next turn sends the
 * conversation's words and not the calls, so an issue or a page read through
 * a server is gone again unless something keeps it. Saving it makes it a
 * document like any other, to pin, read again, or write from — the reference
 * material a design is written against.
 *
 * A line at the top says where it came from and when, for the writer and the
 * model alike: a saved page is a copy, and a copy should say it is one.
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
 * A result as the document it is saved as: where it came from, then the
 * result itself — as it read, or as a block of JSON when that is what it is.
 *
 * @param {{result: string, server: string, tool: string, args: any, date?: Date}} saved
 * @returns {string} Markdown
 */
export function savedContent({ result, server, tool, args, date = new Date() }) {
  const when = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const asked = formatToolArguments(args)
  const source = `*From ${server}: ${tool}${asked ? ` (${asked})` : ''}, saved ${when}.*`
  const read = parsed(result)
  const body =
    read !== undefined ? `\`\`\`json\n${JSON.stringify(read, null, 2)}\n\`\`\`` : result.trim()
  return `${source}\n\n${body}\n`
}
