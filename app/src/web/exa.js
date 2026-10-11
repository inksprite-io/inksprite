/**
 * @module web/exa
 * @description Exa, through its hosted MCP server.
 *
 * The server answers a page, and answers one with no key too, up to a limit
 * per address that Exa does not publish; a key in `x-api-key` lifts it. Its
 * answers are text in a shape of its own, taken apart here: a search is a
 * block per result (`Title:`, `URL:`, `Published:`, then `Highlights:`),
 * blocks parted by `---`; a page is `# title`, a `URL:` line, a `Published:`
 * line when Exa knows a date, and the page.
 *
 * Its search takes an `objective` as well as the query, which its server
 * lists as required only to make models state one. It is left out: a generic
 * one says nothing. See .llm/web_search_design.md.
 */

import { callServerTool, listServer, resultForModel } from '@/mcp/client.js'
import { PAGE_LENGTH, PASSAGE_LENGTH, RESULTS, ServiceError, WHERE, clip } from './answers.js'

/** @typedef {import('./answers.js').SearchAnswer} SearchAnswer */
/** @typedef {import('./answers.js').SearchResult} SearchResult */
/** @typedef {import('./answers.js').Page} Page */

/** Where Exa's server answers. */
export const EXA_URL = 'https://mcp.exa.ai/mcp'

/** What a run-out free limit means for the writer. */
export const EXA_LIMITED = `Exa’s free searches have run out for now. An Exa key, added in ${WHERE}, lifts the limit.`

/**
 * Exa's server as the MCP client reaches it: with the key, when there is one.
 *
 * @param {string} [key]
 * @returns {import('../types/models.js').McpServer}
 */
function server(key) {
  return /** @type {any} */ ({
    id: 'web:exa',
    url: EXA_URL,
    ...(key ? { headers: { 'x-api-key': key } } : {}),
  })
}

/**
 * An answer's text, or the refusal it is.
 *
 * @param {any} result - A CallToolResult
 * @param {string} [url] - The page it was asked to read
 * @returns {string}
 */
function answerText(result, url) {
  const read = resultForModel(result)
  if (typeof read === 'string') return read
  if (/\b429\b|rate.?limit/i.test(read.error)) throw new ServiceError(EXA_LIMITED)
  // Said as a read from the page's own site says it (./direct.js).
  if (url && /\bCRAWL_NOT_FOUND\b/.test(read.error)) {
    throw new ServiceError(`There is no page at ${url}.`)
  }
  throw new ServiceError(`Exa failed: ${read.error}`)
}

/**
 * One of a result's fields, by its label.
 *
 * @param {string} block
 * @param {string} label
 * @returns {string|undefined}
 */
function field(block, label) {
  const value = block.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim()
  return value && value !== 'N/A' ? value : undefined
}

/**
 * A search's answer, taken apart into results. One whose shape is not Exa's
 * usual goes on as text rather than as nothing.
 *
 * @param {string} text
 * @returns {SearchAnswer}
 */
export function exaResults(text) {
  if (/^No search results found/i.test(text.trim())) return { results: [] }
  /** @type {SearchResult[]} */
  const results = []
  for (const block of text.split(/\n+---\n+/)) {
    const url = field(block, 'URL')
    if (!url) continue
    const passage = block.split(/^(?:Highlights:[ \t]*\n|Text:[ \t]*)/m)[1] || ''
    const published = field(block, 'Published')
    results.push({
      title: field(block, 'Title') || url,
      url,
      ...(published ? { published } : {}),
      text: clip(passage, PASSAGE_LENGTH),
    })
  }
  return results.length > 0 ? { results } : { text: clip(text, RESULTS * PASSAGE_LENGTH) }
}

/**
 * A page as Exa reads it: its title, its date when there is one, and its
 * text, without the lines they came on.
 *
 * @param {string} text
 * @returns {Page}
 */
export function exaPage(text) {
  const lines = text.split('\n')
  const title = lines[0]?.match(/^#\s+(.+)$/)?.[1]?.trim()
  let start = title ? 1 : 0
  if (/^URL:/.test(lines[start] || '')) start += 1
  const published = field(lines[start] || '', 'Published')
  if (/^Published:/.test(lines[start] || '')) start += 1
  return {
    ...(title ? { title } : {}),
    ...(published ? { published } : {}),
    text: lines.slice(start).join('\n').trim(),
  }
}

/**
 * Search with Exa.
 *
 * @param {string} query
 * @param {{key?: string, signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<SearchAnswer>}
 */
export async function searchExa(query, { key, signal, timeout }) {
  const result = await callServerTool(
    server(key),
    'web_search_exa',
    { query, numResults: RESULTS },
    { signal, timeout }
  )
  return exaResults(answerText(result))
}

/**
 * Read a page with Exa.
 *
 * @param {string} url
 * @param {{key?: string, signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<Page>}
 */
export async function readExa(url, { key, signal, timeout }) {
  const result = await callServerTool(
    server(key),
    'web_fetch_exa',
    { urls: [url], maxCharacters: PAGE_LENGTH },
    { signal, timeout }
  )
  return exaPage(answerText(result, url))
}

/**
 * Whether Exa answers with this key, or with none: its tools listed, which
 * costs nothing.
 *
 * @param {string} [key]
 * @returns {Promise<void>}
 */
export async function checkExa(key) {
  await listServer(server(key))
}
