/**
 * @module ai/tools/web
 * @description The model's way to the web: a search, and a page read, through
 * whichever service the writer set up (see web/).
 *
 * The same two tools whatever the service, so they are described once and
 * tuned once, and switching service does not rename them in the middle of a
 * chat. A page reads like a document: markdown, capped as a document read is,
 * and read on from `next`. Both stay in the conversation, as every call does,
 * so a page read is there for the follow-up question.
 */

import { sliceAt } from './slices.js'
import { describeRefusal } from '@/web/answers.js'
import { serviceInUse } from '@/web/config.js'
import { readPage } from '@/web/pages.js'

/** The group the web tools are switched by. */
export const WEB_GROUP = 'web'

/** The page read's name, which Save to project keeps a result of. */
export const READ_WEB_PAGE = 'read_web_page'

/** How long a web call may take: a page read through a service can take thirty seconds. */
export const WEB_TIMEOUT_MS = 60000

/** What a call says when no service can search. */
const NOT_SET_UP = {
  error: 'Web search is not set up. The writer sets it up in Settings › Connections › Web search.',
}

export const webSearchDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: 'web_search',
    description:
      'Search the web. Answers up to five pages, each with its title, address, date when known, and the passage that matched. Search when the answer depends on something outside the project and what you already know: a current fact, a source to check, a detail to look up. A passage is a glimpse: read the page with read_web_page before quoting it or relying on more than the passage says, and say which page a fact came from.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for, as you would put it to a search engine.',
        },
      },
      required: ['query'],
    },
  },
}

export const readWebPageDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: READ_WEB_PAGE,
    description:
      'Read a web page as markdown, by its address: usually one web_search found. A page up to about 7,000 words comes whole; a longer one comes one slice at a time, with `next` for the offset to go on from. What you read stays in the conversation, so read a page once.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page’s full address, http or https.' },
        from: {
          type: 'number',
          description:
            'For a long page: the character offset to read from, as `next` gave it. Default 0, the top.',
        },
      },
      required: ['url'],
    },
  },
}

/**
 * The address a call gave, when it is one a page can be read at.
 *
 * @param {any} value
 * @returns {string|null}
 */
function webAddress(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * Search the web.
 *
 * @param {{query?: string}} args
 * @param {import('./registry.js').ToolContext} [context]
 * @returns {Promise<object>}
 */
export async function executeWebSearch(args, context) {
  const query = String(args?.query || '').trim()
  if (!query) return { error: 'Say what to search for: `query`.' }
  const using = serviceInUse()
  if (!using) return NOT_SET_UP
  const { service, key } = using
  const signal = context?.signal
  try {
    const answer = await service.search(query, { key, signal, timeout: WEB_TIMEOUT_MS })
    if ('results' in answer && answer.results.length === 0) {
      return { query, results: [], note: 'Nothing found. Try other words.' }
    }
    return { query, ...answer }
  } catch (error) {
    if (signal?.aborted) throw error
    return { error: describeRefusal(service.name, error, { limited: service.limited }) }
  }
}

/**
 * Read a web page, or the slice of it from `from`.
 *
 * @param {{url?: string, from?: number}} args
 * @param {import('./registry.js').ToolContext} [context]
 * @returns {Promise<object>}
 */
export async function executeReadWebPage(args, context) {
  const url = webAddress(args?.url)
  if (!url) return { error: 'Give the page’s full address, starting http:// or https://.' }
  const using = serviceInUse()
  if (!using) return NOT_SET_UP
  const { service, key } = using
  const signal = context?.signal
  try {
    const page = await readPage(service, url, { key, signal, timeout: WEB_TIMEOUT_MS })
    if (!page.text.trim()) return { error: `${service.name} found nothing to read at ${url}.` }
    const slice = sliceAt(page.text, Number(args?.from) || 0)
    return {
      url,
      ...(page.title ? { title: page.title } : {}),
      ...(page.published ? { published: page.published } : {}),
      from: slice.from,
      to: slice.to,
      length: slice.length,
      next: slice.next,
      ...(slice.next === null ? { note: 'This is the end of the page.' } : {}),
      content: slice.text,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return { error: describeRefusal(service.name, error, { limited: service.limited }) }
  }
}
