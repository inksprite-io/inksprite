/**
 * @module stores/messagesStore
 * @description Store for managing chat messages. Handles CRUD operations
 * for messages including creation, updates, streaming content, deletion,
 * and loading from IndexedDB. Messages belong to chats and can be from users or AI assistants.
 *
 * @example
 * // Create a new user message
 * const store = useMessagesStore()
 * const message = store.createMessage('chat_123', 'user', 'Hello AI!')
 *
 * @example
 * // Stream AI response content
 * const aiMessage = store.createMessage('chat_123', 'assistant', '')
 * store.streamMessageContent(aiMessage.id, 'Streaming response...', null, {
 *   streamingFinishTime: Date.now()
 * })
 */

import { defineStore } from 'pinia'
import { shallowRef, triggerRef, reactive, computed } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore'
import db from './db'

/** @typedef {import('../types/models.js').Message} Message */

/**
 * Metadata without the request its turn kept.
 * @param {Message['metadata']} metadata
 */
function withoutRequest(metadata) {
  const rest = { ...metadata }
  delete rest.context
  return rest
}

/**
 * What changes on a message when the requests saved on it are forgotten: its
 * own, and each of its other answers'. Null when it has none.
 *
 * @param {Message} message
 * @returns {Partial<Message>|null}
 */
function withoutSavedRequests(message) {
  const own = message.metadata?.context !== undefined
  const others = (message.alternates || []).some(answer => answer.metadata?.context !== undefined)
  if (!own && !others) return null
  return {
    ...(own ? { metadata: withoutRequest(message.metadata) } : {}),
    ...(others
      ? {
          alternates: message.alternates.map(answer =>
            answer.metadata?.context !== undefined
              ? { ...answer, metadata: withoutRequest(answer.metadata) }
              : answer
          ),
        }
      : {}),
  }
}

/**
 * Generate a unique message ID
 * @returns {string} Message ID in format message_xxx
 */
function generateMessageId() {
  return `message_${nanoid()}`
}

