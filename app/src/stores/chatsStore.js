/**
 * @module stores/chatsStore
 * @description Store for managing chat conversations within stories. Handles CRUD operations
 * for chats including creation, updates, deletion, and loading from IndexedDB.
 * Each story can have multiple chats for brainstorming and discussion.
 *
 * @example
 * // Create a new chat
 * const store = useChatsStore()
 * const chat = store.createChat('story_123', 'Character Development')
 *
 * @example
 * // Load and get chats for a story
 * await store.loadChatsForStory('story_123')
 * const chats = store.getChatsForStory('story_123')
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore'
import { storage } from '@/storage/index.js'
import { DEFAULT_CHAT_TITLE } from '@/utils/chatTitle.js'

/** @typedef {import('../types/models.js').Chat} Chat */

/**
 * Generate a unique chat ID
 * @returns {string} Chat ID in format chat_xxx
 */
export function generateChatId() {
  return `chat_${nanoid()}`
}

export const useChatsStore = defineStore('chats', () => {
  /**
   * Chats by id, those in the trash aside: what the chat list, the panel and
   * everything else read.
   * @type {import('vue').Ref<Map<string, Chat>>}
   */
  const chats = ref(new Map())

  /**
   * Chats in the trash by id, kept out of `chats`; see `utils/trash.js`.
   * @type {import('vue').Ref<Map<string, Chat>>}
   */
  const trash = ref(new Map())

  /** The stories whose chats have been read. @type {Set<string>} */
  const loadedStories = new Set()

  // Get sync store instance
  const syncStore = useSyncStore()

  /**
   * Create a new chat for a story
   * @param {string} storyId - Parent story ID
   * @param {string} [title] - Chat title
   * @param {string|null} [chatId=null] - Optional chat ID
   * @param {Partial<Chat>} [initial] - Fields to seed onto the new chat
   * @throws {Error} If storyId or title is not provided
   */
  function createChat(storyId, title = '', chatId = null, initial = {}) {
    if (!storyId) {
      throw new Error('Story ID is required to create a chat')
    }

    /** @type {Chat} */
    const chat = {
      id: chatId || generateChatId(),
      storyId,
      title: title || DEFAULT_CHAT_TITLE,
      titleSet: title !== '', // Track whether title has been set (auto or manual)
      lastMessageAt: null,
      // Settings seeded at creation (prompt override, story context). Copied
      // rather than inherited so editing a default never rewrites old chats.
      ...initial,
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    }

    chats.value.set(chat.id, chat)

    // Track change for persistence
    syncStore.trackChange('chats', chat.id, chat)

    return chat
  }

  /**
   * Update an existing chat with partial updates
   * @param {string} chatId - Chat ID to update
   * @param {Partial<Chat>} updates - Fields to update
   * @returns {Chat} Updated chat
   * @throws {Error} If chat not found
   */
  function updateChat(chatId, updates) {
    const chat = chats.value.get(chatId)
    if (!chat) {
      throw new Error(`Failed to update chat, '${chatId}' not found`)
    }

    /** @type {Chat} */
    const updated = {
      ...chat,
      ...updates,
      // Preserve system fields
      id: chat.id,
      storyId: chat.storyId,
      created: chat.created,
      version: chat.version,
      updated: Date.now(),
    }

    chats.value.set(chatId, updated)

    // Track change for persistence
    syncStore.trackChange('chats', chatId, updated)

    return updated
  }

  /**
   * Move a chat to the trash. Its messages stay as they are, and come back
   * with it.
   *
   * @param {string} chatId
   * @param {number} [at] - When, if not now
   * @returns {Chat}
   * @throws {Error} If the chat is not found
   */
  function trashChat(chatId, at = Date.now()) {
    const chat = chats.value.get(chatId)
    if (!chat) {
      throw new Error(`Failed to trash chat, '${chatId}' not found`)
    }
    /** @type {Chat} */
    const next = { ...chat, trashed: at }
    chats.value.delete(chatId)
    trash.value.set(chatId, next)
    syncStore.trackChange('chats', chatId, next)
    return next
  }

  /**
   * Bring a chat back from the trash.
   *
   * @param {string} chatId
   * @returns {Chat}
   * @throws {Error} If the chat is not in the trash
   */
  function restoreChat(chatId) {
    const chat = trash.value.get(chatId)
    if (!chat) {
      throw new Error(`Failed to restore chat, '${chatId}' is not in the trash`)
    }
    /** @type {Chat} */
    const next = { ...chat }
    delete next.trashed
    trash.value.delete(chatId)
    chats.value.set(chatId, next)
    syncStore.trackChange('chats', chatId, next)
    return next
  }

  /**
   * Delete a chat, in the list or in the trash
   * @param {string} chatId - Chat ID to delete
   * @returns {boolean} True if deleted
   * @throws {Error} If chat not found
   */
  function deleteChat(chatId) {
    if (!chats.value.has(chatId) && !trash.value.has(chatId)) {
      throw new Error(`Failed to delete chat, '${chatId}' not found`)
    }

    syncStore.trackDelete('chats', chatId)
    chats.value.delete(chatId)
    trash.value.delete(chatId)

    return true
  }

  /**
   * What a project's trash holds of its chats, the most recent first.
   * @param {string} storyId
   * @returns {Chat[]}
   */
  function trashedOf(storyId) {
    return Array.from(trash.value.values())
      .filter(chat => chat.storyId === storyId)
      .sort((a, b) => (b.trashed ?? 0) - (a.trashed ?? 0))
  }

  /**
   * Get all chats for a story
   * @param {string} storyId - Story ID
   * @returns {Chat[]} Array of chats for the story
   */
  function getChatsForStory(storyId) {
    return Array.from(chats.value.values()).filter(chat => chat.storyId === storyId)
  }

  /**
   * Load chats for a story from database
   * @param {string} storyId - Story ID to load chats for
   * @returns {Promise<void>}
   */
  async function loadChatsForStory(storyId) {
    try {
      const storyChats = await storage.chats(storyId)

      storyChats.forEach(chat => {
        ;(chat.trashed ? chats : trash).value.delete(chat.id)
        ;(chat.trashed ? trash : chats).value.set(chat.id, chat)
      })
      loadedStories.add(storyId)

      console.log(`Loaded ${storyChats.length} chats for story ${storyId}`)
    } catch (error) {
      console.error(`Failed to load chats for story ${storyId}:`, error)
      throw new Error(`Failed to load chats for story: ${error.message}`)
    }
  }

  /**
   * Whether a story's chats have been read.
   * @param {string} storyId
   */
  const isStoryLoaded = storyId => loadedStories.has(storyId)

  /**
   * Take a chat as another device left it, synced (`cloud/`): kept as it
   * came, and saved; null removes it.
   *
   * @param {string} id
   * @param {Chat|null} row
   */
  function receive(id, row) {
    if (row) {
      ;(row.trashed ? chats : trash).value.delete(id)
      ;(row.trashed ? trash : chats).value.set(id, row)
      syncStore.trackChange('chats', id, row)
    } else if (chats.value.has(id) || trash.value.has(id)) {
      chats.value.delete(id)
      trash.value.delete(id)
      syncStore.trackDelete('chats', id)
    }
  }

  /**
   * Update the last message timestamp for a chat
   * @param {string} chatId - Chat ID to update
   * @returns {Chat} Updated chat
   * @throws {Error} If chat not found
   */
  function updateLastMessageTime(chatId) {
    return updateChat(chatId, { lastMessageAt: Date.now() })
  }

  /**
   * Get all chats as an array
   * @returns {Chat[]} All chats
   */
  const allChats = () => {
    return Array.from(chats.value.values())
  }

  /**
   * Get chat by ID (getter function)
   * @param {string} chatId - Chat ID
   * @returns {Chat|undefined} Chat if found
   */
  const getChatById = chatId => {
    return chats.value.get(chatId)
  }

  return {
    // State
    chats,
    trash,

    // Actions
    createChat,
    updateChat,
    trashChat,
    restoreChat,
    deleteChat,
    trashedOf,
    getChatsForStory,
    loadChatsForStory,
    isStoryLoaded,
    receive,
    updateLastMessageTime,

    // Getters
    allChats,
    getChatById,
  }
})
