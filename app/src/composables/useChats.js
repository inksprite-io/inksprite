import { computed, ref } from 'vue'
import { generateChatId, useChatsStore } from '@/stores/chatsStore'
import { useMessagesStore } from '@/stores/messagesStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { DEFAULT_PROFILE_ID, settingsForNewChat } from '@/ai/profiles/index.js'
import { useProfiles } from './useProfiles.js'

/** @typedef {import('../types/models.js').Chat} Chat */
/** @typedef {import('../types/models.js').Message} Message */
/** @typedef {import('../types/models.js').AIPrompt} AIPrompt */

// Singleton instances keyed by storyId
const instances = new Map()

/**
 * Clear all singleton instances (for testing)
 */
export const clearChatsInstances = () => {
  instances.clear()
}

/**
 * @typedef {{
 *   init: () => Promise<void>,
 *   chats: import('vue').ComputedRef<Chat[]>,
 *   chatMessages: import('vue').Ref<Map<string, Message[]>>,
 *   createChat: (title?: string, profileId?: string) => Chat|null,
 *   unstartedChat: import('vue').ComputedRef<Partial<Chat> & {id: string}>,
 *   isUnstarted: (chatId: string|null|undefined) => boolean,
 *   updateUnstartedChat: (updates: Partial<Chat>) => void,
 *   startChat: () => Chat,
 *   defaultProfileId: () => string,
 *   updateChat: (chatId: string, updates: Partial<Chat>) => Chat|null,
 *   deleteChat: (chatId: string) => void,
 *   getChatById: (chatId: string) => Chat|null,
 *   forkChat: (chatId: string, messageId: string) => Chat,
 *   importChat: (chat: Chat, messages: Message[], prompt?: AIPrompt) => Chat,
 *   addMessage: (chatId: string, role: 'user'|'assistant', content: string, reasoningContent?: string|null, segments?: import('../types/models.js').MessageSegment[]|null) => Message,
 *   streamMessageContent: (messageId: string, content: string, reasoningContent?: string|null, timing?: {thinkingFinishTime?: number, streamingFinishTime?: number, thinkingTime?: number}, pendingToolCalls?: import('../types/models.js').PendingToolCall[]) => Message|null,
 *   updateMessage: (messageId: string, updates: Partial<Message>) => Message|null,
 *   beginAlternate: (messageId: string) => Message,
 *   selectAlternate: (messageId: string, index: number) => Message,
 *   dropAlternate: (messageId: string) => Message,
 *   writeTurn: (messageId: string, segments: import('../types/models.js').MessageSegment[], content: string) => Message,
 *   writeSegment: (messageId: string, index: number, command: import('../types/models.js').ChatCommand, content: string) => Message,
 *   deleteMessage: (messageId: string) => boolean,
 *   moveMessage: (messageId: string, by: number) => Message,
 *  truncateMessagesForChat: (chatId: string, fromIndex: number) => number,
 *   getMessagesForChat: (chatId: string) => import('vue').ComputedRef<Message[]>,
 *   getMessageById: (messageId: string) => import('vue').ComputedRef<Message|null>,
 *   getDraftMessage: (chatId: string) => string,
 *   setDraftMessage: (chatId: string, content: string) => void,
 *   clearDraftMessage: (chatId: string) => void
 * }} ChatsApi
 */

/**
 * Composable for managing chats and messages
 * Returns a singleton instance per storyId to avoid duplicate state and watchers
 * @param {string} [storyId] - Optional story ID to load chats for
 * @returns {ChatsApi} API for managing chats and messages
 */
