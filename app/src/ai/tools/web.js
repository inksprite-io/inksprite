/**
 * @module ai/tools/web
 * @description The model's way to the web: a search, a page read, and a page
 * kept, through whichever service the writer set up (see web/).
 *
 * The same tools whatever the service, so they are described once and tuned
 * once, and switching service does not rename them in the middle of a chat.
 * A page reads like a document: markdown, capped as a document read is, and
 * read on from `next`. Both stay in the conversation, as every call does, so
 * a page read is there for the follow-up question.
 *
 * A page or a file worth more than the conversation is kept in the project by
 * `save_web_page`, as an import would keep it: a PDF as the PDF, where the
 * app can fetch it (web/keep.js). The writer is asked first, unless they said
 * not to be (`savesWithoutAsking`).
 */

import { sliceAt } from './slices.js'
import { folderToKeepIn, keptFrom, pathInProject } from './documents.js'
import { describeRefusal } from '@/web/answers.js'
import { serviceInUse } from '@/web/config.js'
import { fetchToKeep } from '@/web/keep.js'
import { readPage } from '@/web/pages.js'
import { savedPage } from '@/mcp/saved.js'
import { isDesktop } from '@/platform/desktop.js'
import { mimeOf, UNKNOWN_MIME } from '@/files/inspect.js'
import { useCardImport } from '@/composables/useCardImport.js'
import { useDocuments } from '@/composables/useDocuments.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'

/** The group the web tools are switched by. */
export const WEB_GROUP = 'web'

/** The page read's name, which Save to project keeps a result of. */
export const READ_WEB_PAGE = 'read_web_page'

/** The page save's name, which asks the writer before it runs. */
export const SAVE_WEB_PAGE = 'save_web_page'

/** How long a web call may take: a page read through a service can take thirty seconds. */
export const WEB_TIMEOUT_MS = 60000

/**
 * How long a save may take: a big PDF is a long download, and its text is
 * read out before it lands.
 */
export const SAVE_TIMEOUT_MS = 180000

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
      'Read a web page as markdown, by its address: usually one web_search found. A PDF or another document on the web reads as its text. A page up to about 7,000 words comes whole; a longer one comes one slice at a time, with `next` for the offset to go on from. What you read stays in the conversation, so read a page once; save_web_page keeps one worth having in the project.',
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

export const saveWebPageDefinition = {
  type: /** @type {const} */ ('function'),
  function: {
    name: SAVE_WEB_PAGE,
    description:
      'Keep a web page, or a document on the web such as a PDF, in the project, to read again or cite. Keep what is worth having after this conversation (a source the writer will want, or one you will come back to), not every page you read: read it first to know. The writer may be asked first. A PDF or other file is kept as the file itself where it can be fetched, and a page as its text. Answers with the path it is at, in the project already or saved there now.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full address of the page or the file, http or https.',
        },
        folder: {
          type: 'string',
          description:
            'The folder to put it in, by its path as list_documents gives it, which has to exist already. Default: the top of the project.',
        },
        title: {
          type: 'string',
          description: 'What to call it. Default: the page’s own title, or the file’s name.',
        },
      },
      required: ['url'],
    },
  },
}

/**
 * Whether an address names a file rather than a page, by its extension: a
 * PDF kept in a browser is kept as its text, and the answer says so.
 *
 * @param {string} url
 * @returns {boolean}
 */
function namesFile(url) {
  const type = mimeOf(new URL(url).pathname, '')
  return type !== UNKNOWN_MIME && !/html/.test(type)
}

/**
 * Keep a page, or a file, in the project.
 *
 * A file goes in as an import would take it: a PDF with its text read out, a
 * Word file as a document, converted on import when the writer has that on.
 * A page goes in as Save to project keeps one, its address and the day in
 * its first line. Both keep the address on the row (`url`), so the same
 * address is not kept twice.
 *
 * Not on the turn's record of changes, so going back past the turn does not
 * take it out: the writer allowed it into the project, or said to allow
 * every one, and it is theirs.
 *
 * @param {{url?: string, folder?: string, title?: string}} args
 * @param {import('./registry.js').ToolContext} [context]
 * @returns {Promise<object>}
 */
export async function executeSaveWebPage(args, context) {
  const url = webAddress(args?.url)
  if (!url) {
    return { error: 'Give the full address of the page or the file, starting http:// or https://.' }
  }
  if (!context?.storyId) return { error: 'No story context available' }
  const already = await keptFrom(context, url)
  if (already !== null) return { path: already, note: 'This is in the project already.' }
  const folder = await folderToKeepIn(context, args?.folder)
  if ('error' in folder) return folder

  const signal = context.signal
  let keepable
  try {
    keepable = await fetchToKeep(url, { signal, timeout: SAVE_TIMEOUT_MS })
  } catch (error) {
    if (signal?.aborted) throw error
    return { error: describeRefusal(serviceInUse()?.service.name || 'The site', error) }
  }

  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  let id
  try {
    if ('file' in keepable) {
      const importer = useCardImport(context.storyId)
      const found = await importer.inspect(keepable.file, { cards: false })
      if (title) {
        found.title = title
        if (found.shape === 'file') found.value = { ...found.value, title }
      }
      id = (await importer.write(found, { parentId: folder.id })).folderId
      useDocumentsStore().updateDocument(id, { url })
    } else {
      const { page } = keepable
      id = useDocuments(context.storyId).createTextDocument(
        folder.id,
        title || page.title || new URL(url).hostname,
        savedPage(url, page.text),
        { url }
      ).id
    }
  } catch (error) {
    return { error: `${url} couldn’t be kept: ${error instanceof Error ? error.message : error}` }
  }

  const asText = 'page' in keepable && keepable.read && !isDesktop() && namesFile(url)
  return {
    saved: true,
    path: await pathInProject(context, id),
    kept: 'file' in keepable ? 'file' : 'text',
    ...(asText
      ? { note: 'Kept as its text: a browser can’t fetch the file itself. The desktop app can.' }
      : {}),
  }
}
