import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMessagesStore } from '../../src/stores/messagesStore'
import { useChatsStore } from '../../src/stores/chatsStore'

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
      filter: vi.fn(),
    },
  },
}))

// Mock the sync store. One spy for every store made, so a test can ask what
// was saved.
const { trackChange, trackDelete } = vi.hoisted(() => ({
  trackChange: vi.fn(),
  trackDelete: vi.fn(),
}))
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange, trackDelete }),
}))

// Mock nanoid
import { nanoid } from 'nanoid'
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id-123'),
}))

// Mock the chats store
vi.mock('../../src/stores/chatsStore')

describe('MessagesStore', () => {
  /** @type {import('../../src/stores/messagesStore').useMessagesStore} */
  let store
  let mockChatsStore

  beforeEach(() => {
    // Create a fresh Pinia instance before each test
    setActivePinia(createPinia())

    // Setup mock chats store
    mockChatsStore = {
      updateLastMessageTime: vi.fn(),
    }
    vi.mocked(useChatsStore).mockReturnValue(mockChatsStore)

    store = useMessagesStore()
  })

  describe('initialization', () => {
    it('should initialize with an empty messages map', () => {
      expect(store.messages.size).toBe(0)
    })
  })

  describe('createMessage', () => {
    it('should create a new user message with all required fields', () => {
      const message = store.createMessage('chat_123', 'user', 'Hello AI!')

      expect(message).toMatchObject({
        id: 'message_test-id-123',
        chatId: 'chat_123',
        role: 'user',
        content: 'Hello AI!',
        reasoningContent: null,
        streamingStartTime: null,
        streamingFinishTime: null,
        thinkingFinishTime: null,
        edited: false,
        editedAt: null,
        metadata: null,
        version: 1,
      })
      // A row is either there or gone; nothing marks it.
      expect(message).not.toHaveProperty('deleted')
      expect(message).not.toHaveProperty('deletedAt')
      expect(typeof message.created).toBe('number')
      expect(typeof message.updated).toBe('number')
      expect(store.messages.has(message.id)).toBe(true)
      // updateLastMessageTime is now called in useChats, not messagesStore
    })

    it('should create an assistant message with streaming start time when content is empty', () => {
      const beforeTime = Date.now()
      const message = store.createMessage('chat_123', 'assistant', '')

      expect(message.role).toBe('assistant')
      expect(message.content).toBe('')
      expect(message.streamingStartTime).toBeGreaterThanOrEqual(beforeTime)
      expect(message.streamingStartTime).toBeLessThanOrEqual(Date.now())
    })

    it('should create message with reasoning content', () => {
      const message = store.createMessage('chat_123', 'assistant', 'Response', 'Reasoning here')

      expect(message.reasoningContent).toBe('Reasoning here')
    })

    it('should throw error when chatId is missing', () => {
      expect(() => store.createMessage('', 'user', 'Hello')).toThrow('Chat ID is required')
      expect(() => store.createMessage(null, 'user', 'Hello')).toThrow('Chat ID is required')
    })

    it('should throw error when role is missing', () => {
      expect(() => store.createMessage('chat_123', '', 'Hello')).toThrow('Role is required')
      expect(() => store.createMessage('chat_123', null, 'Hello')).toThrow('Role is required')
    })

    it('should throw error when role is invalid', () => {
      expect(() => store.createMessage('chat_123', 'system', 'Hello')).toThrow(
        "Invalid role 'system', must be 'user' or 'assistant'"
      )
    })

    it('should throw error when content is null or undefined', () => {
      expect(() => store.createMessage('chat_123', 'user', null)).toThrow('Content is required')
      expect(() => store.createMessage('chat_123', 'user', undefined)).toThrow(
        'Content is required'
      )
    })
  })

  describe('duplicateMessage', () => {
    let originalMessage

    beforeEach(() => {
      vi.mocked(nanoid).mockReturnValueOnce('original-id')
      originalMessage = store.createMessage('chat_123', 'user', 'Original content')
      // Add some metadata to test copying
      store.updateMessage(originalMessage.id, {
        edited: true,
        editedAt: Date.now(),
        metadata: { test: 'value' },
      })
      originalMessage = store.messages.get(originalMessage.id)
    })

    it('should create a duplicate with new ID but preserve all metadata', () => {
      vi.mocked(nanoid).mockReturnValueOnce('duplicated-id')
      const duplicate = store.duplicateMessage(originalMessage, 'chat_456')

      expect(duplicate.id).not.toBe(originalMessage.id)
      expect(duplicate.id).toBe('message_duplicated-id')
      expect(duplicate.chatId).toBe('chat_456')
      expect(duplicate.role).toBe(originalMessage.role)
      expect(duplicate.content).toBe(originalMessage.content)
      expect(duplicate.reasoningContent).toBe(originalMessage.reasoningContent)
      expect(duplicate.edited).toBe(originalMessage.edited)
      expect(duplicate.editedAt).toBe(originalMessage.editedAt)
      expect(duplicate.metadata).toEqual(originalMessage.metadata)
    })

    it('should preserve original timestamps', () => {
      const duplicate = store.duplicateMessage(originalMessage, 'chat_456')

      expect(duplicate.created).toBe(originalMessage.created)
      expect(duplicate.updated).toBe(originalMessage.updated)
    })

    it('should copy all timing information', () => {
      const messageWithTiming = store.createMessage('chat_123', 'assistant', 'Response')
      store.streamMessageContent(messageWithTiming.id, 'Updated', null, {
        thinkingFinishTime: 1500,
        streamingFinishTime: 3000,
      })
      const withTiming = store.messages.get(messageWithTiming.id)

      const duplicate = store.duplicateMessage(withTiming, 'chat_789')

      expect(duplicate.streamingStartTime).toBe(withTiming.streamingStartTime)
      expect(duplicate.thinkingFinishTime).toBe(withTiming.thinkingFinishTime)
      expect(duplicate.streamingFinishTime).toBe(withTiming.streamingFinishTime)
    })

    it('should reset version', () => {
      const duplicate = store.duplicateMessage(originalMessage, 'chat_456')

      expect(duplicate.version).toBe(1)
    })

    it('should add duplicate to messages store', () => {
      vi.mocked(nanoid).mockReturnValueOnce('duplicated-id')
      const duplicate = store.duplicateMessage(originalMessage, 'chat_456')

      expect(store.messages.has(duplicate.id)).toBe(true)
      expect(store.messages.get(duplicate.id)).toEqual(duplicate)
    })

    it('should throw error when original message is missing', () => {
      expect(() => store.duplicateMessage(null, 'chat_456')).toThrow(
        'Original message is required to duplicate'
      )
      expect(() => store.duplicateMessage(undefined, 'chat_456')).toThrow(
        'Original message is required to duplicate'
      )
    })

    it('should throw error when new chat ID is missing', () => {
      expect(() => store.duplicateMessage(originalMessage, '')).toThrow(
        'New chat ID is required to duplicate message'
      )
      expect(() => store.duplicateMessage(originalMessage, null)).toThrow(
        'New chat ID is required to duplicate message'
      )
    })

    it('should handle messages with reasoning content', () => {
      const messageWithReasoning = store.createMessage(
        'chat_123',
        'assistant',
        'Response',
        'Reasoning here'
      )

      const duplicate = store.duplicateMessage(messageWithReasoning, 'chat_456')

      expect(duplicate.reasoningContent).toBe('Reasoning here')
    })
  })

  describe('alternates', () => {
    /** An assistant message as a turn leaves it, and a way to read it after any write. */
    const answered = content => {
      const { id } = store.createMessage('chat_123', 'assistant', '')
      store.streamMessageContent(id, content, 'thought', { streamingFinishTime: 9 })
      store.updateMessage(id, { metadata: { usage: { requests: 1 } } })
      return { id, get: () => store.messages.get(id) }
    }

    it('keeps the answer when asked again, and starts an empty one', () => {
      const { id, get } = answered('First.')
      const before = get()
      before.pendingToolCalls = [{ id: 'call_1', name: 'oracle', arguments: '' }]

      store.beginAlternate(id)

      expect(get()).toMatchObject({
        content: '',
        reasoningContent: null,
        streamingFinishTime: null,
        metadata: null,
        edited: false,
        alternate: 1,
      })
      expect(get().streamingStartTime).toEqual(expect.any(Number))
      expect(get().pendingToolCalls).toBeUndefined()
      expect(get().alternates).toHaveLength(2)
      expect(get().alternates[0]).toMatchObject({
        content: 'First.',
        reasoningContent: 'thought',
        streamingFinishTime: 9,
        metadata: { usage: { requests: 1 } },
      })
    })

    it('turns back to an earlier answer, and keeps the one it leaves as it stands', () => {
      const { id, get } = answered('First.')
      store.beginAlternate(id)
      store.streamMessageContent(id, 'Second.', null, { streamingFinishTime: 10 })
      store.updateMessage(id, { content: 'Second, edited.' })

      store.selectAlternate(id, 0)

      expect(get()).toMatchObject({ content: 'First.', reasoningContent: 'thought', edited: false })
      expect(get().alternate).toBe(0)
      expect(get().alternates[1]).toMatchObject({ content: 'Second, edited.', edited: true })

      store.selectAlternate(id, 1)

      expect(get()).toMatchObject({ content: 'Second, edited.', edited: true, alternate: 1 })
    })

    it('does not keep an answer that failed before it said anything', () => {
      const { id, get } = answered('First.')
      store.beginAlternate(id)
      store.updateMessage(id, { metadata: { error: 'Server error' } })

      store.beginAlternate(id)

      expect(get()).toMatchObject({ content: '', metadata: null, alternate: 1 })
      expect(get().alternates.map(answer => answer.content)).toEqual(['First.', ''])
    })

    it('asks a first answer that failed again as if it never was', () => {
      const { id } = store.createMessage('chat_123', 'assistant', '')
      store.updateMessage(id, { metadata: { error: 'Server error' } })

      store.beginAlternate(id)

      const message = store.messages.get(id)
      expect(message).toMatchObject({ content: '', metadata: null })
      expect(message.alternates).toBeUndefined()
      expect(message.alternate).toBeUndefined()
    })

    it('keeps a failed answer that had begun', () => {
      const { id, get } = answered('Half a')
      store.updateMessage(id, { metadata: { error: 'connection lost' } })

      store.beginAlternate(id)

      expect(get().alternates[0]).toMatchObject({
        content: 'Half a',
        metadata: { error: 'connection lost' },
      })
    })

    it('refuses an answer that is not there', () => {
      const { id } = answered('First.')
      expect(() => store.selectAlternate(id, 1)).toThrow(`Message '${id}' has no answer 1`)
      expect(() => store.selectAlternate('nope', 0)).toThrow("'nope' not found")
      expect(() => store.beginAlternate('nope')).toThrow("'nope' not found")
    })

    it('takes back an answer stopped empty, and shows the one before it', () => {
      const { id, get } = answered('First.')
      store.beginAlternate(id)
      store.streamMessageContent(id, 'Second.')
      store.beginAlternate(id)

      store.dropAlternate(id)

      expect(get()).toMatchObject({ content: 'Second.', alternate: 1 })
      expect(get().alternates.map(answer => answer.content)).toEqual(['First.', 'Second.'])
    })

    it('leaves a message with one answer as one that was never asked again', () => {
      const { id, get } = answered('First.')
      store.beginAlternate(id)

      store.dropAlternate(id)

      expect(get()).toMatchObject({
        content: 'First.',
        reasoningContent: 'thought',
        streamingFinishTime: 9,
        metadata: { usage: { requests: 1 } },
      })
      expect(get().alternates).toBeUndefined()
      expect(get().alternate).toBeUndefined()
    })

    it('refuses to take back the only answer there is', () => {
      const { id } = answered('First.')
      expect(() => store.dropAlternate(id)).toThrow(`Message '${id}' has no other answer`)
      expect(() => store.dropAlternate('nope')).toThrow("'nope' not found")
    })

    it('copies the other answers along with a duplicate', () => {
      const { id, get } = answered('First.')
      store.beginAlternate(id)
      store.streamMessageContent(id, 'Second.')

      const duplicate = store.duplicateMessage(get(), 'chat_456')

      expect(duplicate.alternates).toEqual(get().alternates)
      expect(duplicate.alternates).not.toBe(get().alternates)
      expect(duplicate.alternate).toBe(1)
    })
  })

  describe('updateMessage', () => {
    beforeEach(() => {
      store.createMessage('chat_123', 'user', 'Original content')
    })

    it('should update an existing message', () => {
      const updated = store.updateMessage('message_test-id-123', {
        content: 'Updated content',
      })

      expect(updated.content).toBe('Updated content')
      expect(updated.edited).toBe(true)
      expect(updated.editedAt).toBeGreaterThan(0)
      expect(updated.version).toBe(1) // Version only increments at persist time
    })

    it('should preserve system fields during update', () => {
      const original = store.messages.get('message_test-id-123')
      const updated = store.updateMessage('message_test-id-123', {
        id: 'different_id',
        chatId: 'different_chat',
        role: 'assistant',
        created: 999,
      })

      expect(updated.id).toBe(original.id)
      expect(updated.chatId).toBe(original.chatId)
      expect(updated.role).toBe(original.role)
      expect(updated.created).toBe(original.created)
    })

    it('should not mark as edited when content unchanged', () => {
      const updated = store.updateMessage('message_test-id-123', {
        metadata: { test: true },
      })

      expect(updated.edited).toBe(false)
      expect(updated.editedAt).toBeNull()
      expect(updated.metadata).toEqual({ test: true })
    })

    it('should throw error when updating non-existent message', () => {
      expect(() => store.updateMessage('non_existent', { content: 'New' })).toThrow(
        "Failed to update message, 'non_existent' not found"
      )
    })
  })

  describe('streamMessageContent', () => {
    beforeEach(() => {
      store.createMessage('chat_123', 'assistant', '')
    })

    it('should stream content without marking as edited', () => {
      const message = store.streamMessageContent('message_test-id-123', 'Streaming content...')

      expect(message.content).toBe('Streaming content...')
      expect(message.edited).toBe(false)
      expect(message.editedAt).toBeNull()
      expect(message.version).toBe(1) // Version not incremented
    })

    it('should update reasoning content when provided', () => {
      const message = store.streamMessageContent(
        'message_test-id-123',
        'Response',
        'Reasoning content'
      )

      expect(message.content).toBe('Response')
      expect(message.reasoningContent).toBe('Reasoning content')
    })

    it('should update timing fields', () => {
      const timing = {
        thinkingFinishTime: Date.now(),
        streamingFinishTime: Date.now() + 1000,
      }

      const message = store.streamMessageContent('message_test-id-123', 'Complete', null, timing)

      expect(message.thinkingFinishTime).toBe(timing.thinkingFinishTime)
      expect(message.streamingFinishTime).toBe(timing.streamingFinishTime)
    })

    it('should throw error when streaming to non-existent message', () => {
      expect(() => store.streamMessageContent('non_existent', 'Content')).toThrow(
        "Failed to stream to message, 'non_existent' not found"
      )
    })

    it('carries the calls in flight, and takes them off when told there are none', () => {
      const pending = [{ id: 'call_1', name: 'edit_document', arguments: '{"path":"a' }]

      const withCalls = store.streamMessageContent('message_test-id-123', 'x', null, {}, pending)
      expect(withCalls.pendingToolCalls).toEqual(pending)

      // Left alone when nothing is said about them.
      const untouched = store.streamMessageContent('message_test-id-123', 'xy')
      expect(untouched.pendingToolCalls).toEqual(pending)

      const cleared = store.streamMessageContent('message_test-id-123', 'xyz', null, {}, [])
      expect(cleared).not.toHaveProperty('pendingToolCalls')
    })
  })

  describe('deleteMessage', () => {
    beforeEach(() => {
      store.createMessage('chat_123', 'user', 'Test message')
    })

    it('removes the message and queues the row for deletion', () => {
      const result = store.deleteMessage('message_test-id-123')

      expect(result).toBe(true)
      expect(store.messages.has('message_test-id-123')).toBe(false) // Removed from cache
      expect(trackDelete).toHaveBeenCalledWith('messages', 'message_test-id-123')
    })

    it('should throw error when deleting non-existent message', () => {
      expect(() => store.deleteMessage('non_existent')).toThrow(
        "Failed to delete message, 'non_existent' not found"
      )
    })
  })

  describe('moveMessage', () => {
    /** Five messages in a chat, a to e, in the order they were written. */
    const five = () =>
      ['a', 'b', 'c', 'd', 'e'].map(id => {
        vi.mocked(nanoid).mockReturnValueOnce(id)
        return store.createMessage('chat_123', 'user', id)
      })
    const order = () => store.getMessagesForChat('chat_123').map(message => message.content)

    it('moves a message up the chat, to sit above the ones before it', () => {
      five()

      store.moveMessage('message_e', 2)

      expect(order()).toEqual(['a', 'b', 'e', 'c', 'd'])
    })

    it('moves one back down', () => {
      five()
      store.moveMessage('message_e', 3)

      store.moveMessage('message_e', -2)

      expect(order()).toEqual(['a', 'b', 'c', 'e', 'd'])
    })

    it('stops at the top of the chat, and at the bottom', () => {
      five()

      store.moveMessage('message_c', 9)
      expect(order()).toEqual(['c', 'a', 'b', 'd', 'e'])

      store.moveMessage('message_c', -9)
      expect(order()).toEqual(['a', 'b', 'd', 'e', 'c'])
    })

    it('finds room between two messages written in the same millisecond', () => {
      const [, b, c] = five()
      c.created = b.created + 1

      store.moveMessage('message_e', 2)

      expect(order()).toEqual(['a', 'b', 'e', 'c', 'd'])
    })

    it('moves nothing else, and nothing in another chat', () => {
      const before = five().map(message => message.created)
      vi.mocked(nanoid).mockReturnValueOnce('z')
      const elsewhere = store.createMessage('chat_456', 'user', 'z').created

      store.moveMessage('message_e', 2)

      const after = ['a', 'b', 'c', 'd'].map(id => store.messages.get(`message_${id}`).created)
      expect(after).toEqual(before.slice(0, 4))
      expect(store.messages.get('message_z').created).toBe(elsewhere)
    })

    it('saves the move', () => {
      five()
      trackChange.mockClear()

      store.moveMessage('message_e', 2)

      expect(trackChange).toHaveBeenCalledWith(
        'messages',
        'message_e',
        expect.objectContaining({ id: 'message_e' })
      )
    })

    it('does nothing when there is nowhere to go', () => {
      five()
      trackChange.mockClear()

      store.moveMessage('message_a', 1)
      store.moveMessage('message_c', 0)

      expect(order()).toEqual(['a', 'b', 'c', 'd', 'e'])
      expect(trackChange).not.toHaveBeenCalled()
    })

    it('throws for a message that is not there', () => {
      expect(() => store.moveMessage('non_existent', 1)).toThrow(
        "Failed to move message, 'non_existent' not found"
      )
    })
  })

  describe('getMessage', () => {
    beforeEach(() => {
      store.createMessage('chat_123', 'user', 'Test message')
    })

    it('should return message from memory if available', async () => {
      const message = await store.getMessage('message_test-id-123')

      expect(message).toBeDefined()
      expect(message.id).toBe('message_test-id-123')
      expect(message.content).toBe('Test message')
    })

    it('should return null for a deleted message', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.messages.get.mockResolvedValue(undefined)
      store.deleteMessage('message_test-id-123')

      const message = await store.getMessage('message_test-id-123')

      expect(message).toBeNull()
    })

    it('should try to load from database if not in memory', async () => {
      const { default: db } = await import('../../src/stores/db')
      const mockMessage = {
        id: 'message_from_db',
        chatId: 'chat_456',
        content: 'DB Message',
      }
      db.messages.get.mockResolvedValue(mockMessage)

      const message = await store.getMessage('message_from_db')

      expect(db.messages.get).toHaveBeenCalledWith('message_from_db')
      expect(message).toEqual(mockMessage)
      expect(store.messages.has('message_from_db')).toBe(true)
    })

    it('should return null when the database has no such message', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.messages.get.mockResolvedValue(undefined)

      const message = await store.getMessage('message_from_db')

      expect(message).toBeNull()
      expect(store.messages.has('message_from_db')).toBe(false)
    })
  })

  describe('getMessagesForChat', () => {
    beforeEach(() => {
      store.createMessage('chat_123', 'user', 'First message')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createMessage('chat_123', 'assistant', 'Second message')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-789')
      store.createMessage('chat_456', 'user', 'Different chat')
    })

    it('should return all messages for a chat sorted by creation', () => {
      const messages = store.getMessagesForChat('chat_123')

      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('First message')
      expect(messages[1].content).toBe('Second message')
    })

    it('should exclude deleted messages', () => {
      store.deleteMessage('message_test-id-123')

      const messages = store.getMessagesForChat('chat_123')

      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('Second message')
    })

    it('should return empty array for chat with no messages', () => {
      const messages = store.getMessagesForChat('chat_999')

      expect(messages).toEqual([])
    })
  })

  describe('deleteMessagesForChat', () => {
    beforeEach(() => {
      trackDelete.mockClear()
      store.createMessage('chat_123', 'user', 'Message 1')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createMessage('chat_123', 'assistant', 'Message 2')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-789')
      store.createMessage('chat_456', 'user', 'Different chat')
    })

    it('should delete all messages for a chat', () => {
      const count = store.deleteMessagesForChat('chat_123')

      expect(count).toBe(2)
      expect(store.messages.has('message_test-id-123')).toBe(false)
      expect(store.messages.has('message_test-id-456')).toBe(false)
      expect(store.messages.has('message_test-id-789')).toBe(true) // Different chat
      expect(trackDelete).toHaveBeenCalledWith('messages', 'message_test-id-123')
      expect(trackDelete).toHaveBeenCalledWith('messages', 'message_test-id-456')
      expect(trackDelete).not.toHaveBeenCalledWith('messages', 'message_test-id-789')
    })

    it('should return 0 for chat with no messages', () => {
      const count = store.deleteMessagesForChat('chat_999')

      expect(count).toBe(0)
    })
  })

  describe('loadMessagesForChat', () => {
    it('should load messages from database and add to cache', async () => {
      const mockMessages = [
        { id: 'msg_1', chatId: 'chat_123', content: 'Message 1' },
        { id: 'msg_2', chatId: 'chat_123', content: 'Message 2' },
        { id: 'msg_3', chatId: 'chat_123', content: 'Message 3' },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.messages.where.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockMessages),
        }),
      })

      await store.loadMessagesForChat('chat_123')

      // Every row the database holds is live, so every one is cached.
      expect(store.messages.size).toBe(3)
      expect(store.messages.has('msg_1')).toBe(true)
      expect(store.messages.has('msg_2')).toBe(true)
      expect(store.messages.has('msg_3')).toBe(true)
    })

    it('should throw error when database fails', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.messages.where.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockRejectedValue(new Error('Database error')),
        }),
      })

      await expect(store.loadMessagesForChat('chat_123')).rejects.toThrow(
        'Failed to load messages: Database error'
      )
    })
  })

  describe('helper functions', () => {
    beforeEach(() => {
      store.createMessage('chat_123', 'user', 'First')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createMessage('chat_123', 'assistant', 'Second')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-789')
      store.createMessage('chat_123', 'user', 'Third')
    })

    it('should get last message for chat', () => {
      const lastMessage = store.getLastMessageForChat('chat_123')

      expect(lastMessage).toBeDefined()
      expect(lastMessage.content).toBe('Third')
    })

    it('should return null when no messages in chat', () => {
      const lastMessage = store.getLastMessageForChat('chat_999')

      expect(lastMessage).toBeNull()
    })

    it('should count messages in chat', () => {
      const count = store.countMessagesForChat('chat_123')

      expect(count).toBe(3)
    })

    it('should return 0 count for empty chat', () => {
      const count = store.countMessagesForChat('chat_999')

      expect(count).toBe(0)
    })
  })

  describe('getters', () => {
    beforeEach(() => {
      store.createMessage('chat_123', 'user', 'Message 1')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createMessage('chat_456', 'assistant', 'Message 2')
    })

    it('should return every message with allMessages', () => {
      const allMessages = store.allMessages()

      expect(allMessages).toHaveLength(2)
      expect(allMessages[0].content).toBe('Message 1')
      expect(allMessages[1].content).toBe('Message 2')
    })

    it('should exclude deleted messages from allMessages', () => {
      store.deleteMessage('message_test-id-123')

      const allMessages = store.allMessages()

      expect(allMessages).toHaveLength(1)
      expect(allMessages[0].content).toBe('Message 2')
    })

    it('should get message by ID with getMessageById', () => {
      const message = store.getMessageById('message_test-id-123')

      expect(message.value).toBeDefined()
      expect(message.value.content).toBe('Message 1')
    })

    it('should return null for non-existent message with getMessageById', () => {
      const message = store.getMessageById('non_existent')

      expect(message.value).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('should allow empty string content', () => {
      const message = store.createMessage('chat_123', 'assistant', '')

      expect(message.content).toBe('')
    })

    it('should handle concurrent updates correctly', () => {
      nanoid.mockReturnValue('test-id-123')
      store.createMessage('chat_123', 'user', 'Test')

      const update1 = store.updateMessage('message_test-id-123', { metadata: { v: 1 } })
      const update2 = store.updateMessage('message_test-id-123', { metadata: { v: 2 } })

      expect(update1.version).toBe(1) // Version only increments at persist time
      expect(update2.version).toBe(1) // Version only increments at persist time
      expect(store.messages.get('message_test-id-123').metadata).toEqual({ v: 2 })
    })

    it('should handle streaming and regular updates independently', () => {
      nanoid.mockReturnValue('test-id-123')
      store.createMessage('chat_123', 'assistant', '')

      // Stream content
      store.streamMessageContent('message_test-id-123', 'Streamed')
      const afterStream = store.messages.get('message_test-id-123')
      expect(afterStream.version).toBe(1)
      expect(afterStream.edited).toBe(false)

      // Regular update
      const updated = store.updateMessage('message_test-id-123', { content: 'Edited' })
      expect(updated.version).toBe(1) // Version only increments at persist time
      expect(updated.edited).toBe(true)
    })
  })

  describe('forgetSavedRequests', () => {
    /** The rows the database would go through, and what they came out as. */
    let stored
    let modified

    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      stored = []
      modified = []
      vi.mocked(db.messages.filter).mockImplementation(keep => ({
        modify: vi.fn(async change => {
          for (const row of stored.filter(keep)) {
            change(row)
            modified.push(row)
          }
        }),
      }))
      trackChange.mockClear()
    })

    const request = [
      { role: 'system', content: 'You are a writing partner.' },
      { role: 'user', content: 'Hello' },
    ]

    /** An answer asked again, both times with Debug on. */
    const answered = () => {
      vi.mocked(nanoid).mockReturnValueOnce('answered')
      const message = store.createMessage('chat_123', 'assistant', 'Second')
      store.updateMessage(message.id, {
        metadata: { model: 'm', usage: { total_tokens: 5 }, context: request },
        alternates: [
          { content: 'First', metadata: { model: 'm', context: request } },
          { content: 'Second', metadata: { model: 'm', context: request } },
        ],
      })
      return message.id
    }

    it('takes the request off a loaded message and each of its answers', async () => {
      const id = answered()

      await store.forgetSavedRequests()

      const message = store.messages.get(id)
      expect(message.metadata).toEqual({ model: 'm', usage: { total_tokens: 5 } })
      expect(message.alternates.map(answer => answer.metadata)).toEqual([
        { model: 'm' },
        { model: 'm' },
      ])
      expect(message.alternates.map(answer => answer.content)).toEqual(['First', 'Second'])
      expect(message.content).toBe('Second')
    })

    it('saves the message without it, so it is not written back later', async () => {
      const id = answered()
      trackChange.mockClear()

      await store.forgetSavedRequests()

      expect(trackChange).toHaveBeenCalledTimes(1)
      const [, savedId, data] = trackChange.mock.calls[0]
      expect(savedId).toBe(id)
      expect(data.metadata.context).toBeUndefined()
      expect(data.alternates.every(answer => answer.metadata.context === undefined)).toBe(true)
    })

    it('leaves a message that kept nothing as it was', async () => {
      vi.mocked(nanoid).mockReturnValueOnce('plain')
      const message = store.createMessage('chat_123', 'assistant', 'Hi')
      store.updateMessage(message.id, { metadata: { model: 'm' } })
      trackChange.mockClear()

      await store.forgetSavedRequests()

      expect(trackChange).not.toHaveBeenCalled()
      expect(store.messages.get(message.id).metadata).toEqual({ model: 'm' })
    })

    it('forgets the requests of messages in chats that are not loaded', async () => {
      stored = [
        { id: 'a', metadata: { model: 'm', context: request } },
        { id: 'b', metadata: { model: 'm' }, alternates: [{ metadata: { context: request } }] },
        { id: 'c', metadata: { model: 'm' } },
      ]

      await store.forgetSavedRequests()

      expect(modified.map(row => row.id)).toEqual(['a', 'b'])
      expect(stored[0].metadata).toEqual({ model: 'm' })
      expect(stored[1].alternates[0].metadata).toEqual({})
      expect(stored[2].metadata).toEqual({ model: 'm' })
    })
  })
})
