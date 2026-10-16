/**
 * @module composables/useChatRequest
 * @description Where a chat is asked to be shown from anywhere in the writer.
 *
 * The chat showing is the writer's frame's to choose, and a project switched
 * to brings back the chat last looked at in it. Something that starts a chat
 * in another project, such as the card library making a project for a card
 * and starting a chat on it, asks here before opening the project, and the
 * frame shows that chat once the project is the one open.
 *
 * One state for the app: every caller shares the same request.
 */

import { ref } from 'vue'

/**
 * The chat asked for, and the project it is in.
 * @type {import('vue').Ref<{storyId: string, chatId: string}|null>}
 */
const requested = ref(null)

/**
 * @returns {{
 *   requested: import('vue').Ref<{storyId: string, chatId: string}|null>,
 *   show: (storyId: string, chatId: string) => void,
 *   take: (storyId: string) => string|null,
 * }}
 */
export function useChatRequest() {
  /**
   * Ask for a chat to be shown, once its project is open.
   * @param {string} storyId
   * @param {string} chatId
   */
  const show = (storyId, chatId) => {
    requested.value = { storyId, chatId }
  }

  /**
   * The chat asked for in this project, handed over once; null when none is.
   * @param {string} storyId
   * @returns {string|null}
   */
  const take = storyId => {
    if (!requested.value || requested.value.storyId !== storyId) return null
    const { chatId } = requested.value
    requested.value = null
    return chatId
  }

  return { requested, show, take }
}
