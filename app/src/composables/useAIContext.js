/**
 * Thin wrapper that wires the Pinia stores into buildContext.
 */

import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useChatsStore } from '@/stores/chatsStore.js'
import { useMessagesStore } from '@/stores/messagesStore.js'
import { buildContext } from '@/ai/context/build.js'
import { documentLocator, projectOverview, pinnedDocuments } from '@/ai/tools/documents.js'
import { keptInConversation, offersDocuments } from '@/ai/tools/index.js'
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
 * @property {boolean} [toolsAllowed] - Whether the model may call tools at
 *   all: the preset's switch, over the chat's. Absent means it may.
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
    // The project block is for a model that can reach the project: a chat
    // offered the document tools sends it on every turn. One that is not sends
    // it only for what the writer pinned, since a pin asks for those documents
    // whatever the tools are, and then without how much else there is or which
    // reads have gone stale, which a model with no tools can do nothing about.
    // Blank, with no tools and no pins, sends none. The chat's switches decide
    // rather than the reader's tools, so every reader of this conversation
    // agrees — a skill consulted inside a plain chat is in the same plain chat.
    const chat = opts.chatId ? stores.chatsStore.getChatById(opts.chatId) : null
    const inChat = opts.mode === 'chat' && Boolean(storyId)
    const reaches =
      inChat &&
      opts.toolsAllowed !== false &&
      offersDocuments({
        disabledTools: chat?.disabledTools,
        disabledGroups: chat?.disabledToolGroups,
      })

    // What the chat pinned, resolved to documents here for the same reason the
    // overview is: the builder takes what it needs as an argument.
    const pinned = inChat ? await pinnedDocuments(storyId, chat) : []
    const project =
      reaches || pinned.length > 0 ? await projectOverview(storyId, chat, { size: reaches }) : null
    // Where each document the model read is now, for the block to say which
    // have changed since.
    const locate = reaches ? await documentLocator(storyId, chat) : undefined
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
