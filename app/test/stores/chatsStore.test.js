import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatsStore } from '../../src/stores/chatsStore'

// Mock the database module
vi.mock('../../src/stores/db', () => ({
  default: {
    chats: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn(),
        })),
      })),
      get: vi.fn(),
    },
  },
}))

// Mock the sync store. One spy for every store made, so a test can ask what
// was saved or deleted.
const trackChange = vi.fn()
const trackDelete = vi.fn()
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange, trackDelete }),
}))

// Mock nanoid
import { nanoid } from 'nanoid'
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id-123'),
}))

describe('ChatsStore', () => {
  /** @type {import('../../src/stores/chatsStore').useChatsStore} */
  let store

  beforeEach(() => {
    // Create a fresh Pinia instance before each test
    setActivePinia(createPinia())
    store = useChatsStore()
  })

  describe('initialization', () => {
    it('should initialize with an empty chats map', () => {
      expect(store.chats.size).toBe(0)
    })
  })

  describe('createChat', () => {
    it('should create a new chat with all required fields', () => {
      const chat = store.createChat('story_123', 'Character Development')

      expect(chat).toMatchObject({
        id: 'chat_test-id-123',
        storyId: 'story_123',
        title: 'Character Development',
        titleSet: true, // titleSet is true when a non-empty title is provided
        lastMessageAt: null,
        version: 1,
      })
      expect(typeof chat.created).toBe('number')
      expect(typeof chat.updated).toBe('number')
      expect(store.chats.has(chat.id)).toBe(true)
    })

    it('should throw error when storyId is missing', () => {
      expect(() => store.createChat('', 'Test Title')).toThrow(
        'Story ID is required to create a chat'
      )
      expect(() => store.createChat(null, 'Test Title')).toThrow(
        'Story ID is required to create a chat'
      )
      expect(() => store.createChat(undefined, 'Test Title')).toThrow(
        'Story ID is required to create a chat'
      )
    })

    it('should create chat with default title when title is not provided', () => {
      const chat1 = store.createChat('story_123', '')
      expect(chat1.title).toBe('Untitled Chat')
      expect(chat1.titleSet).toBe(false)

      const chat2 = store.createChat('story_123')
      expect(chat2.title).toBe('Untitled Chat')
      expect(chat2.titleSet).toBe(false)
    })
  })

  describe('updateChat', () => {
    beforeEach(() => {
      store.createChat('story_123', 'Test Chat')
    })

    it('should update an existing chat', () => {
      const updated = store.updateChat('chat_test-id-123', {
        title: 'Updated Title',
        titleSet: true,
      })

      expect(updated.title).toBe('Updated Title')
      expect(updated.titleSet).toBe(true)
      expect(updated.version).toBe(1) // Version only increments at persist time
      expect(updated.storyId).toBe('story_123') // System field preserved
      expect(updated.created).toBeLessThanOrEqual(updated.updated)
    })

    it('should preserve system fields during update', () => {
      const original = store.chats.get('chat_test-id-123')
      const updated = store.updateChat('chat_test-id-123', {
        id: 'different_id',
        storyId: 'different_story',
        created: 999,
        version: 999,
      })

      expect(updated.id).toBe(original.id)
      expect(updated.storyId).toBe(original.storyId)
      expect(updated.created).toBe(original.created)
      expect(updated.version).toBe(1) // Version only increments at persist time // Incremented, not set to 999
    })

    it('should throw error when updating non-existent chat', () => {
      expect(() => store.updateChat('non_existent', { title: 'New' })).toThrow(
        "Failed to update chat, 'non_existent' not found"
      )
    })
  })

  describe('deleteChat', () => {
    beforeEach(() => {
      store.createChat('story_123', 'Test Chat')
    })

    it('should delete a chat', () => {
      const result = store.deleteChat('chat_test-id-123')

      expect(result).toBe(true)
      expect(store.chats.has('chat_test-id-123')).toBe(false) // Removed from cache
      expect(store.getChatById('chat_test-id-123')).toBeUndefined()
      expect(trackDelete).toHaveBeenCalledWith('chats', 'chat_test-id-123')
    })

    it('should throw error when deleting non-existent chat', () => {
      expect(() => store.deleteChat('non_existent')).toThrow(
        "Failed to delete chat, 'non_existent' not found"
      )
    })
  })

  describe('getChat', () => {
    beforeEach(() => {
      store.createChat('story_123', 'Test Chat')
    })

    it('should return chat from memory if available', async () => {
      const chat = await store.getChat('chat_test-id-123')

      expect(chat).toBeDefined()
      expect(chat.id).toBe('chat_test-id-123')
      expect(chat.title).toBe('Test Chat')
    })

    it('should return null for deleted chats', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.chats.get.mockResolvedValue(undefined) // Gone from the database too
      store.deleteChat('chat_test-id-123')

      const chat = await store.getChat('chat_test-id-123')

      expect(chat).toBeNull()
    })

    it('should try to load from database if not in memory', async () => {
      const { default: db } = await import('../../src/stores/db')
      const mockChat = {
        id: 'chat_from_db',
        storyId: 'story_456',
        title: 'DB Chat',
      }
      db.chats.get.mockResolvedValue(mockChat)

      const chat = await store.getChat('chat_from_db')

      expect(db.chats.get).toHaveBeenCalledWith('chat_from_db')
      expect(chat).toEqual(mockChat)
      expect(store.chats.has('chat_from_db')).toBe(true) // Added to cache
    })

    it('should return null if chat not found anywhere', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.chats.get.mockResolvedValue(null)

      const chat = await store.getChat('non_existent')

      expect(chat).toBeNull()
    })
  })

  describe('getChatsForStory', () => {
    beforeEach(() => {
      store.createChat('story_123', 'Chat 1')
      // Create another chat with new ID
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createChat('story_123', 'Chat 2')
      // Create chat for different story
      vi.mocked(nanoid).mockReturnValueOnce('test-id-789')
      store.createChat('story_456', 'Chat 3')
    })

    it('should return all chats for a story', () => {
      const chats = store.getChatsForStory('story_123')

      expect(chats).toHaveLength(2)
      expect(chats[0].title).toBe('Chat 1')
      expect(chats[1].title).toBe('Chat 2')
    })

    it('should exclude deleted chats', () => {
      store.deleteChat('chat_test-id-123')

      const chats = store.getChatsForStory('story_123')

      expect(chats).toHaveLength(1)
      expect(chats[0].title).toBe('Chat 2')
    })

    it('should return empty array for story with no chats', () => {
      const chats = store.getChatsForStory('story_999')

      expect(chats).toEqual([])
    })
  })

  describe('loadChatsForStory', () => {
    it('should load chats from database and add to cache', async () => {
      const mockChats = [
        { id: 'chat_1', storyId: 'story_123', title: 'Chat 1' },
        { id: 'chat_2', storyId: 'story_123', title: 'Chat 2' },
        { id: 'chat_3', storyId: 'story_123', title: 'Chat 3' },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.chats.where.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockChats),
        }),
      })

      await store.loadChatsForStory('story_123')

      expect(store.chats.size).toBe(3)
      expect(store.chats.has('chat_1')).toBe(true)
      expect(store.chats.has('chat_2')).toBe(true)
      expect(store.chats.has('chat_3')).toBe(true)
    })

    it('should throw error when database fails', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.chats.where.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockRejectedValue(new Error('Database error')),
        }),
      })

      await expect(store.loadChatsForStory('story_123')).rejects.toThrow(
        'Failed to load chats for story: Database error'
      )
    })
  })

  describe('updateLastMessageTime', () => {
    beforeEach(() => {
      store.createChat('story_123', 'Test Chat')
    })

    it('should update lastMessageAt timestamp', () => {
      const beforeTime = Date.now()
      const updated = store.updateLastMessageTime('chat_test-id-123')

      expect(updated.lastMessageAt).toBeGreaterThanOrEqual(beforeTime)
      expect(updated.lastMessageAt).toBeLessThanOrEqual(Date.now())
    })

    it('should throw error for non-existent chat', () => {
      expect(() => store.updateLastMessageTime('non_existent')).toThrow(
        "Failed to update chat, 'non_existent' not found"
      )
    })
  })

  describe('getters', () => {
    beforeEach(() => {
      store.createChat('story_123', 'Chat 1')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createChat('story_456', 'Chat 2')
    })

    it('should return all chats with allChats', () => {
      const allChats = store.allChats()

      expect(allChats).toHaveLength(2)
      expect(allChats[0].title).toBe('Chat 1')
      expect(allChats[1].title).toBe('Chat 2')
    })

    it('should exclude deleted chats from allChats', () => {
      store.deleteChat('chat_test-id-123')

      const allChats = store.allChats()

      expect(allChats).toHaveLength(1)
      expect(allChats[0].title).toBe('Chat 2')
    })

    it('should get chat by ID with getChatById', () => {
      const chat = store.getChatById('chat_test-id-123')

      expect(chat).toBeDefined()
      expect(chat.title).toBe('Chat 1')
    })

    it('should return undefined for non-existent chat with getChatById', () => {
      const chat = store.getChatById('non_existent')

      expect(chat).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should handle empty string values appropriately', () => {
      expect(() => store.createChat('', '')).toThrow('Story ID is required')
    })

    it('should handle null and undefined values', () => {
      expect(() => store.createChat(null, 'Title')).toThrow('Story ID is required')
      // Title is now optional, so undefined should create a chat with default title
      const chat = store.createChat('story_123', undefined)
      expect(chat.title).toBe('Untitled Chat')
    })

    it('should handle concurrent updates correctly', () => {
      store.createChat('story_123', 'Test Chat')

      const update1 = store.updateChat('chat_test-id-123', { title: 'Title 1' })
      const update2 = store.updateChat('chat_test-id-123', { title: 'Title 2' })

      expect(update1.version).toBe(1) // Version only increments at persist time
      expect(update2.version).toBe(1) // Version only increments at persist time
      expect(store.chats.get('chat_test-id-123').title).toBe('Title 2')
    })
  })
})