export const useChats = storyId => {
  // Return existing instance if available
  if (instances.has(storyId)) {
    return instances.get(storyId)
  }

  const chatsStore = useChatsStore()
  const messagesStore = useMessagesStore()
  const profilesApi = useProfiles()

  const ready = ref(false)
  const error = ref(null)

  // Store draft messages for each chat (chatId -> draft content)
  /** @type {import('vue').Ref<Map<string, string>>} */
  const draftMessages = ref(new Map())

  // prevent duplicate inits (idempotent)
  /** @type {Promise<void>|null} */
  let _initPromise = null

  /**
   * Load chats and their messages for the story. Safe to call multiple times.
   * @returns {Promise<void>}
   * @throws {Error} If loading chats or messages fails
   */
  async function init() {
    if (_initPromise) return _initPromise
    _initPromise = (async () => {
      try {
        await chatsStore.loadChatsForStory(storyId)
        const chats = chatsStore.getChatsForStory(storyId)
        await Promise.all(chats.map(c => messagesStore.loadMessagesForChat(c.id)))
        ready.value = true
      } catch (e) {
        error.value = e
        throw e
      }
    })()
    return _initPromise
  }

  // Get chats for current story, sorted by most recent
  /** @type {import('vue').ComputedRef<Chat[]>} */
  const chats = computed(() => {
    return chatsStore
      .getChatsForStory(storyId)
      .sort((a, b) => (b.lastMessageAt || b.created) - (a.lastMessageAt || a.created))
  })

  /**
   * chatId -> messages
   * @type {import('vue').ComputedRef<Map<string, Message[]>>}
   */
  const chatMessages = computed(() => {
    const map = new Map()
    for (const c of chats.value) {
      map.set(c.id, messagesStore.getMessagesForChat(c.id))
    }
    return map
  })

  /**
   * The profile a chat in this story starts on: the one the project names, or
   * the app's default — also when the one it names is gone, a writer's own
   * deleted or a built-in the app no longer ships. An NSFW one, while those are
   * switched off, is its general counterpart.
   * @returns {string}
   */
  const defaultProfileId = () => {
    const named = useStoriesStore().getStory(storyId)?.options?.profileId
    return profilesApi.getProfile(named)?.id ?? DEFAULT_PROFILE_ID
  }

  /**
   * Create a new chat, stamped from a profile.
   *
   * The profile's settings are copied onto the chat, all but the prompt: that
   * stays on the profile and is read every turn, so a chat follows its
   * profile's wording. The rest is the chat's own from here — a writer who
   * switches a tool off in one chat has not asked to switch it off in nine
   * others, and nothing on screen would tell them they had.
   *
   * @param {string} [title] - Optional chat title
   * @param {string} [profileId] - Profile to stamp from; the project's otherwise
   * @returns {Chat|null} Created chat or null
   * @throws {Error} If chat creation fails
   */
  const createChat = (title, profileId) => {
    const profile = profilesApi.getProfile(profileId || defaultProfileId())
    return chatsStore.createChat(storyId, title, null, settingsForNewChat(profile))
  }

  // The chat "New chat" opens: one with an id and settings but no row, which
  // becomes a chat when something is first sent in it. Until then it is only
  // here, so a writer who opens one and leaves has left nothing behind. Its
  // id is fixed ahead, so it can be selected, drafted in, and shown like any
  // other chat, and carries on as the same chat once it has started.
  const unstartedId = ref(generateChatId())

  /**
   * What the writer has changed in the unstarted chat's settings. Only the
   * changes are kept, so it starts on the project's profile as it is when it
   * starts rather than as it was when it was opened.
   * @type {import('vue').Ref<Partial<Chat>>}
   */
  const unstartedChanges = ref({})

  /** The unstarted chat's id and settings, for showing and editing them. */
  const unstartedChat = computed(() => ({
    id: unstartedId.value,
    ...settingsForNewChat(profilesApi.getProfile(defaultProfileId())),
    ...unstartedChanges.value,
  }))

  /**
   * Whether an id is the unstarted chat's.
   * @param {string|null|undefined} chatId
   * @returns {boolean}
   */
  const isUnstarted = chatId => !!chatId && chatId === unstartedId.value

  /**
   * Change the unstarted chat's settings, the way `updateChat` changes a chat's.
   * @param {Partial<Chat>} updates
   */
  const updateUnstartedChat = updates => {
    unstartedChanges.value = { ...unstartedChanges.value, ...updates }
  }

  /**
   * Make the unstarted chat a chat, under the id it already had, and have a
   * fresh one ready behind it.
   * @returns {Chat}
   */
  const startChat = () => {
    const { id, ...settings } = unstartedChat.value
    const chat = chatsStore.createChat(storyId, '', id, settings)
    unstartedId.value = generateChatId()
    unstartedChanges.value = {}
    return chat
  }

  /**
   * Update a chat
   * @param {string} chatId - Chat ID
   * @param {Partial<Chat>} updates - Updates to apply
   * @returns {Chat|null} Updated chat or null if not found
   * @throws {Error} If chat update fails
   */
  const updateChat = (chatId, updates) => {
    return chatsStore.updateChat(chatId, updates)
  }

  /**
   * Delete a chat and its messages
   * @param {string} chatId - Chat ID to delete
   * @returns {void}
   * @throws {Error} If deletion fails
   */
  const deleteChat = chatId => {
    // Delete all messages first
    messagesStore.deleteMessagesForChat(chatId)
    // Then delete the chat
    chatsStore.deleteChat(chatId)
  }

  /**
   * Get a chat by ID
   * @param {string} chatId - Chat ID
   * @returns {Chat|null} Chat or null if not found
   */
  const getChatById = chatId => {
    return chatsStore.chats?.get(chatId) || null
  }

  /**
   * Add a message to a chat
   * @param {string} chatId - Chat ID
   * @param {'user'|'assistant'} role - Message role (must be 'user' or 'assistant')
   * @param {string} content - Message content
   * @param {string|null} [reasoningContent=null] - Optional model reasoning content
   * @returns {Message} Created message
   * @throws {Error} If message creation fails
   */
  const addMessage = (chatId, role, content, reasoningContent = null, segments = null) => {
    const message = messagesStore.createMessage(chatId, role, content, reasoningContent, segments)

    // Update the chat's last message timestamp
    try {
      chatsStore.updateLastMessageTime(chatId)
    } catch (error) {
      console.warn(`Failed to update chat timestamp: ${error.message}`)
    }

    return message
  }

  /**
   * Stream content updates to a message (for AI responses)
   * @param {string} messageId - Message ID
   * @param {string} content - Updated content
   * @param {string|null} [reasoningContent=null] - Optional updated reasoning content
   * @param {{thinkingFinishTime?: number, streamingFinishTime?: number, thinkingTime?: number}} [timing={}] - Optional timing information
   * @returns {Message|null} Updated message or null if not found
   * @throws {Error} If update fails
   */
  const streamMessageContent = (
    messageId,
    content,
    reasoningContent = null,
    timing = {},
    pendingToolCalls = undefined
  ) => {
    return messagesStore.streamMessageContent(
      messageId,
      content,
      reasoningContent,
      timing,
      pendingToolCalls
    )
  }

  /**
   * Update a message
   * @param {string} messageId - Message ID
   * @param {Partial<Message>} updates - Updates to apply
   * @returns {Message|null} Updated message or null if not found
   * @throws {Error} If update fails
   */
  const updateMessage = (messageId, updates) => {
    return messagesStore.updateMessage(messageId, updates)
  }

  /**
   * Ask a message for another answer, keeping the one it has.
   * @param {string} messageId
   * @returns {Message}
   */
  const beginAlternate = messageId => messagesStore.beginAlternate(messageId)

  /**
   * Show one of a message's answers.
   * @param {string} messageId
   * @param {number} index
   * @returns {Message}
   */
  const selectAlternate = (messageId, index) => messagesStore.selectAlternate(messageId, index)

  /**
   * Take back the answer a message is showing, and show the one before it.
   * @param {string} messageId
   * @returns {Message}
   */
  const dropAlternate = messageId => messagesStore.dropAlternate(messageId)

  /**
   * Write what a turn is made of, without calling the turn edited.
   *
   * The chat has moved, the same as when a message is added to it, and is
   * stamped so.
   *
   * @param {string} messageId
   * @param {import('../types/models.js').MessageSegment[]} segments
   * @param {string} content - The turn assembled from them
   * @returns {Message}
   */
  const writeTurn = (messageId, segments, content) => {
    const message = messagesStore.writeTurn(messageId, segments, content)
    try {
      chatsStore.updateLastMessageTime(message.chatId)
    } catch (error) {
      console.warn(`Failed to update chat timestamp: ${error.message}`)
    }
    return message
  }

  /**
   * Write one of a turn's pieces without calling the turn edited.
   *
   * @param {string} messageId
   * @param {number} index
   * @param {import('../types/models.js').ChatCommand} command
   * @param {string} content - The turn assembled around it
   * @returns {Message}
   */
  const writeSegment = (messageId, index, command, content) => {
    return messagesStore.writeSegment(messageId, index, command, content)
  }

  /**
   * Delete a message
   * @param {string} messageId - Message ID
   * @returns {boolean} True if deleted, false otherwise
   * @throws {Error} If deletion fails
   */
  const deleteMessage = messageId => {
    return messagesStore.deleteMessage(messageId)
  }

  /**
   * Move a message up its chat, or down it. See the store's `moveMessage`.
   * @param {string} messageId
   * @param {number} by - How many places up; negative for down
   * @returns {Message}
   */
  const moveMessage = (messageId, by) => messagesStore.moveMessage(messageId, by)

  /**
   * Truncate messages for a chat from a given index
   * @param {string} chatId - Chat ID
   * @param {number} fromIndex - Index to start deletion from
   * @returns {number} Number of messages deleted
   */
  const truncateMessagesForChat = (chatId, fromIndex) => {
    const messages = messagesStore.getMessagesForChat(chatId) || []
    if (fromIndex < 0 || fromIndex >= messages.length) {
      return 0
    }
    const toDelete = messages.slice(fromIndex)
    toDelete.forEach(msg => messagesStore.deleteMessage(msg.id))
    return toDelete.length
  }

  /**
   * Get all messages for a chat as a reactive computed ref
   * @param {string} chatId - Chat ID
   * @returns {import('vue').ComputedRef<Message[]>} Computed ref that returns array of messages
   */
  const getMessagesForChat = chatId => {
    return computed(() => messagesStore.getMessagesForChat(chatId))
  }

  /**
   * Get a message by its ID as a reactive computed ref
   * @param {string} messageId - Message ID
   * @returns {import('vue').ComputedRef<Message|null>} Computed ref of message or null
   */
  const getMessageById = messageId => {
    return messagesStore.getMessageById(messageId)
  }

  /**
   * Get draft message content for a chat
   * @param {string} chatId - Chat ID
   * @returns {string} Draft message content (empty string if no draft)
   */
  const getDraftMessage = chatId => {
    return draftMessages.value.get(chatId) || ''
  }

  /**
   * Set draft message content for a chat
   * @param {string} chatId - Chat ID
   * @param {string} content - Draft message content
   * @returns {void}
   */
  const setDraftMessage = (chatId, content) => {
    if (content) {
      draftMessages.value.set(chatId, content)
    } else {
      draftMessages.value.delete(chatId)
    }
  }

  /**
   * Clear draft message for a chat
   * @param {string} chatId - Chat ID
   * @returns {void}
   */
  const clearDraftMessage = chatId => {
    draftMessages.value.delete(chatId)
  }

  /**
   * Copy a chat's settings and a run of its messages into a new chat in this
   * story. What a fork and an import have in common.
   *
   * A copy continues the original conversation, so it carries that chat's
   * settings over; a brand new chat leaves them unset and falls back to the
   * built-in prompt. The messages keep their content and timing and get fresh
   * ids.
   *
   * The pins come too. A fork of a chat on a character card that lost them
   * would be a fork of a different character, since what a card puts in front
   * of the model is pinned rather than read. They are document ids, so an
   * import carries ids from another project; those name nothing here and are
   * skipped when the block is built.
   *
   * What a chat pins, shows and hides is carried: a fork is the same
   * conversation, and it would be a different one if it could suddenly see
   * every other character in the project.
   *
   * @param {Chat} source - Whose settings to carry over
   * @param {Message[]} messages - In order; each is duplicated under the new chat
   * @param {string} title
   * @returns {Chat}
   */
  const copyChat = (source, messages, title) => {
    const copy = chatsStore.createChat(storyId, title, null, {
      profileId: source.profileId ?? null,
      disabledTools: [...(source.disabledTools || [])],
      disabledToolGroups: [...(source.disabledToolGroups || [])],
      ...(source.mcpServers ? { mcpServers: [...source.mcpServers] } : {}),
      projectContextEnabled: source.projectContextEnabled !== false,
      ...(source.rules ? { rules: source.rules } : {}),
      ...(source.pinnedIds?.length ? { pinnedIds: [...source.pinnedIds] } : {}),
      ...(source.shownIds?.length ? { shownIds: [...source.shownIds] } : {}),
      ...(source.hiddenIds?.length ? { hiddenIds: [...source.hiddenIds] } : {}),
      ...(source.voiceId ? { voiceId: source.voiceId } : {}),
      ...(source.userVoiceId ? { userVoiceId: source.userVoiceId } : {}),
    })
    if (!copy) {
      throw new Error('Failed to create chat')
    }

    if (source.description) {
      updateChat(copy.id, { description: source.description })
    }

    messages.forEach(message => {
      messagesStore.duplicateMessage(message, copy.id)
    })

    // Stamped with the last copied message, so the copy sorts where the
    // conversation left off rather than at the top as something new.
    if (messages.length > 0) {
      updateChat(copy.id, {
        lastMessageAt: messages[messages.length - 1].created,
        messageCount: messages.length,
      })
    }

    return copy
  }

  /**
   * Fork a chat at a specific message, creating a new chat with all messages up to that point
   * @param {string} chatId - Original chat ID
   * @param {string} messageId - Last message ID to include in the fork
   * @returns {Chat} The newly created forked chat
   * @throws {Error} If chat not found or fork operation fails
   */
  const forkChat = (chatId, messageId) => {
    const originalChat = getChatById(chatId)
    if (!originalChat) {
      throw new Error(`Cannot fork chat '${chatId}': chat not found`)
    }

    const allMessages = messagesStore.getMessagesForChat(chatId)
    const messageIndex = allMessages.findIndex(msg => msg.id === messageId)
    if (messageIndex === -1) {
      throw new Error(`Message '${messageId}' not found in chat '${chatId}'`)
    }

    return copyChat(
      originalChat,
      allMessages.slice(0, messageIndex + 1),
      `${originalChat.title} - forked`
    )
  }

  /**
   * Bring a chat read from a file into this story.
   *
   * Everything gets a fresh id, so the same file can be imported twice, or
   * back into the story it came from, without colliding with what is there.
   *
   * The prompt the chat ran on comes with it. A profile this library already
   * holds under that id is used as it stands — the file may be older, and the
   * library is what the writer has been editing. One it does not hold becomes a
   * profile of the writer's own, made from the file's copy, and the chat runs
   * on that.
   *
   * @param {Chat} chat - As it was exported
   * @param {Message[]} messages - Its messages, in order
   * @param {AIPrompt} [prompt] - The prompt it ran on, if the file carried one
   * @returns {Chat} The chat as it now exists here
   */
  const importChat = (chat, messages, prompt) => {
    const known = profilesApi.getProfile(chat.profileId || chat.promptId)
    const profileId =
      known || !prompt
        ? chat.profileId || chat.promptId
        : profilesApi.saveProfile(prompt.name, { prompt: prompt.content }).id
    return copyChat({ ...chat, profileId }, messages, chat.title)
  }

  const instance = {
    // init
    init,

    // State
    chats, // Computed property for current story's chats
    chatMessages, // chatId -> messages map

    // Chat actions
    createChat,
    unstartedChat,
    isUnstarted,
    updateUnstartedChat,
    startChat,
    defaultProfileId,
    updateChat,
    deleteChat,
    getChatById,
    forkChat,
    importChat,

    // Message actions
    addMessage,
    streamMessageContent,
    updateMessage,
    beginAlternate,
    selectAlternate,
    dropAlternate,
    writeTurn,
    writeSegment,
    deleteMessage,
    moveMessage,
    truncateMessagesForChat,
    getMessagesForChat,
    getMessageById,

    // Draft message actions
    getDraftMessage,
    setDraftMessage,
    clearDraftMessage,
  }

  // Store instance for future use
  instances.set(storyId, instance)

  return instance
}
