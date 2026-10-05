import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMessagesStore } from '../../src/stores/messagesStore'
import { useChatsStore } from '../../src/stores/chatsStore'
import { nextTick } from 'vue'
import { waitForReactivity, isReactiveValue } from '../utils/reactivity'

// Mock the database module
vi.mock('../../src/stores/db', () => ({
  default: {
    messages: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn(),
        })),
      })),
      get: vi.fn(),
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

// Mock nanoid
import { nanoid } from 'nanoid'
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id-123'),
}))

// Mock the chats store
vi.mock('../../src/stores/chatsStore')

describe('MessagesStore Reactivity', () => {
  let store
  let mockChatsStore

  beforeEach(() => {
    setActivePinia(createPinia())

    // Setup mock chats store
    mockChatsStore = {
      updateLastMessageTime: vi.fn(),
    }
    vi.mocked(useChatsStore).mockReturnValue(mockChatsStore)

    store = useMessagesStore()
  })

  describe('message reactivity', () => {
    it('should make messages reactive when created', () => {
      const message = store.createMessage('chat_123', 'user', 'Hello')

      // The message in the store should be reactive
      const storedMessage = store.messages.get(message.id)
      expect(isReactiveValue(storedMessage)).toBe(true)
    })

    it('should make messages reactive when updated', () => {
      const message = store.createMessage('chat_123', 'user', 'Hello')
      store.updateMessage(message.id, { content: 'Updated' })

      // The updated message should be reactive
      const storedMessage = store.messages.get(message.id)
      expect(isReactiveValue(storedMessage)).toBe(true)
      expect(storedMessage.content).toBe('Updated')
    })

    it('should make messages reactive when loaded from DB', async () => {
      const { default: db } = await import('../../src/stores/db')
      const mockMessage = {
        id: 'message_from_db',
        chatId: 'chat_456',
        content: 'DB Message',
      }
      db.messages.get.mockResolvedValue(mockMessage)

      await store.getMessage('message_from_db')

      const storedMessage = store.messages.get('message_from_db')
      expect(isReactiveValue(storedMessage)).toBe(true)
    })
  })

  describe('plain array returns', () => {
    it('should return plain array when message list changes', async () => {
      const chatId = 'chat_123'
      let messages = store.getMessagesForChat(chatId)

      expect(messages).toEqual([])

      // Add a message
      store.createMessage(chatId, 'user', 'Hello')
      messages = store.getMessagesForChat(chatId)

      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('Hello')

      // Add another message
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createMessage(chatId, 'assistant', 'Hi there')
      messages = store.getMessagesForChat(chatId)

      expect(messages).toHaveLength(2)
      expect(messages[1].content).toBe('Hi there')
    })

    it('should return updated array when message is deleted', async () => {
      const chatId = 'chat_123'
      const message = store.createMessage(chatId, 'user', 'Hello')
      let messages = store.getMessagesForChat(chatId)

      expect(messages).toHaveLength(1)

      store.deleteMessage(message.id)
      messages = store.getMessagesForChat(chatId)

      expect(messages).toHaveLength(0)
    })

    it('should update computed ref for single message', async () => {
      const message = store.createMessage('chat_123', 'user', 'Hello')
      const messageComputed = store.getMessageById(message.id)

      expect(messageComputed.value).toBeTruthy()
      expect(messageComputed.value.content).toBe('Hello')

      // Update the message
      store.updateMessage(message.id, { content: 'Updated' })
      await waitForReactivity()

      expect(messageComputed.value.content).toBe('Updated')
    })

    it('should return null for deleted message in computed', async () => {
      const message = store.createMessage('chat_123', 'user', 'Hello')
      const messageComputed = store.getMessageById(message.id)

      expect(messageComputed.value).toBeTruthy()

      store.deleteMessage(message.id)
      await waitForReactivity()

      expect(messageComputed.value).toBeNull()
    })
  })

  describe('streaming reactivity', () => {
    it('should trigger reactivity when streaming content', async () => {
      const message = store.createMessage('chat_123', 'assistant', '')
      const messageComputed = store.getMessageById(message.id)

      expect(messageComputed.value.content).toBe('')

      // Stream content
      store.streamMessageContent(message.id, 'Streaming...')
      await waitForReactivity()

      expect(messageComputed.value.content).toBe('Streaming...')

      // Stream more content
      store.streamMessageContent(message.id, 'Streaming... more content')
      await waitForReactivity()

      expect(messageComputed.value.content).toBe('Streaming... more content')
    })

    it('should trigger reactivity when updating reasoning content', async () => {
      const message = store.createMessage('chat_123', 'assistant', '')
      const messageComputed = store.getMessageById(message.id)

      expect(messageComputed.value.reasoningContent).toBeNull()

      // Stream reasoning
      store.streamMessageContent(message.id, 'Response', 'Reasoning...')
      await waitForReactivity()

      expect(messageComputed.value.reasoningContent).toBe('Reasoning...')
    })

    it('should trigger reactivity when updating timing fields', async () => {
      const message = store.createMessage('chat_123', 'assistant', '')
      const messageComputed = store.getMessageById(message.id)

      expect(messageComputed.value.thinkingFinishTime).toBeNull()
      expect(messageComputed.value.streamingFinishTime).toBeNull()

      const timing = {
        thinkingFinishTime: Date.now(),
        streamingFinishTime: Date.now() + 1000,
      }

      store.streamMessageContent(message.id, 'Done', null, timing)
      await waitForReactivity()

      expect(messageComputed.value.thinkingFinishTime).toBe(timing.thinkingFinishTime)
      expect(messageComputed.value.streamingFinishTime).toBe(timing.streamingFinishTime)
    })

    it('should allow multiple rapid content updates', async () => {
      const message = store.createMessage('chat_123', 'assistant', '')
      const messageComputed = store.getMessageById(message.id)

      const updates = ['H', 'He', 'Hel', 'Hell', 'Hello', 'Hello!']

      for (const content of updates) {
        store.streamMessageContent(message.id, content)
        await waitForReactivity()
        expect(messageComputed.value.content).toBe(content)
      }
    })
  })

  describe('message list updates', () => {
    it('should handle batch message deletions', async () => {
      const chatId = 'chat_123'

      // Create multiple messages
      nanoid.mockReturnValue('msg-1')
      store.createMessage(chatId, 'user', 'Message 1')
      nanoid.mockReturnValue('msg-2')
      store.createMessage(chatId, 'assistant', 'Message 2')
      nanoid.mockReturnValue('msg-3')
      const msg3 = store.createMessage(chatId, 'user', 'Message 3')
      nanoid.mockReturnValue('msg-4')
      const msg4 = store.createMessage(chatId, 'assistant', 'Message 4')

      let messages = store.getMessagesForChat(chatId)
      expect(messages).toHaveLength(4)

      // Delete messages 3 and 4 (simulating truncate from index 2)
      store.deleteMessage(msg3.id)
      store.deleteMessage(msg4.id)

      messages = store.getMessagesForChat(chatId)
      await waitForReactivity()

      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('Message 1')
      expect(messages[1].content).toBe('Message 2')
    })

    it('should handle concurrent updates to different messages', async () => {
      const chatId = 'chat_123'

      nanoid.mockReturnValue('msg-1')
      const msg1 = store.createMessage(chatId, 'user', 'First')
      nanoid.mockReturnValue('msg-2')
      const msg2 = store.createMessage(chatId, 'assistant', '')

      const msg1Computed = store.getMessageById(msg1.id)
      const msg2Computed = store.getMessageById(msg2.id)

      // Update both messages
      store.updateMessage(msg1.id, { content: 'First Updated' })
      store.streamMessageContent(msg2.id, 'Streaming response')
      await waitForReactivity()

      expect(msg1Computed.value.content).toBe('First Updated')
      expect(msg1Computed.value.edited).toBe(true)
      expect(msg2Computed.value.content).toBe('Streaming response')
      expect(msg2Computed.value.edited).toBe(false)
    })
  })

  describe('cross-component reactivity', () => {
    it('should allow multiple components to track the same message', async () => {
      const message = store.createMessage('chat_123', 'user', 'Hello')

      // Simulate multiple components watching the same message
      const computed1 = store.getMessageById(message.id)
      const computed2 = store.getMessageById(message.id)
      const computed3 = store.getMessageById(message.id)

      expect(computed1.value.content).toBe('Hello')
      expect(computed2.value.content).toBe('Hello')
      expect(computed3.value.content).toBe('Hello')

      // Update the message
      store.updateMessage(message.id, { content: 'Updated' })
      await waitForReactivity()

      // All computed refs should update
      expect(computed1.value.content).toBe('Updated')
      expect(computed2.value.content).toBe('Updated')
      expect(computed3.value.content).toBe('Updated')
    })

    it('should handle rapid streaming updates across components', async () => {
      const message = store.createMessage('chat_123', 'assistant', '')

      // Multiple computed refs watching the same message
      const computed1 = store.getMessageById(message.id)
      const computed2 = store.getMessageById(message.id)

      // Rapid streaming updates
      const contents = ['H', 'He', 'Hel', 'Hell', 'Hello']
      for (const content of contents) {
        store.streamMessageContent(message.id, content)
        await nextTick() // Minimal wait
        expect(computed1.value.content).toBe(content)
        expect(computed2.value.content).toBe(content)
      }
    })
  })
})
