/* global AbortSignal */
/**
 * @module web/brave
 * @description Brave, through its LLM Context endpoint.
 *
 * Brave refuses a page's origin, so only the desktop app can reach it, its
 * requests going out from Electron's main process (`platform/fetch.js`).
 * LLM Context answers with passages already taken out of each page (`snippets`)
 * rather than a search engine's one line, sized by a token budget; asked here
 * for five addresses and about two thousand tokens. Its dates are in
 * `sources`, by address. Brave has no reader, so a page is read from its site
 * (./direct.js).
 */

import { fetch } from '@/platform/fetch.js'
import { PASSAGE_LENGTH, RESULTS, clip } from './answers.js'

/** @typedef {import('./answers.js').SearchAnswer} SearchAnswer */
/** @typedef {import('./answers.js').SearchResult} SearchResult */

/** Where LLM Context answers. */
export const BRAVE_URL = 'https://api.search.brave.com/res/v1/llm/context'

/** The longest query Brave takes, in characters. */
const QUERY_LENGTH = 600

/** About how many tokens of passages a search asks for. */
const TOKENS = 2048

/**
 * Search with Brave.
 *
 * @param {string} query
 * @param {{key?: string, signal?: AbortSignal, timeout?: number}} options
 * @returns {Promise<SearchAnswer>}
 */
export async function searchBrave(query, { key = '', signal, timeout }) {
  const url = new URL(BRAVE_URL)
  url.searchParams.set('q', query.slice(0, QUERY_LENGTH))
  url.searchParams.set('maximum_number_of_urls', String(RESULTS))
  url.searchParams.set('maximum_number_of_tokens', String(TOKENS))
  const signals = [signal, timeout ? AbortSignal.timeout(timeout) : undefined].filter(Boolean)

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: signals.length ? AbortSignal.any(/** @type {AbortSignal[]} */ (signals)) : undefined,
  })
  if (!response.ok) {
    throw Object.assign(new Error(`Brave answered ${response.status}.`), {
      status: response.status,
    })
  }
  return braveResults(await response.json())
}

/**
 * LLM Context's answer, as results.
 *
 * @param {any} data
 * @returns {SearchAnswer}
 */
export function braveResults(data) {
  const sources = data?.sources || {}
  /** @type {SearchResult[]} */
  const results = []
  for (const item of data?.grounding?.generic || []) {
    if (!item?.url) continue
    const published = sources[item.url]?.age?.[1]
    results.push({
      title: item.title || sources[item.url]?.title || item.url,
      url: item.url,
      ...(published ? { published } : {}),
      text: clip((item.snippets || []).map(String).join('\n\n'), PASSAGE_LENGTH),
    })
  }
  return { results: results.slice(0, RESULTS) }
}
