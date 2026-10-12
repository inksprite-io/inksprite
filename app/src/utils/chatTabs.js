/**
 * @module utils/chatTabs
 * @description Tabs that hold a chat's text rather than a document: the
 * system prompt it runs under, or its author's note, edited in the plain text
 * editor at a length the chat's settings have no room for.
 *
 * They sit in the editor's tabs beside the documents, under ids no document
 * can have: a document's is `doc_` and a nanoid, which never has a colon in
 * it. They are kept with the rest, so a project reopens on them, and go when
 * their chat does.
 */

/**
 * Which of a chat's texts a tab holds.
 * @typedef {'prompt'|'note'} ChatText
 */

/** What each tab is called. @type {Record<ChatText, string>} */
export const CHAT_TEXT_TITLES = Object.freeze({
  prompt: 'System prompt',
  note: "Author's note",
})

const CHAT_TAB = /^chat:(.+):([a-z]+)$/

/**
 * The tab for one of a chat's texts.
 * @param {string} chatId
 * @param {ChatText} text
 * @returns {string}
 */
export const chatTabId = (chatId, text) => `chat:${chatId}:${text}`

/**
 * The chat and the text a tab holds, or null for a document's tab.
 * @param {string|null|undefined} tabId
 * @returns {{ chatId: string, text: ChatText }|null}
 */
export function chatTabOf(tabId) {
  const match = tabId ? CHAT_TAB.exec(tabId) : null
  const text = match?.[2]
  return match && (text === 'prompt' || text === 'note') ? { chatId: match[1], text } : null
}
