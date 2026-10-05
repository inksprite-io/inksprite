/**
 * @module composables/usePrompts
 * @description The system prompt library: the prompts that ship with the app
 * plus the ones the user has saved, in one list.
 *
 * A chat points at one prompt and sends its text as it stands, the way it
 * runs on a profile's parameters as they stand: an edit reaches every chat on
 * that prompt, and a chat that wants different wording gets a copy. The
 * built-ins are read-only, so editing one is what makes that copy — see
 * `components/writer/chats/ChatSettings.vue`.
 */

import { computed } from 'vue'
import { useAIPromptStore } from '@/stores/aiPromptStore'
import { BUILT_IN_PROMPTS, getBuiltInPrompt, isBuiltInPromptId } from '@/ai/prompts/index.js'

/** @typedef {import('../types/models.js').AIPrompt} AIPrompt */

/**
 * A prompt as the library presents it, whether it came from source or storage.
 *
 * @typedef {Object} PromptEntry
 * @property {string} id - Prompt identifier
 * @property {string} name - Display name
 * @property {string} content - The prompt text
 * @property {boolean} readOnly - True for the prompts that ship with the app
 */

/**
 * @param {AIPrompt} prompt - A stored prompt
 * @returns {PromptEntry} The same prompt in library form
 */
function toEntry(prompt) {
  return { id: prompt.id, name: prompt.name, content: prompt.content, readOnly: false }
}

/**
 * Composable for the app-wide system prompt library.
 *
 * @returns {{
 *   prompts: import('vue').ComputedRef<PromptEntry[]>,
 *   getPrompt: (id: string) => PromptEntry | null,
 *   ready: () => Promise<void>,
 *   savePrompt: (name: string, content: string) => PromptEntry,
 *   duplicatePrompt: (id: string, content?: string) => PromptEntry | null,
 *   updatePrompt: (id: string, updates: {name?: string, content?: string}) => PromptEntry | null,
 *   deletePrompt: (id: string) => boolean,
 * }}
 */
export const usePrompts = () => {
  // Constructing the store starts its load; the list below fills in when that
  // resolves, so there's nothing to await here.
  const promptStore = useAIPromptStore()

  // Built-ins lead the list: they're the starting point every chat falls back
  // to, and pinning them keeps their position stable as saved prompts are
  // added and renamed around them.
  const prompts = computed(() => [
    ...BUILT_IN_PROMPTS.map(p => ({ ...p, readOnly: true })),
    ...promptStore.getAllPromptsOrdered().map(toEntry),
  ])

  /**
   * Look up a prompt from either half of the library.
   * @param {string} id - Prompt ID
   * @returns {PromptEntry|null} The prompt, or null if it no longer exists
   */
  function getPrompt(id) {
    const builtIn = getBuiltInPrompt(id)
    if (builtIn) return { ...builtIn, readOnly: true }

    const stored = id ? promptStore.getPrompt(id) : null
    return stored ? toEntry(stored) : null
  }

  /**
   * Settles once the saved prompts have loaded. The built-ins are always
   * there, but a saved prompt looked up before this resolves is not — so
   * anything about to send a chat's prompt waits on it first.
   * @returns {Promise<void>}
   */
  function ready() {
    return promptStore.ensureInitialized()
  }

  /**
   * Save text to the library under a new name.
   * @param {string} name - Display name
   * @param {string} content - Prompt text
   * @returns {PromptEntry} The saved prompt
   */
  function savePrompt(name, content) {
    return toEntry(promptStore.createPrompt({ name, content }))
  }

  /**
   * Save a copy of a prompt under a new name — with its own text, or with text
   * of the caller's, which is how an edit to a read-only built-in becomes a
   * prompt of the user's own.
   *
   * @param {string} id - Prompt to copy
   * @param {string} [content] - Text for the copy, if not the original's
   * @returns {PromptEntry|null} The copy, or null if there is nothing to copy
   */
  function duplicatePrompt(id, content) {
    const source = getPrompt(id)
    if (!source) return null
    return savePrompt(`${source.name} copy`, content ?? source.content)
  }

  /**
   * Edit a saved prompt. Built-ins are read-only, so they're refused here
   * rather than silently forked.
   *
   * @param {string} id - Prompt ID
   * @param {{name?: string, content?: string}} updates - Fields to change
   * @returns {PromptEntry|null} The updated prompt, or null if it can't be edited
   */
  function updatePrompt(id, updates) {
    if (isBuiltInPromptId(id)) return null
    const updated = promptStore.updatePrompt(id, updates)
    return updated ? toEntry(updated) : null
  }

  /**
   * Remove a saved prompt from the library. Chats that loaded it keep their
   * copy of the text.
   *
   * @param {string} id - Prompt ID
   * @returns {boolean} True if deleted
   */
  function deletePrompt(id) {
    if (isBuiltInPromptId(id)) return false
    return promptStore.deletePrompt(id)
  }

  return { prompts, getPrompt, ready, savePrompt, duplicatePrompt, updatePrompt, deletePrompt }
}