export const useMessagesStore = defineStore('messages', () => {
  /**
   * @type {import('vue').ShallowRef<Map<string, Message>>}
   */
  const messages = shallowRef(new Map())

  // Get sync store instance
  const syncStore = useSyncStore()

  /**
   * The last creation time handed out, so the next one is always later.
   *
   * Messages are ordered by `created` and nothing else, and a submission can
   * write several inside one millisecond — a turn the writer took, then a
   * consultation answering in the middle of it, then the rest of what they were
   * saying. Equal timestamps sort by whatever order the rows came back in,
   * which after a reload is the order of a random id.
   *
   * @returns {number}
   */
  let lastCreated = 0
  const nextCreated = () => {
    lastCreated = Math.max(Date.now(), lastCreated + 1)
    return lastCreated
  }

  /**
   * Create a new message in a chat
   * @param {string} chatId - Parent chat ID
   * @param {'user'|'assistant'} role - Message sender role
   * @param {string} content - Message content
   * @param {string|null} [reasoningContent=null] - AI reasoning content (for assistant messages)
   * @param {import('../types/models.js').MessageSegment[]|null} [segments=null] - What
   *   the turn was made of, when it was made of more than prose. `content` is
   *   assembled from these by the caller; see assembleTurn.
   * @returns {Message} The created message
   * @throws {Error} If required parameters are missing or invalid
   */
  function createMessage(chatId, role, content, reasoningContent = null, segments = null) {
    if (!chatId) {
      throw new Error('Chat ID is required to create a message')
    }
    if (!role) {
      throw new Error('Role is required to create a message')
    }
    if (role !== 'user' && role !== 'assistant') {
      throw new Error(`Invalid role '${role}', must be 'user' or 'assistant'`)
    }
    if (content === null || content === undefined) {
      throw new Error('Content is required to create a message')
    }

    const now = nextCreated()
    /** @type {Message} */
    const message = {
      id: generateMessageId(),
      chatId,
      role,
      content,
      reasoningContent,
      streamingStartTime: role === 'assistant' && content === '' ? now : null,
      streamingFinishTime: null,
      thinkingFinishTime: null,
      edited: false,
      editedAt: null,
      metadata: null,
      ...(segments ? { segments } : {}),
      version: 1,
      created: now,
      updated: now,
    }

    // Wrap message in reactive for deep reactivity
    const reactiveMessage = reactive(message)
    messages.value.set(message.id, reactiveMessage)
    triggerRef(messages)

    // Track change for persistence
    syncStore.trackChange('messages', message.id, message)

    return message
  }

  /**
   * Duplicate a message to a different chat, preserving all original metadata
   * Useful for forking conversations or copying messages between chats
   * @param {Message} originalMessage - Message to duplicate
   * @param {string} newChatId - Chat ID for the duplicated message
   * @returns {Message} The duplicated message
   * @throws {Error} If required parameters are missing
   */
  function duplicateMessage(originalMessage, newChatId) {
    if (!originalMessage) {
      throw new Error('Original message is required to duplicate')
    }
    if (!newChatId) {
      throw new Error('New chat ID is required to duplicate message')
    }

    /** @type {Message} */
    const message = {
      // New ID for the duplicate
      id: generateMessageId(),
      chatId: newChatId,
      // Copy all content and metadata from original
      role: originalMessage.role,
      content: originalMessage.content,
      reasoningContent: originalMessage.reasoningContent,
      streamingStartTime: originalMessage.streamingStartTime,
      streamingFinishTime: originalMessage.streamingFinishTime,
      thinkingFinishTime: originalMessage.thinkingFinishTime,
      ...(originalMessage.thinkingTime != null
        ? { thinkingTime: originalMessage.thinkingTime }
        : {}),
      edited: originalMessage.edited,
      editedAt: originalMessage.editedAt,
      metadata: originalMessage.metadata,
      ...(originalMessage.segments ? { segments: originalMessage.segments } : {}),
      ...(originalMessage.alternates
        ? {
            alternates: originalMessage.alternates.map(answer => ({ ...answer })),
            alternate: originalMessage.alternate ?? 0,
          }
        : {}),
      // Preserve original timestamps to maintain conversation flow
      created: originalMessage.created,
      updated: originalMessage.updated,
      // Reset version and deletion state
      version: 1,
    }

    // Wrap message in reactive for deep reactivity
    const reactiveMessage = reactive(message)
    messages.value.set(message.id, reactiveMessage)
    triggerRef(messages)

    // Track change for persistence
    syncStore.trackChange('messages', message.id, message)

    return message
  }

  /**
   * What a message says, as one of its answers: every field a generation
   * writes, and none of where the message sits.
   *
   * @param {Partial<Message>} message
   * @returns {import('../types/models.js').MessageAlternate}
   */
  const answerOf = ({
    content = '',
    reasoningContent = null,
    streamingStartTime = null,
    streamingFinishTime = null,
    thinkingFinishTime = null,
    thinkingTime = null,
    edited = false,
    editedAt = null,
    metadata = null,
  }) => ({
    content,
    reasoningContent,
    streamingStartTime,
    streamingFinishTime,
    thinkingFinishTime,
    thinkingTime,
    edited,
    editedAt,
    metadata,
  })

  /** An answer nothing has been written to. */
  const EMPTY_ANSWER = answerOf({})

  /**
   * Whether an answer failed before it said anything.
   * @param {import('../types/models.js').MessageAlternate} answer
   * @returns {boolean}
   */
  const failedEmpty = answer => Boolean(answer.metadata?.error) && !answer.content

  /**
   * Every answer the message has had, with the one it is showing as it
   * stands now.
   *
   * The showing answer's copy in the list is brought up to date here rather
   * than on every write to the message: a turn writes its message many times
   * a second, and the list is only read when the writer turns away from it.
   *
   * @param {Message} message
   * @returns {import('../types/models.js').MessageAlternate[]}
   */
  function alternatesOf(message) {
    const list = message.alternates ? [...message.alternates] : []
    list[Math.min(message.alternate ?? 0, list.length)] = answerOf(message)
    return list
  }

  /**
   * Ask a message for another answer, keeping the one it has.
   *
   * The message empties, as a message a turn is about to write into, and
   * what it said goes into the list of its answers beside a place for the
   * next. The writer did none of this, so nothing is marked edited. An
   * answer that failed before it said anything is not kept: there is nothing
   * in it to turn back to.
   *
   * @param {string} messageId
   * @returns {Message}
   * @throws {Error} If the message is not there
   */
  function beginAlternate(messageId) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to begin an alternate, '${messageId}' not found`)
    }

    const kept = alternatesOf(message).filter(answer => !failedEmpty(answer))
    const next = { ...EMPTY_ANSWER, streamingStartTime: Date.now() }
    if (kept.length === 0) {
      Object.assign(message, next)
      delete message.alternates
      delete message.alternate
    } else {
      Object.assign(message, next, { alternates: [...kept, next], alternate: kept.length })
    }
    delete message.pendingToolCalls
    message.updated = Date.now()

    syncStore.trackChange('messages', messageId, message)
    triggerRef(messages)

    return message
  }

  /**
   * Show one of a message's answers.
   *
   * The message takes that answer's fields, and the one it was showing goes
   * back into the list as it stands — an edit the writer made to it since is
   * kept, and shown again when they turn back. Turning is not an edit either.
   *
   * @param {string} messageId
   * @param {number} index - Which answer, in the order they were asked for
   * @returns {Message}
   * @throws {Error} If the message or the answer is not there
   */
  function selectAlternate(messageId, index) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to select an alternate, '${messageId}' not found`)
    }

    const alternates = alternatesOf(message)
    const chosen = alternates[index]
    if (!chosen) {
      throw new Error(`Message '${messageId}' has no answer ${index}`)
    }
    Object.assign(message, EMPTY_ANSWER, chosen, { alternates, alternate: index })
    delete message.pendingToolCalls
    message.updated = Date.now()

    syncStore.trackChange('messages', messageId, message)
    triggerRef(messages)

    return message
  }

  /**
   * Take back the answer a message is showing — one asked for and stopped
   * before it said anything — and show the one asked for before it. A message
   * left with one answer is a message with no others, as it was before it was
   * asked again.
   *
   * @param {string} messageId
   * @returns {Message}
   * @throws {Error} If the message is not there, or has no other answer
   */
  function dropAlternate(messageId) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to drop an alternate, '${messageId}' not found`)
    }

    const alternates = alternatesOf(message)
    alternates.splice(message.alternate ?? 0, 1)
    if (alternates.length === 0) {
      throw new Error(`Message '${messageId}' has no other answer`)
    }
    const index = alternates.length - 1
    Object.assign(message, EMPTY_ANSWER, alternates[index])
    if (alternates.length > 1) Object.assign(message, { alternates, alternate: index })
    else {
      delete message.alternates
      delete message.alternate
    }
    delete message.pendingToolCalls
    message.updated = Date.now()

    syncStore.trackChange('messages', messageId, message)
    triggerRef(messages)

    return message
  }

  /**
   * Update an existing message with partial updates
   * @param {string} messageId - Message ID to update
   * @param {Partial<Message>} updates - Fields to update
   * @returns {Message} Updated message
   * @throws {Error} If message not found
   */
  function updateMessage(messageId, updates) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to update message, '${messageId}' not found`)
    }

    /** @type {Message} */
    const updated = {
      ...message,
      ...updates,
      // Preserve system fields
      id: message.id,
      chatId: message.chatId,
      role: message.role,
      created: message.created,
      version: message.version,
      updated: Date.now(),
      // Mark as edited if content changed
      edited: updates.content !== undefined ? true : message.edited,
      editedAt: updates.content !== undefined ? Date.now() : message.editedAt,
    }

    // Wrap updated message in reactive for deep reactivity
    const reactiveUpdated = reactive(updated)
    messages.value.set(messageId, reactiveUpdated)
    triggerRef(messages)

    // Track change for persistence
    syncStore.trackChange('messages', messageId, updated)

    return updated
  }

  /**
   * Stream content updates to a message (for AI responses).
   * This does NOT mark as edited or update version/timestamps.
   * Used for real-time streaming of AI responses.
   * @param {string} messageId - Message ID to stream to
   * @param {string} content - Content to set
   * @param {string|null} [reasoningContent=null] - Reasoning content to set
   * @param {{thinkingFinishTime?: number, streamingFinishTime?: number, thinkingTime?: number}} [timing={}] - Timing information
   * @returns {Message} Updated message
   * @throws {Error} If message not found
   * @param {import('../types/models.js').PendingToolCall[]} [pendingToolCalls] - The calls in flight; an empty list clears them; absent leaves them
   */
  function streamMessageContent(
    messageId,
    content,
    reasoningContent = null,
    timing = {},
    pendingToolCalls = undefined
  ) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to stream to message, '${messageId}' not found`)
    }

    // Update content directly - reactive wrapper will track changes
    message.content = content
    if (reasoningContent !== null) {
      message.reasoningContent = reasoningContent
    }

    // The calls in flight, or none: an empty list takes the field off, since
    // it says nothing once the turn is over.
    if (pendingToolCalls !== undefined) {
      if (pendingToolCalls.length > 0) message.pendingToolCalls = pendingToolCalls
      else delete message.pendingToolCalls
    }

    // Update timing fields
    if (timing.thinkingFinishTime !== undefined) {
      message.thinkingFinishTime = timing.thinkingFinishTime
    }
    if (timing.streamingFinishTime !== undefined) {
      message.streamingFinishTime = timing.streamingFinishTime
    }
    if (timing.thinkingTime !== undefined) {
      message.thinkingTime = timing.thinkingTime
    }

    // Still track change for persistence
    syncStore.trackChange('messages', messageId, message)

    return message
  }

  /**
   * Write what a turn is made of, without calling the turn edited.
   *
   * The same in-place write `streamMessageContent` makes, for a message whose
   * text is assembled rather than typed. What arrives here is not the writer
   * having been back to change anything — a piece added to the turn they are
   * still taking, or a turn folded back into one message after a deletion
   * beside it — and `updateMessage` would record it as exactly that.
   *
   * The assembled content comes from the caller. What a turn reads as is
   * ai/commands.js's business and not this store's.
   *
   * @param {string} messageId
   * @param {import('../types/models.js').MessageSegment[]} segments - The pieces, in order
   * @param {string} content - The turn assembled from them
   * @returns {Message} Updated message
   * @throws {Error} If the message is not there
   */
  function writeTurn(messageId, segments, content) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to write turn, '${messageId}' not found`)
    }

    message.segments = segments
    message.content = content

    syncStore.trackChange('messages', messageId, message)
    triggerRef(messages)

    return message
  }

  /**
   * Write one of a turn's pieces, without calling the turn edited: an answer
   * arriving a word at a time, or a question asked again. See `writeTurn`.
   *
   * @param {string} messageId
   * @param {number} index - Which piece
   * @param {import('../types/models.js').ChatCommand} command - What it says now
   * @param {string} content - The turn assembled around it
   * @returns {Message} Updated message
   * @throws {Error} If the message or the piece is not there
   */
  function writeSegment(messageId, index, command, content) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to write segment, '${messageId}' not found`)
    }

    const segments = message.segments || []
    if (segments[index]?.type !== 'command') {
      throw new Error(`Failed to write segment, '${messageId}' has no command at ${index}`)
    }

    return writeTurn(
      messageId,
      segments.map((segment, at) => (at === index ? { type: 'command', command } : segment)),
      content
    )
  }

  /**
   * Delete a message
   * @param {string} messageId - Message ID to delete
   * @returns {boolean} True if deleted
   * @throws {Error} If message not found
   */
  function deleteMessage(messageId) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to delete message, '${messageId}' not found`)
    }

    syncStore.trackDelete('messages', messageId)
    messages.value.delete(messageId)
    triggerRef(messages)

    return true
  }

  /**
   * Move a message up its chat, to sit above some of the messages before it.
   *
   * Messages are ordered by when they were created and by nothing else, so
   * moving one is giving it a time between its new neighbours'. That is a small
   * lie about when it was written, told on purpose: a summary is asked for at
   * the end of a conversation and read above its last few turns, and the order
   * a chat is stored in has to be the order it is read in — a fork or a rewind
   * cuts by it. When it was really asked for is still its `streamingStartTime`.
   *
   * @param {string} messageId
   * @param {number} by - How many places to move it: up if positive, down if
   *   negative. Stops at either end of the chat.
   * @returns {Message}
   * @throws {Error} If the message is not there
   */
  function moveMessage(messageId, by) {
    const message = messages.value.get(messageId)
    if (!message) {
      throw new Error(`Failed to move message, '${messageId}' not found`)
    }

    const order = getMessagesForChat(message.chatId)
    const others = order.filter(other => other.id !== messageId)
    const from = order.findIndex(other => other.id === messageId)
    const to = Math.min(Math.max(from - by, 0), others.length)
    if (to === from) return message

    const above = others[to - 1]
    const below = others[to]
    message.created =
      above && below
        ? (above.created + below.created) / 2
        : above
          ? above.created + 1
          : below.created - 1
    message.updated = Date.now()

    syncStore.trackChange('messages', messageId, message)
    triggerRef(messages)

    return message
  }

  /**
   * Get a single message by ID
   * @param {string} messageId - Message ID to retrieve
   * @returns {Promise<Message|null>} Message if found and not deleted, null otherwise
   */
  async function getMessage(messageId) {
    let message = messages.value.get(messageId)
    if (!message) {
      // Try loading from database
      try {
        const dbMessage = await db.messages.get(messageId)
        if (dbMessage) {
          const reactiveMessage = reactive(dbMessage)
          messages.value.set(dbMessage.id, reactiveMessage)
          triggerRef(messages)
          message = reactiveMessage
        }
      } catch (error) {
        console.error(`Failed to load message '${messageId}' from database:`, error)
      }
    }

    if (!message) {
      return null
    }

    return message
  }

  /**
   * Get all messages for a chat, sorted by creation time
   * @param {string} chatId - Chat ID
   * @returns {Message[]} Plain array of messages sorted by creation time
   */
  function getMessagesForChat(chatId) {
    return Array.from(messages.value.values())
      .filter(message => message.chatId === chatId)
      .sort((a, b) => a.created - b.created)
  }

  /**
   * Delete all messages for a chat (used when deleting a chat)
   * @param {string} chatId - Chat ID
   * @returns {number} Number of messages deleted
   */
  function deleteMessagesForChat(chatId) {
    const chatMessages = Array.from(messages.value.values()).filter(
      message => message.chatId === chatId
    )

    let deletedCount = 0
    chatMessages.forEach(message => {
      try {
        deleteMessage(message.id)
        deletedCount++
      } catch (error) {
        console.warn(`Failed to delete message ${message.id}: ${error.message}`)
      }
    })
    // Trigger once after all deletions
    triggerRef(messages)

    return deletedCount
  }

  /**
   * Load messages for a chat from database
   * @param {string} chatId - Chat ID to load messages for
   * @returns {Promise<void>}
   * @throws {Error} If database operation fails
   */
  async function loadMessagesForChat(chatId) {
    try {
      const chatMessages = await db.messages.where('chatId').equals(chatId).toArray()

      chatMessages.forEach(message => {
        // Wrap message in reactive for deep reactivity
        const reactiveMessage = reactive(message)
        messages.value.set(message.id, reactiveMessage)
      })
      triggerRef(messages)

      console.log(`Loaded ${chatMessages.length} messages for chat ${chatId}`)
    } catch (error) {
      console.error(`Failed to load messages for chat ${chatId}:`, error)
      throw new Error(`Failed to load messages: ${error.message}`)
    }
  }

  /**
   * Forget the request every assistant turn kept while Debug was on, which is
   * what switching it off does. The messages loaded here change as any edit
   * does, so none of them is written back later with its request; every other
   * message is changed where it is stored.
   *
   * @returns {Promise<void>}
   */
  async function forgetSavedRequests() {
    for (const message of [...messages.value.values()]) {
      const forgotten = withoutSavedRequests(message)
      if (forgotten) updateMessage(message.id, forgotten)
    }
    await db.messages
      .filter(message => withoutSavedRequests(message) !== null)
      .modify(message => {
        Object.assign(message, withoutSavedRequests(message))
      })
  }

  /**
   * Get the last message in a chat
   * @param {string} chatId - Chat ID
   * @returns {Message|null} Last message or null if no messages
   */
  function getLastMessageForChat(chatId) {
    const chatMessages = getMessagesForChat(chatId)
    return chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null
  }

  /**
   * Count messages in a chat
   * @param {string} chatId - Chat ID
   * @returns {number} Number of messages
   */
  function countMessagesForChat(chatId) {
    return getMessagesForChat(chatId).length
  }

  /**
   * Get all messages as an array
   * @returns {Message[]} All messages
   */
  const allMessages = () => {
    return Array.from(messages.value.values())
  }

  /**
   * Get message by ID as a reactive computed ref
   * @param {string} messageId - Message ID
   * @returns {import('vue').ComputedRef<Message|null>} Computed ref of message or null
   */
  const getMessageById = messageId => {
    return computed(() => {
      const message = messages.value.get(messageId)
      return message || null
    })
  }

  return {
    // State
    messages,

    // Actions
    createMessage,
    duplicateMessage,
    updateMessage,
    beginAlternate,
    selectAlternate,
    dropAlternate,
    streamMessageContent,
    writeTurn,
    writeSegment,
    deleteMessage,
    moveMessage,
    getMessage,
    getMessagesForChat,
    deleteMessagesForChat,
    loadMessagesForChat,
    forgetSavedRequests,
    getLastMessageForChat,
    countMessagesForChat,

    // Getters
    allMessages,
    getMessageById,
  }
})
