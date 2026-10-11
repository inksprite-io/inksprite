/**
 * @module web/answers
 * @description What every search service hands back, and how a service's
 * refusal is said.
 *
 * The model is told the same things whichever service searched: a result is a
 * title, an address, a date when the service knows one, and the passage that
 * matched; a page is its title and its text as markdown. A service whose
 * answer cannot be taken apart into results (Kagi's markdown, which its API
 * calls experimental) is passed on as text instead.
 *
 * A refusal goes to the model as an error in the writer's words, since the
 * model passes it on: what happened, and where to change it.
 */

/**
 * @typedef {Object} SearchResult
 * @property {string} title
 * @property {string} url
 * @property {string} [published] - When the service says the page was
 *   published or last changed
 * @property {string} text - The passage that matched, clipped
 *
 * @typedef {{results: SearchResult[]}|{text: string}} SearchAnswer
 *
 * @typedef {Object} Page
 * @property {string} [title]
 * @property {string} [published] - When, as the service gave it
 * @property {string} text - Markdown
 */

/** How many results a search answers with. */
export const RESULTS = 5

/** The longest a result's passage runs, in characters: a few hundred words. */
export const PASSAGE_LENGTH = 2000

/** The longest a search answered as text runs: five passages' worth. */
export const SEARCH_TEXT_LENGTH = RESULTS * PASSAGE_LENGTH

/**
 * How much of a page a service is asked for, in characters. More than one
 * read returns, so a long page can be read on from where the last read
 * stopped without asking again.
 */
export const PAGE_LENGTH = 200000

/** Where the writer sets the service up, as a refusal names it. */
export const WHERE = 'Settings › Connections › Web search'

/**
 * Text cut to a length, between words where it can be, marked as cut.
 *
 * @param {string} text
 * @param {number} length
 * @returns {string}
 */
export function clip(text, length) {
  const trimmed = text.trim()
  if (trimmed.length <= length) return trimmed
  const cut = trimmed.slice(0, length)
  const space = cut.lastIndexOf(' ')
  return `${(space > length * 0.8 ? cut.slice(0, space) : cut).trimEnd()} …`
}

/**
 * A service's refusal: an Error whose message is already in the writer's
 * words.
 */
export class ServiceError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'ServiceError'
  }
}

/**
 * The HTTP status an error carries, if it carries one.
 *
 * @param {any} error
 * @returns {number|undefined}
 */
function statusOf(error) {
  const status = error?.data?.status ?? error?.status ?? error?.code
  return typeof status === 'number' ? status : undefined
}

/**
 * Why a service failed, for the writer.
 *
 * @param {string} name - The service, as the writer knows it
 * @param {any} error
 * @param {{limited?: string}} [says] - What the service's own limit means for
 *   the writer, said instead of the general line
 * @returns {string}
 */
export function describeRefusal(name, error, says = {}) {
  if (error instanceof ServiceError) return error.message
  const status = statusOf(error)
  if (status === 401 || error?.name === 'UnauthorizedError') {
    return `${name} refused the key. Check it in ${WHERE}.`
  }
  if (status === 403) return `${name} refused: the key doesn’t have access. Check it in ${WHERE}.`
  if (status === 429) return says.limited || `${name} says too many searches for now. Try later.`
  if (status && status >= 500) return `${name} had an error (${status}). Try again later.`
  if (error instanceof TypeError || /fetch|network|load failed/i.test(String(error?.message))) {
    return `${name} couldn’t be reached. Check the connection, or try again later.`
  }
  return `${name} failed: ${String(error?.message || error || 'it gave no reason.')}`
}
