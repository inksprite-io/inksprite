/**
 * @module web/kagi
 * @description Kagi, through its hosted MCP server.
 *
 * The server answers a page and wants a key as a bearer token. Kagi's own API
 * refuses a page, so the MCP server is the only way in from the browser, and
 * its search answers in the markdown its API calls experimental: passed on as
 * text, clipped, rather than taken apart by a guess at a shape that may
 * change. A page is markdown, its title the first heading when it has one.
 */

import { callServerTool, listServer, resultForModel } from '@/mcp/client.js'
import { RESULTS, SEARCH_TEXT_LENGTH, ServiceError, clip } from './answers.js'

/** @typedef {import('./answers.js').SearchAnswer} SearchAnswer */
/** @typedef {import('./answers.js').Page} Page */

/** Where Kagi's server answers. */
export const KAGI_URL = 'https://mcp.kagi.com/mcp'

/**
 * Kagi's server as the MCP client reaches it.
 *
 * @param {string} key
 * @returns {import('../types/models.js').McpServer}
 */
function server(key) {
  return /** @type {any} */ ({
    id: 'web:kagi',
    url: KAGI_URL,
    headers: { Authorization: `Bearer ${key}` },
  })
}

/**
 * An answer's text, or the refusal it is.
 *
 * @param {any} result - A CallToolResult
 * @returns {string}
 */
function answerText(result) {
  const read = resultForModel(result)
  if (typeof read === 'string') return read
  throw new ServiceError(`Kagi failed: ${read.error}`)
}

/**
 * A page as Kagi reads it.
 *
 * @param {string} text - Markdown
 * @returns {Page}
 */
export function kagiPage(text) {
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return { ...(title ? { title } : {}), text: text.trim() }
}

/**
 * Search with Kagi.
 *
 * @param {string} query
 * @param {{key?: string, signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<SearchAnswer>}
 */
export async function searchKagi(query, { key = '', signal, timeout }) {
  const result = await callServerTool(
    server(key),
    'kagi_search_fetch',
    { query, limit: RESULTS },
    { signal, timeout }
  )
  const text = answerText(result).trim()
  return text ? { text: clip(text, SEARCH_TEXT_LENGTH) } : { results: [] }
}

/**
 * Read a page with Kagi.
 *
 * @param {string} url
 * @param {{key?: string, signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<Page>}
 */
export async function readKagi(url, { key = '', signal, timeout }) {
  const result = await callServerTool(server(key), 'kagi_extract', { url }, { signal, timeout })
  return kagiPage(answerText(result))
}

/**
 * Whether Kagi takes this key: its tools listed, which it answers only with a
 * key, and which costs nothing.
 *
 * @param {string} [key]
 * @returns {Promise<void>}
 */
export async function checkKagi(key = '') {
  await listServer(server(key))
}
