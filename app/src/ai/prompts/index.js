/**
 * @module ai/prompts
 * @description The built-in system prompts, and the rule for picking between
 * them. A chat uses one of these unless it stores a prompt of its own.
 *
 * These are source files rather than data, so an existing chat that hasn't
 * overridden anything picks up prompt improvements when the app updates. That
 * is also why they are read-only in the prompt library: the user's own prompts
 * live in the database (see stores/aiPromptStore.js), these do not.
 */

import chatPrompt from './chat.md?raw'
import adventurePrompt from './adventure.md?raw'
import roleplayPrompt from './roleplay.md?raw'
import roleplayCompactionPrompt from './roleplay-compaction.md?raw'
import roleplayNote from './roleplay-note.md?raw'

export const DEFAULT_CHAT_PROMPT = chatPrompt.trim()
export const DEFAULT_ADVENTURE_PROMPT = adventurePrompt.trim()
export const DEFAULT_ROLEPLAY_PROMPT = roleplayPrompt.trim()

/**
 * What a roleplay chat's compaction runs under.
 *
 * Not a prompt in the library — it is the Compact skill's, reworded by the
 * Roleplay profile. The default compaction asks what was decided and what is left to
 * do, which is the right question for an editorial chat and throws away
 * exactly what a played-out scene is made of.
 */
export const ROLEPLAY_COMPACTION_PROMPT = roleplayCompactionPrompt.trim()

/**
 * The author's note a roleplay chat starts with, carried by the Roleplay
 * profile and copied onto each chat made from it.
 *
 * Three lines, and they stay about three. They sit in the writer's latest
 * message, a few lines from generation, which is where anything written here
 * echoes hardest — so they are constraints and prohibitions rather than
 * adjectives. See `.llm/fiction-context-design.md` §1 and §6.4.
 */
export const DEFAULT_ROLEPLAY_NOTE = roleplayNote.trim()

/**
 * A prompt that ships with the app.
 *
 * @typedef {Object} BuiltInPrompt
 * @property {string} id - Stable identifier, prefixed so it cannot collide with a stored prompt
 * @property {string} name - Display name
 * @property {string} content - The prompt text
 */

export const CHAT_PROMPT_ID = 'builtin_chat'
export const ADVENTURE_PROMPT_ID = 'builtin_adventure'
export const ROLEPLAY_PROMPT_ID = 'builtin_roleplay'

/** @type {BuiltInPrompt[]} */
export const BUILT_IN_PROMPTS = [
  { id: CHAT_PROMPT_ID, name: 'Chat', content: DEFAULT_CHAT_PROMPT },
  { id: ADVENTURE_PROMPT_ID, name: 'Adventure', content: DEFAULT_ADVENTURE_PROMPT },
  { id: ROLEPLAY_PROMPT_ID, name: 'Roleplay', content: DEFAULT_ROLEPLAY_PROMPT },
]

/**
 * Whether an ID refers to a built-in prompt rather than a stored one.
 * @param {string|null|undefined} id - Prompt ID to test
 * @returns {boolean} True for built-in IDs
 */
export function isBuiltInPromptId(id) {
  return typeof id === 'string' && id.startsWith('builtin_')
}

/**
 * The built-in prompt with this ID, if there is one.
 * @param {string|null|undefined} id - Prompt ID to look up
 * @returns {BuiltInPrompt|null} The prompt, or null if the ID is not a built-in
 */
export function getBuiltInPrompt(id) {
  return BUILT_IN_PROMPTS.find(p => p.id === id) || null
}

/**
 * The prompt a chat falls back to when it has not chosen one.
 *
 * Adventure is a prompt in the library like any other, not a mode: pick it on
 * a chat and the assistant runs a game instead of an editorial conversation.
 */
export const DEFAULT_PROMPT_ID = CHAT_PROMPT_ID
