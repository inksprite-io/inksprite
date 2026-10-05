import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChats } from '../../src/composables/useChats'
import { useChatsStore } from '../../src/stores/chatsStore'
import { useMessagesStore } from '../../src/stores/messagesStore'
import { nextTick } from 'vue'
import { clearChatsInstances } from '../../src/composables/useChats'

// Mock the database
vi.mock('../../src/stores/db', () => ({
  default: {
    chats: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([]),
        })),
      })),
    },
    messages: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([]),
        })),
      })),
    },
  },
}))

// Mock the sync store
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({
    trackChange: vi.fn(),
    trackDelete: vi.fn(),
  }),
}))

describe('useChats Reactivity', () => {
  let chatsApi
  let chatsStore
  let messagesStore

  beforeEach(async () => {
    // Clear singleton instances
    clearChatsInstances()

    // Create fresh pinia instance
    setActivePinia(createPinia())

    // Get store instances
    chatsStore = useChatsStore()
    messagesStore = useMessagesStore()

    // Initialize API
    chatsApi = useChats('story_123')
    await chatsApi.init()
  })

  describe('truncateMessagesForChat', () => {
    it('should update computed ref when messages are truncated', async () => {
      const chatId = 'chat_123'

      // Create a chat
      chatsStore.createChat('story_123', 'Test Chat')

      // Create messages
      messagesStore.createMessage(chatId, 'user', 'Message 1')
      messagesStore.createMessage(chatId, 'assistant', 'Message 2')
      messagesStore.createMessage(chatId, 'user', 'Message 3')
      messagesStore.createMessage(chatId, 'assistant', 'Message 4')

      // Get computed ref for messages
      const messagesRef = chatsApi.getMessagesForChat(chatId)

      // Verify initial state
      expect(messagesRef.value).toHaveLength(4)
      expect(messagesRef.value[0].content).toBe('Message 1')
      expect(messagesRef.value[3].content).toBe('Message 4')

      // Truncate messages from index 2
      const deletedCount = chatsApi.truncateMessagesForChat(chatId, 2)
      expect(deletedCount).toBe(2)

      // Wait for reactivity
      await nextTick()

      // Verify messages were truncated and computed ref updated
      expect(messagesRef.value).toHaveLength(2)
      expect(messagesRef.value[0].content).toBe('Message 1')
      expect(messagesRef.value[1].content).toBe('Message 2')
    })

    it('should handle truncating all messages', async () => {
      const chatId = 'chat_123'

      // Create messages
      messagesStore.createMessage(chatId, 'user', 'Message 1')
      messagesStore.createMessage(chatId, 'assistant', 'Message 2')

      // Get computed ref
      const messagesRef = chatsApi.getMessagesForChat(chatId)
      expect(messagesRef.value).toHaveLength(2)

      // Truncate all messages
      const deletedCount = chatsApi.truncateMessagesForChat(chatId, 0)
      expect(deletedCount).toBe(2)

      await nextTick()

      // Should be empty now
      expect(messagesRef.value).toHaveLength(0)
    })

    it('should handle invalid truncate index', async () => {
      const chatId = 'chat_123'

      // Create messages
      messagesStore.createMessage(chatId, 'user', 'Message 1')
      messagesStore.createMessage(chatId, 'assistant', 'Message 2')

      const messagesRef = chatsApi.getMessagesForChat(chatId)
      expect(messagesRef.value).toHaveLength(2)

      // Try to truncate with invalid index
      const deletedCount1 = chatsApi.truncateMessagesForChat(chatId, -1)
      expect(deletedCount1).toBe(0)

      const deletedCount2 = chatsApi.truncateMessagesForChat(chatId, 5)
      expect(deletedCount2).toBe(0)

      await nextTick()

      // Messages should be unchanged
      expect(messagesRef.value).toHaveLength(2)
    })

    it('should maintain reactivity across multiple components', async () => {
      const chatId = 'chat_123'

      // Create messages
      messagesStore.createMessage(chatId, 'user', 'Message 1')
      messagesStore.createMessage(chatId, 'assistant', 'Message 2')
      messagesStore.createMessage(chatId, 'user', 'Message 3')

      // Get multiple computed refs (simulating multiple components)
      const messagesRef1 = chatsApi.getMessagesForChat(chatId)
      const messagesRef2 = chatsApi.getMessagesForChat(chatId)
      const messagesRef3 = chatsApi.getMessagesForChat(chatId)

      // All should see the same messages
      expect(messagesRef1.value).toHaveLength(3)
      expect(messagesRef2.value).toHaveLength(3)
      expect(messagesRef3.value).toHaveLength(3)

      // Truncate
      chatsApi.truncateMessagesForChat(chatId, 1)
      await nextTick()

      // All refs should update
      expect(messagesRef1.value).toHaveLength(1)
      expect(messagesRef2.value).toHaveLength(1)
      expect(messagesRef3.value).toHaveLength(1)
      expect(messagesRef1.value[0].content).toBe('Message 1')
      expect(messagesRef2.value[0].content).toBe('Message 1')
      expect(messagesRef3.value[0].content).toBe('Message 1')
    })
  })

  describe('message addition reactivity', () => {
    it('should update computed ref when message is added', async () => {
      const chatId = 'chat_123'

      // Get computed ref
      const messagesRef = chatsApi.getMessagesForChat(chatId)
      expect(messagesRef.value).toHaveLength(0)

      // Add message
      chatsApi.addMessage(chatId, 'user', 'Hello')
      await nextTick()

      expect(messagesRef.value).toHaveLength(1)
      expect(messagesRef.value[0].content).toBe('Hello')

      // Add another
      chatsApi.addMessage(chatId, 'assistant', 'Hi there')
      await nextTick()

      expect(messagesRef.value).toHaveLength(2)
      expect(messagesRef.value[1].content).toBe('Hi there')
    })
  })

  describe('message streaming reactivity', () => {
    it('should update computed ref during streaming', async () => {
      const chatId = 'chat_123'

      // Add initial message
      const message = chatsApi.addMessage(chatId, 'assistant', '')

      // Get computed ref
      const messagesRef = chatsApi.getMessagesForChat(chatId)
      expect(messagesRef.value).toHaveLength(1)
      expect(messagesRef.value[0].content).toBe('')

      // Stream content
      chatsApi.streamMessageContent(message.id, 'Streaming...')
      await nextTick()

      expect(messagesRef.value[0].content).toBe('Streaming...')

      // Stream more
      chatsApi.streamMessageContent(message.id, 'Streaming... complete')
      await nextTick()

      expect(messagesRef.value[0].content).toBe('Streaming... complete')
    })
  })
})
