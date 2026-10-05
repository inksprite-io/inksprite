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
import db from './db'

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
   * @type {import('vue').Ref<Map<string, Chat>>}
   */
  const chats = ref(new Map())

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
      title: title || 'Untitled Chat',
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
   * Delete a chat
   * @param {string} chatId - Chat ID to delete
   * @returns {boolean} True if deleted
   * @throws {Error} If chat not found
   */
  function deleteChat(chatId) {
    const chat = chats.value.get(chatId)
    if (!chat) {
      throw new Error(`Failed to delete chat, '${chatId}' not found`)
    }

    syncStore.trackDelete('chats', chatId)
    chats.value.delete(chatId)

    return true
  }

  /**
   * Get a single chat by ID
   * @param {string} chatId - Chat ID to retrieve
   * @returns {Promise<Chat|null>} Chat if found and not deleted, null otherwise
   */
  async function getChat(chatId) {
    const chat = chats.value.get(chatId)
    if (!chat) {
      // Try loading from database
      try {
        const dbChat = await db.chats.get(chatId)
        if (dbChat) {
          chats.value.set(dbChat.id, dbChat)
          return dbChat
        }
      } catch (error) {
        console.error(`Failed to load chat '${chatId}' from database:`, error)
      }
      return null
    }

    return chat
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
      const storyChats = await db.chats.where('storyId').equals(storyId).toArray()

      storyChats.forEach(chat => {
        chats.value.set(chat.id, chat)
      })

      console.log(`Loaded ${storyChats.length} chats for story ${storyId}`)
    } catch (error) {
      console.error(`Failed to load chats for story ${storyId}:`, error)
      throw new Error(`Failed to load chats for story: ${error.message}`)
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

    // Actions
    createChat,
    updateChat,
    deleteChat,
    getChat,
    getChatsForStory,
    loadChatsForStory,
    updateLastMessageTime,

    // Getters
    allChats,
    getChatById,
  }
})
