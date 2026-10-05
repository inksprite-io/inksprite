/**
 * @module composables/useLoadedSkills
 * @description The skills a chat has loaded, and dropping one.
 *
 * Read off the chat's messages, where the loads are recorded, rather than
 * kept anywhere of their own; see ai/skills/loads.js. Dropping one marks
 * every record of it, the model's calls on its turns and the line in the
 * writer's turn, so it is not kept past the next summary. Nothing else
 * changes: the records are read where they are until then.
 */

import { computed, toValue } from 'vue'
import { useChats } from './useChats.js'
import { droppedFrom, droppedSkills, loadedSkills } from '@/ai/skills/loads.js'
import { assembleTurn } from '@/ai/commands.js'

/**
 * @param {import('vue').MaybeRefOrGetter<string>} chatId
 * @returns {{
 *   loaded: import('vue').ComputedRef<string[]>,
 *   dropped: import('vue').ComputedRef<string[]>,
 *   drop: (name: string) => void,
 * }}
 */
export function useLoadedSkills(chatId) {
  const chatsApi = useChats()

  const messages = computed(() => {
    const id = toValue(chatId)
    return id ? chatsApi.getMessagesForChat(id)?.value || [] : []
  })

  /** The skills loaded here, in the order they were first loaded. */
  const loaded = computed(() => loadedSkills(messages.value))

  /** The loaded skills that go at the next summary. */
  const dropped = computed(() => droppedSkills(messages.value))

  /**
   * Drop a skill from the chat, wherever it was loaded, so it is not kept past
   * the next summary. Not an edit: the writer has not rewritten anything, so
   * nothing is marked edited, and the turn's content stays as it was.
   *
   * @param {string} name
   */
  const drop = name => {
    for (const message of messages.value) {
      const patch = droppedFrom(message, name)
      if (!patch) continue

      if ('metadata' in patch) {
        chatsApi.updateMessage(message.id, { metadata: patch.metadata })
        continue
      }

      const content = assembleTurn(patch.segments)
      patch.segments.forEach((segment, index) => {
        if (segment !== message.segments[index] && segment.type === 'command') {
          chatsApi.writeSegment(message.id, index, segment.command, content)
        }
      })
    }
  }

  return { loaded, dropped, drop }
}
