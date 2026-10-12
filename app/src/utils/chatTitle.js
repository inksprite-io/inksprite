/**
 * @module utils/chatTitle
 * @description What a chat is called before it has a name, a title the
 * model wrote, made plain, and the plain words a chat's preview shows.
 */

/** What a chat is called until the model or the writer names it. */
export const DEFAULT_CHAT_TITLE = 'Untitled chat'

/**
 * What chats were called by default before there was one name for it. Chats
 * saved under them are still waiting for a name.
 */
const EARLIER_DEFAULTS = ['Untitled Chat', 'New Chat']

/**
 * Whether a chat has yet to be named: it carries the default, or a default it
 * was saved with before this one, or nothing at all.
 *
 * @param {string|null|undefined} title
 * @returns {boolean}
 */
export function isDefaultChatTitle(title) {
  const name = (title || '').trim()
  return !name || name === DEFAULT_CHAT_TITLE || EARLIER_DEFAULTS.includes(name)
}

/**
 * What a chat is shown as: its title, or the default while it has none of
 * its own.
 *
 * @param {string|null|undefined} title
 * @returns {string}
 */
export function shownChatTitle(title) {
  return isDefaultChatTitle(title) ? DEFAULT_CHAT_TITLE : /** @type {string} */ (title)
}

/**
 * A line of markdown as the words it says: without a heading's hashes, a
 * quote's or a list's marker, links' addresses, or the marks around bold,
 * italic, struck and code words. Shown as text, `**not**` would be read with
 * its stars.
 *
 * @param {string} line
 * @returns {string}
 */
export function plainLine(line) {
  return (line || '')
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:>\s*)+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
    .replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?![\w])/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
}

/**
 * A line of the model's as a title: plain, without a "Title:" it was
 * introduced with, or the quotes it was put in.
 *
 * @param {string} line
 * @returns {string}
 */
export function plainTitle(line) {
  return plainLine(line)
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .trim()
}

/**
 * The start of a message as a chat's preview: its lines made plain and run
 * together, without any HTML, cut at a hundred characters.
 *
 * @param {string} content
 * @returns {string}
 */
export function chatPreview(content) {
  const text = (content || '')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map(plainLine)
    .filter(Boolean)
    .join(' ')
  return text.length > 100 ? `${text.slice(0, 100)}…` : text
}
