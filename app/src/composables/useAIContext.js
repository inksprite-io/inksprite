/**
 * Thin wrapper that wires the Pinia stores into buildContext.
 */

import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useChatsStore } from '@/stores/chatsStore.js'
import { useMessagesStore } from '@/stores/messagesStore.js'
import { buildContext } from '@/ai/context/build.js'
import { documentLocator, projectOverview, pinnedDocuments } from '@/ai/tools/documents.js'
import { keptInConversation } from '@/ai/tools/index.js'
import { useEditor } from './useEditor.js'
import { namesOf } from '@/cards/macros.js'

/**
 * @typedef {'chat'|'summarize'} ContextMode
 * @typedef {import('@/ai/context/build.js').BuildOptions} BuildOptions
 *
 * @typedef {Object} BuildArgs
 * @property {ContextMode} mode
 * @property {string} [documentId]
 * @property {string} [chatId]
 * @property {string} systemPrompt
 * @property {string} [note] - The chat's author's note, written by the writer,
 *   for the turn alone: a skill reads the conversation as a transcript and is
 *   not who it is for
 * @property {string} [userPrompt]
 * @property {import('@/ai/context/build.js').TranscriptRoles} [transcript]
 * @property {string} [before]
 * @property {number} [past]
 */

export function useAIContext(storyId) {
  const stores = {
    documentsStore: useDocumentsStore(),
    chatsStore: useChatsStore(),
    messagesStore: useMessagesStore(),
  }

  /**
   * @param {BuildArgs} opts
   * @returns {Promise<{ messages: Array }>}
   */
  async function build(opts) {
    // The model has to see the latest text, and open documents reach the
    // store on a debounce.
    useEditor().flush()

    // Read here rather than in the builder, which takes everything it needs as
    // an argument and touches no store of its own.
    //
    // A chat can turn the project off and be a plain conversation. Absent
    // means on, because every chat written before the switch existed had it.
    // The gate is here rather than in the builder so a chat that wants none of
    // it does not pay for the overview either, and so every reader of this
    // conversation agrees — a skill consulted inside a plain chat is in the
    // same plain chat.
    const chat = opts.chatId ? stores.chatsStore.getChatById(opts.chatId) : null
    const wantsProject = chat?.projectContextEnabled !== false

    const project =
      opts.mode === 'chat' && storyId && wantsProject ? await projectOverview(storyId, chat) : null

    // What the chat pinned, resolved to documents here for the same reason the
    // overview is: the builder takes what it needs as an argument. Only when
    // there is a block for it to ride in — a pin is a claim about the project
    // block, and a chat that sends none has nowhere to put one.
    const pinned = project ? await pinnedDocuments(storyId, chat) : []
    // Where each document the model read is now, for the block to say which
    // have changed since. Only with a block to say it in.
    const locate = project ? await documentLocator(storyId, chat) : undefined
    return buildContext(opts.mode, stores, {
      ...opts,
      storyId,
      project,
      pinned,
      keeps: keptInConversation,
      locate,
      // What a card's macros become in this chat, when it plays one.
      names: namesOf(chat),
    })
  }

  return { build }
}
