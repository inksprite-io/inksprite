/**
 * @module utils/chatTabs
 * @description Tabs that hold a chat's text rather than a document: the
 * system prompt it runs under, its author's note, or its roleplay
 * instructions, edited in the plain text editor at a length the chat's
 * settings have no room for.
 *
 * They sit in the editor's tabs beside the documents, under ids no document
 * can have: a document's is `doc_` and a nanoid, which never has a colon in
 * it. They are kept with the rest, so a project reopens on them, and go when
 * their chat does.
 *
 * A skill of the writer's opens the same way, as its SKILL.md: a tab that
 * goes when the skill does. The skill is the app's and the tab the
 * project's, so one skill may be open in several.
 */

/**
 * Which of a chat's texts a tab holds.
 * @typedef {'prompt'|'note'|'roleplay-prompt'|'post-history'} ChatText
 */

/**
 * What each tab is called. The roleplay prompt says whose it is, since the
 * chat has a system prompt of its own and the tab may sit beside it.
 * @type {Record<ChatText, string>}
 */
export const CHAT_TEXT_TITLES = Object.freeze({
  prompt: 'System prompt',
  note: "Author's note",
  'roleplay-prompt': 'Roleplay system prompt',
  'post-history': 'Post-history instructions',
})

const CHAT_TAB = /^chat:(.+):([a-z-]+)$/

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
  const text = /** @type {ChatText} */ (match?.[2])
  return match && Object.hasOwn(CHAT_TEXT_TITLES, text) ? { chatId: match[1], text } : null
}

const SKILL_TAB = /^skill:(.+)$/

/**
 * The tab for one of the writer's skills, as its SKILL.md.
 * @param {string} skillId
 * @returns {string}
 */
export const skillTabId = skillId => `skill:${skillId}`

/**
 * The skill a tab holds, or null for any other tab.
 * @param {string|null|undefined} tabId
 * @returns {string|null}
 */
export function skillTabOf(tabId) {
  return (tabId ? SKILL_TAB.exec(tabId) : null)?.[1] ?? null
}
