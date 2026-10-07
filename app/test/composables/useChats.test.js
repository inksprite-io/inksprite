import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChats, clearChatsInstances } from '@/composables/useChats'
import { useChatsStore } from '@/stores/chatsStore'
import { useMessagesStore } from '@/stores/messagesStore'
import { setActivePinia, createPinia } from 'pinia'

const { mockGetStory, mockGetProfile, mockSaveProfile } = vi.hoisted(() => ({
  mockGetStory: vi.fn(() => null),
  mockGetProfile: vi.fn(() => null),
  mockSaveProfile: vi.fn(() => ({ id: 'chatprofile_saved_here' })),
}))

// Mock the stores
vi.mock('@/stores/chatsStore')
vi.mock('@/stores/messagesStore')
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({ getStory: mockGetStory }),
}))
// The built-ins come from source either way; `mockGetProfile` is for the saved
// ones, which is all the import path cares about.
vi.mock('@/composables/useProfiles', async () => {
  const { getBuiltInProfile } = await import('@/ai/profiles/index.js')
  return {
    useProfiles: () => ({
      getProfile: id => getBuiltInProfile(id) || mockGetProfile(id),
      saveProfile: mockSaveProfile,
    }),
  }
})

describe('useChats', () => {
  let chatsStore
  let messagesStore
  let composable

  const mockStoryId = 'story_123'
  const mockChatId = 'chat_456'
  const mockMessageId = 'msg_789'

  const mockChats = [
    {
      id: mockChatId,
      storyId: mockStoryId,
      title: 'World Building Discussion',
      description: 'Discussion about the fantasy world',
      contextOptions: { lorebook: { disabledEntries: [] } },
      lastMessageAt: Date.now() - 1000,
      created: Date.now() - 10000,
      updated: Date.now() - 1000,
      version: 1,
      deleted: false,
      deletedAt: null,
    },
    {
      id: 'chat_999',
      storyId: mockStoryId,
      title: 'Character Backstories',
      summary: null,
      lastMessageAt: Date.now(),
      created: Date.now() - 5000,
      updated: Date.now(),
      version: 1,
      deleted: false,
      deletedAt: null,
    },
  ]

  const mockMessages = [
    {
      id: mockMessageId,
      chatId: mockChatId,
      role: 'user',
      content: 'Tell me about dragons',
      reasoningContent: null,
      created: Date.now() - 2000,
      updated: Date.now() - 2000,
      version: 1,
      deleted: false,
      deletedAt: null,
      thinkingFinishTime: null,
      streamingFinishTime: null,
    },
    {
      id: 'msg_002',
      chatId: mockChatId,
      role: 'assistant',
      content: 'Dragons are mythical creatures...',
      reasoningContent: 'The user is asking about dragons in fantasy...',
      created: Date.now() - 1000,
      updated: Date.now() - 1000,
      version: 1,
      deleted: false,
      deletedAt: null,
      thinkingFinishTime: 1500,
      streamingFinishTime: 3000,
    },
  ]

  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances() // Clear singleton instances before each test

    // Setup mock store implementations
    chatsStore = {
      chats: new Map(mockChats.map(c => [c.id, c])),
      loadChatsForStory: vi.fn().mockResolvedValue(undefined),
      getChatsForStory: vi.fn().mockReturnValue(mockChats),
      createChat: vi.fn().mockImplementation((storyId, title) => ({
        id: `chat_${Date.now()}`,
        storyId,
        title: title || 'New Chat',
        summary: null,
        lastMessageAt: null,
        created: Date.now(),
        updated: Date.now(),
        version: 1,
        deleted: false,
        deletedAt: null,
      })),
      updateChat: vi.fn().mockImplementation((chatId, updates) => {
        const chat = mockChats.find(c => c.id === chatId)
        if (!chat) return null
        return {
          ...chat,
          ...updates,
          version: chat.version + 1,
          updated: Date.now(),
        }
      }),
      deleteChat: vi.fn().mockReturnValue(true),
    }

    messagesStore = {
      messages: new Map(mockMessages.map(m => [m.id, m])),
      loadMessagesForChat: vi.fn().mockResolvedValue(undefined),
      getMessagesForChat: vi.fn().mockImplementation(chatId => {
        if (chatId === mockChatId) return mockMessages
        if (chatId === 'chat_999') return []
        return []
      }),
      getMessageById: vi.fn().mockImplementation(messageId => {
        const message = mockMessages.find(m => m.id === messageId)
        return {
          value: message || null,
          // Make it look like a computed ref
          effect: undefined,
          __v_isRef: true,
          _value: message || null,
        }
      }),
      createMessage: vi.fn().mockImplementation((chatId, role, content, reasoningContent) => ({
        id: `msg_${Date.now()}`,
        chatId,
        role,
        content,
        reasoningContent: reasoningContent || null,
        created: Date.now(),
        updated: Date.now(),
        version: 1,
        deleted: false,
        deletedAt: null,
        thinkingFinishTime: null,
        streamingFinishTime: null,
      })),
      streamMessageContent: vi
        .fn()
        .mockImplementation((messageId, content, reasoningContent, timing) => {
          const message = mockMessages.find(m => m.id === messageId)
          if (!message) return null
          return {
            ...message,
            content,
            reasoningContent: reasoningContent || message.reasoningContent,
            thinkingFinishTime: timing?.thinkingFinishTime || message.thinkingFinishTime,
            streamingFinishTime: timing?.streamingFinishTime || message.streamingFinishTime,
            updated: Date.now(),
            version: message.version + 1,
          }
        }),
      updateMessage: vi.fn().mockImplementation((messageId, updates) => {
        const message = mockMessages.find(m => m.id === messageId)
        if (!message) return null
        return {
          ...message,
          ...updates,
          version: message.version + 1,
          updated: Date.now(),
        }
      }),
      deleteMessage: vi.fn().mockReturnValue(true),
      deleteMessagesForChat: vi.fn().mockReturnValue(true),
      duplicateMessage: vi.fn().mockImplementation((originalMessage, newChatId) => ({
        ...originalMessage,
        id: `msg_${Date.now()}_duplicated`,
        chatId: newChatId,
        version: 1,
        deleted: false,
        deletedAt: null,
      })),
    }

    // Mock the store functions
    useChatsStore.mockReturnValue(chatsStore)
    useMessagesStore.mockReturnValue(messagesStore)

    // Create composable instance
    composable = useChats(mockStoryId)
  })

  describe('singleton behavior', () => {
    it('should return the same instance for the same storyId', () => {
      const instance1 = useChats(mockStoryId)
      const instance2 = useChats(mockStoryId)
      expect(instance1).toBe(instance2)
    })

    it('should return different instances for different storyIds', () => {
      const instance1 = useChats('story_001')
      const instance2 = useChats('story_002')
      expect(instance1).not.toBe(instance2)
    })

    it('should clear instances when clearChatsInstances is called', () => {
      const instance1 = useChats(mockStoryId)
      clearChatsInstances()
      const instance2 = useChats(mockStoryId)
      expect(instance1).not.toBe(instance2)
    })
  })

  describe('initialization', () => {
    it('should load chats and messages on init', async () => {
      await composable.init()

      expect(chatsStore.loadChatsForStory).toHaveBeenCalledWith(mockStoryId)
      expect(messagesStore.loadMessagesForChat).toHaveBeenCalledWith(mockChatId)
      expect(messagesStore.loadMessagesForChat).toHaveBeenCalledWith('chat_999')
      expect(messagesStore.loadMessagesForChat).toHaveBeenCalledTimes(2)
    })

    it('should handle init being called multiple times (idempotent)', async () => {
      await composable.init()
      await composable.init()

      // Should only be called once
      expect(chatsStore.loadChatsForStory).toHaveBeenCalledTimes(1)
    })

    it('should handle init errors', async () => {
      const error = new Error('Database error')
      chatsStore.loadChatsForStory.mockRejectedValue(error)

      await expect(composable.init()).rejects.toThrow('Database error')
    })
  })

  describe('computed properties', () => {
    beforeEach(async () => {
      await composable.init()
    })

    it('should compute chats sorted by most recent activity', () => {
      const chats = composable.chats.value
      expect(chats).toHaveLength(2)
      // chat_999 has more recent lastMessageAt
      expect(chats[0].id).toBe('chat_999')
      expect(chats[1].id).toBe(mockChatId)
    })

    it('should compute chatMessages map correctly', () => {
      const chatMessages = composable.chatMessages.value
      expect(chatMessages).toBeInstanceOf(Map)
      expect(chatMessages.size).toBe(2)
      expect(chatMessages.get(mockChatId)).toEqual(mockMessages)
      expect(chatMessages.get('chat_999')).toEqual([])
    })

    it('should handle chats without lastMessageAt', () => {
      chatsStore.getChatsForStory.mockReturnValue([
        { ...mockChats[0], lastMessageAt: null },
        { ...mockChats[1], lastMessageAt: null },
      ])

      const chats = composable.chats.value
      // Should fall back to created timestamp
      expect(chats[0].id).toBe('chat_999') // More recent created time
    })
  })

  describe('chat actions', () => {
    beforeEach(async () => {
      await composable.init()
    })

    it('should create a chat with title', () => {
      const result = composable.createChat('New Discussion')

      expect(chatsStore.createChat).toHaveBeenCalledWith(mockStoryId, 'New Discussion', null, {
        profileId: 'builtin_profile_chat',
      })
      expect(result.title).toBe('New Discussion')
      expect(result.storyId).toBe(mockStoryId)
    })

    it('starts a chat on whichever profile the project was created with', () => {
      mockGetStory.mockReturnValueOnce({ options: { profileId: 'builtin_profile_roleplay' } })

      composable.createChat('A Session')

      expect(chatsStore.createChat).toHaveBeenCalledWith(
        mockStoryId,
        'A Session',
        null,
        expect.objectContaining({ profileId: 'builtin_profile_roleplay' })
      )
    })

    it("stamps a chat from the profile it is given, over the project's", () => {
      mockGetStory.mockReturnValueOnce({ options: { profileId: 'builtin_profile_chat' } })

      composable.createChat('A Scene', 'builtin_profile_roleplay')

      // What the profile menu does: the project's default is a default, and
      // naming one is how the writer says otherwise.
      expect(chatsStore.createChat).toHaveBeenCalledWith(
        mockStoryId,
        'A Scene',
        null,
        expect.objectContaining({ profileId: 'builtin_profile_roleplay' })
      )
    })

    it('leaves the prompt on the profile rather than stamping it', () => {
      composable.createChat('A Session')

      // Read every turn, so a chat follows its profile's wording.
      expect(chatsStore.createChat.mock.calls.at(-1)[3]).not.toHaveProperty('prompt')
    })

    it('knows which profile its chats start on', () => {
      expect(composable.defaultProfileId()).toBe('builtin_profile_chat')

      mockGetStory.mockReturnValueOnce({ options: { profileId: 'builtin_profile_roleplay' } })

      expect(composable.defaultProfileId()).toBe('builtin_profile_roleplay')
    })

    it('starts chats on the default when the project names a profile that is gone', () => {
      // Adventure was a built-in until it was retired, and a writer can delete
      // their own; a project still naming one starts its chats on the default.
      mockGetStory.mockReturnValueOnce({ options: { profileId: 'builtin_profile_adventure' } })

      expect(composable.defaultProfileId()).toBe('builtin_profile_chat')
    })

    it('stamps the profile a card chat asks for, over the project default', () => {
      mockGetStory.mockReturnValueOnce({ options: { profileId: 'builtin_profile_chat' } })

      composable.createChat('Seraphina', 'builtin_profile_roleplay')

      expect(chatsStore.createChat.mock.calls.at(-1)[3].profileId).toBe('builtin_profile_roleplay')
    })

    it('should create a chat without title', () => {
      const result = composable.createChat()

      expect(chatsStore.createChat).toHaveBeenCalledWith(mockStoryId, undefined, null, {
        profileId: 'builtin_profile_chat',
      })
      expect(result.title).toBe('New Chat')
    })

    it('should update a chat', () => {
      const updates = { title: 'Updated Title', summary: 'New summary' }
      const result = composable.updateChat(mockChatId, updates)

      expect(chatsStore.updateChat).toHaveBeenCalledWith(mockChatId, updates)
      expect(result.title).toBe('Updated Title')
      expect(result.summary).toBe('New summary')
      expect(result.version).toBe(2)
    })

    it('should delete a chat and its messages', () => {
      composable.deleteChat(mockChatId)

      expect(messagesStore.deleteMessagesForChat).toHaveBeenCalledWith(mockChatId)
      expect(chatsStore.deleteChat).toHaveBeenCalledWith(mockChatId)
      // Messages should be deleted before chat
      expect(messagesStore.deleteMessagesForChat).toHaveBeenCalledBefore(chatsStore.deleteChat)
    })

    it('should get chat by ID', () => {
      chatsStore.chats.get = vi.fn().mockImplementation(id => {
        if (id === mockChatId) return mockChats[0]
        if (id === 'chat_999') return mockChats[1]
        return undefined
      })

      const chat = composable.getChatById(mockChatId)
      expect(chat).toEqual(mockChats[0])
    })

    it('should return null for non-existent chat', () => {
      const chat = composable.getChatById('non_existent')
      expect(chat).toBeNull()
    })
  })

  describe('message actions', () => {
    beforeEach(async () => {
      await composable.init()
    })

    it('should add a user message', () => {
      const result = composable.addMessage(mockChatId, 'user', 'What about elves?')

      expect(messagesStore.createMessage).toHaveBeenCalledWith(
        mockChatId,
        'user',
        'What about elves?',
        null,
        null
      )
      expect(result.role).toBe('user')
      expect(result.content).toBe('What about elves?')
      expect(result.reasoningContent).toBeNull()
    })

    it('should add an assistant message with reasoning', () => {
      const result = composable.addMessage(
        mockChatId,
        'assistant',
        'Elves are immortal beings...',
        'The user wants to know about elves...'
      )

      expect(messagesStore.createMessage).toHaveBeenCalledWith(
        mockChatId,
        'assistant',
        'Elves are immortal beings...',
        'The user wants to know about elves...',
        null
      )
      expect(result.reasoningContent).toBe('The user wants to know about elves...')
    })

    it('should stream message content updates', () => {
      const timing = { thinkingFinishTime: 2000, streamingFinishTime: 4000 }
      const result = composable.streamMessageContent(
        mockMessageId,
        'Updated content...',
        'Updated reasoning...',
        timing
      )

      expect(messagesStore.streamMessageContent).toHaveBeenCalledWith(
        mockMessageId,
        'Updated content...',
        'Updated reasoning...',
        timing,
        undefined
      )
      expect(result.content).toBe('Updated content...')
      expect(result.reasoningContent).toBe('Updated reasoning...')
      expect(result.thinkingFinishTime).toBe(2000)
      expect(result.streamingFinishTime).toBe(4000)
    })

    it('should stream content without reasoning or timing', () => {
      const result = composable.streamMessageContent(mockMessageId, 'Just content')

      expect(messagesStore.streamMessageContent).toHaveBeenCalledWith(
        mockMessageId,
        'Just content',
        null,
        {},
        undefined
      )
      expect(result.content).toBe('Just content')
    })

    it('passes the calls in flight through to the store', () => {
      const pending = [{ id: 'call_1', name: 'edit_document', arguments: '{' }]
      composable.streamMessageContent(mockMessageId, 'x', null, {}, pending)

      expect(messagesStore.streamMessageContent).toHaveBeenCalledWith(
        mockMessageId,
        'x',
        null,
        {},
        pending
      )
    })

    it('should update a message', () => {
      const updates = { content: 'Edited content' }
      const result = composable.updateMessage(mockMessageId, updates)

      expect(messagesStore.updateMessage).toHaveBeenCalledWith(mockMessageId, updates)
      expect(result.content).toBe('Edited content')
      expect(result.version).toBe(2)
    })

    it('should delete a message', () => {
      const result = composable.deleteMessage(mockMessageId)

      expect(messagesStore.deleteMessage).toHaveBeenCalledWith(mockMessageId)
      expect(result).toBe(true)
    })

    it('should get messages for a chat', () => {
      const messagesRef = composable.getMessagesForChat(mockChatId)

      // getMessagesForChat now returns a computed ref
      // The store method is only called when we access .value
      expect(messagesRef.value).toEqual(mockMessages)
      expect(messagesStore.getMessagesForChat).toHaveBeenCalledWith(mockChatId)
    })

    it('should get message by ID', () => {
      const messageRef = composable.getMessageById(mockMessageId)
      // getMessageById returns a computed ref from messagesStore
      expect(messageRef.value).toEqual(mockMessages[0])
    })

    it('should return null for non-existent message', () => {
      const messageRef = composable.getMessageById('non_existent')
      expect(messageRef.value).toBeNull()
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle undefined storyId', () => {
      const instance = useChats(undefined)
      expect(instance).toBeDefined()
      expect(instance.init).toBeDefined()
    })

    it('should handle null storyId', () => {
      const instance = useChats(null)
      expect(instance).toBeDefined()
      expect(instance.init).toBeDefined()
    })

    it('should handle empty chat list', async () => {
      chatsStore.getChatsForStory.mockReturnValue([])
      // Create a fresh instance with empty chats
      clearChatsInstances()
      const emptyComposable = useChats(mockStoryId)
      await emptyComposable.init()

      expect(emptyComposable.chats.value).toEqual([])
      expect(emptyComposable.chatMessages.value.size).toBe(0)
      expect(messagesStore.loadMessagesForChat).not.toHaveBeenCalled()
    })

    it('should handle chat without messages', () => {
      messagesStore.getMessagesForChat.mockReturnValue([])
      const messagesRef = composable.getMessagesForChat('empty_chat')
      expect(messagesRef.value).toEqual([])
    })

    it('should handle updating non-existent chat', () => {
      const result = composable.updateChat('non_existent', { title: 'New' })
      expect(result).toBeNull()
    })

    it('should handle updating non-existent message', () => {
      const result = composable.updateMessage('non_existent', { content: 'New' })
      expect(result).toBeNull()
    })

    it('should handle streaming to non-existent message', () => {
      const result = composable.streamMessageContent('non_existent', 'Content')
      expect(result).toBeNull()
    })
  })

  describe('draft message management', () => {
    beforeEach(async () => {
      await composable.init()
    })

    it('should get empty string for chat with no draft', () => {
      const draft = composable.getDraftMessage(mockChatId)
      expect(draft).toBe('')
    })

    it('should set and get draft message', () => {
      composable.setDraftMessage(mockChatId, 'Draft message content')
      const draft = composable.getDraftMessage(mockChatId)
      expect(draft).toBe('Draft message content')
    })

    it('should update existing draft message', () => {
      composable.setDraftMessage(mockChatId, 'First draft')
      composable.setDraftMessage(mockChatId, 'Updated draft')
      const draft = composable.getDraftMessage(mockChatId)
      expect(draft).toBe('Updated draft')
    })

    it('should clear draft message', () => {
      composable.setDraftMessage(mockChatId, 'Draft to clear')
      composable.clearDraftMessage(mockChatId)
      const draft = composable.getDraftMessage(mockChatId)
      expect(draft).toBe('')
    })

    it('should delete draft when setting empty string', () => {
      composable.setDraftMessage(mockChatId, 'Draft content')
      composable.setDraftMessage(mockChatId, '')
      const draft = composable.getDraftMessage(mockChatId)
      expect(draft).toBe('')
    })

    it('should maintain separate drafts for different chats', () => {
      const chatId1 = 'chat_001'
      const chatId2 = 'chat_002'

      composable.setDraftMessage(chatId1, 'Draft for chat 1')
      composable.setDraftMessage(chatId2, 'Draft for chat 2')

      expect(composable.getDraftMessage(chatId1)).toBe('Draft for chat 1')
      expect(composable.getDraftMessage(chatId2)).toBe('Draft for chat 2')
    })

    it('should persist drafts across operations', () => {
      composable.setDraftMessage(mockChatId, 'Persistent draft')

      // Perform other operations
      composable.addMessage(mockChatId, 'user', 'Some message')
      composable.updateChat(mockChatId, { title: 'Updated' })

      // Draft should still be there
      const draft = composable.getDraftMessage(mockChatId)
      expect(draft).toBe('Persistent draft')
    })
  })

  describe('importChat', () => {
    const exported = {
      id: 'chat_from_file',
      storyId: 'story_elsewhere',
      title: 'Plot holes',
      description: 'Act two',
      promptId: 'prompt_editor',
      disabledTools: ['oracle'],
      deleted: false,
    }
    const rows = [
      {
        id: 'message_from_file_1',
        chatId: 'chat_from_file',
        role: 'user',
        content: 'Hi',
        created: 5,
      },
      {
        id: 'message_from_file_2',
        chatId: 'chat_from_file',
        role: 'assistant',
        content: 'Hello',
        created: 6,
      },
    ]

    const editor = { id: 'prompt_editor', name: 'Editor', content: 'Be terse.' }

    beforeEach(() => {
      mockGetProfile.mockReset().mockReturnValue(null)
      mockSaveProfile.mockReset().mockReturnValue({ id: 'chatprofile_saved_here' })
    })

    it('creates the chat here, with the settings it was exported with', () => {
      const imported = composable.importChat(exported, rows)

      expect(chatsStore.createChat).toHaveBeenCalledWith(
        mockStoryId,
        'Plot holes',
        null,
        expect.objectContaining({
          profileId: 'prompt_editor',
          disabledTools: ['oracle'],
        })
      )
      expect(chatsStore.updateChat).toHaveBeenCalledWith(imported.id, { description: 'Act two' })
      expect(imported.storyId).toBe(mockStoryId)
      // The file's ids stay in the file.
      expect(imported.id).not.toBe(exported.id)
    })

    it('makes a profile of the prompt the file carries when there is no such profile', () => {
      composable.importChat(exported, rows, editor)

      // Saved from the file's copy, and the chat runs on the saved one.
      expect(mockSaveProfile).toHaveBeenCalledWith('Editor', { prompt: 'Be terse.' })
      expect(chatsStore.createChat.mock.calls.at(-1)[3].profileId).toBe('chatprofile_saved_here')
    })

    it('runs the chat on the profile already here over the copy in the file', () => {
      mockGetProfile.mockReturnValue({ id: 'prompt_editor', name: 'Editor', settings: {} })

      composable.importChat(exported, rows, { ...editor, content: 'An older wording.' })

      // The library is what the writer has been editing; the file may be stale.
      expect(mockSaveProfile).not.toHaveBeenCalled()
      expect(chatsStore.createChat.mock.calls.at(-1)[3].profileId).toBe('prompt_editor')
    })

    it('keeps the profile id as it is when the file carries no prompt', () => {
      composable.importChat(exported, rows)

      expect(mockSaveProfile).not.toHaveBeenCalled()
      expect(chatsStore.createChat.mock.calls.at(-1)[3].profileId).toBe('prompt_editor')
    })

    it('copies every message under the new chat, in order', () => {
      const imported = composable.importChat(exported, rows)

      expect(messagesStore.duplicateMessage).toHaveBeenCalledTimes(2)
      expect(messagesStore.duplicateMessage).toHaveBeenNthCalledWith(1, rows[0], imported.id)
      expect(messagesStore.duplicateMessage).toHaveBeenNthCalledWith(2, rows[1], imported.id)
      expect(chatsStore.updateChat).toHaveBeenCalledWith(imported.id, {
        lastMessageAt: 6,
        messageCount: 2,
      })
    })

    it('brings an empty chat across as an empty chat', () => {
      composable.importChat(exported, [])

      expect(messagesStore.duplicateMessage).not.toHaveBeenCalled()
      expect(chatsStore.updateChat).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ messageCount: expect.anything() })
      )
    })
  })

  describe('forkChat', () => {
    beforeEach(async () => {
      await composable.init()
      // Chats are already in the map from the main beforeEach
      // mockChatId should point to mockChats[0]
    })

    it('should create a forked chat with correct name', () => {
      const forkedChat = composable.forkChat(mockChatId, mockMessageId)

      expect(chatsStore.createChat).toHaveBeenCalledWith(
        mockStoryId,
        'World Building Discussion - forked',
        null,
        {
          profileId: null,
          disabledTools: [],
          disabledToolGroups: [],
          projectContextEnabled: true,
        }
      )
      expect(forkedChat.title).toContain('- forked')
    })

    it('should carry its settings over from the source chat', () => {
      chatsStore.chats.set(mockChatId, {
        ...chatsStore.chats.get(mockChatId),
        profileId: 'chatprofile_editor',
        disabledTools: ['oracle'],
        disabledToolGroups: ['lore'],
        projectContextEnabled: false,
        pinnedIds: ['doc_description', 'doc_scenario'],
        shownIds: ['doc_vivi'],
        hiddenIds: ['doc_characters'],
        voiceId: 'voice_narrator',
        userVoiceId: 'voice_writer',
      })

      composable.forkChat(mockChatId, mockMessageId)

      // A fork continues the conversation, so it keeps the profile it ran under
      // rather than resetting to the built-in a new chat would get. The pins
      // come with it: on a character card they are the character, and what it
      // shows and hides is who else is not in the scene.
      expect(chatsStore.createChat.mock.calls.at(-1)[3]).toEqual({
        profileId: 'chatprofile_editor',
        disabledTools: ['oracle'],
        disabledToolGroups: ['lore'],
        projectContextEnabled: false,
        pinnedIds: ['doc_description', 'doc_scenario'],
        shownIds: ['doc_vivi'],
        hiddenIds: ['doc_characters'],
        voiceId: 'voice_narrator',
        userVoiceId: 'voice_writer',
      })
    })

    it('should give the fork pins of its own to edit', () => {
      const pinnedIds = ['doc_description']
      chatsStore.chats.set(mockChatId, {
        ...chatsStore.chats.get(mockChatId),
        pinnedIds,
      })

      composable.forkChat(mockChatId, mockMessageId)

      // Unpinning in the fork must not reach back into the chat it came from.
      const carried = chatsStore.createChat.mock.calls.at(-1)[3].pinnedIds
      expect(carried).toEqual(pinnedIds)
      expect(carried).not.toBe(pinnedIds)
    })

    it('should leave a fork of an unpinned chat unpinned', () => {
      composable.forkChat(mockChatId, mockMessageId)

      expect(chatsStore.createChat.mock.calls.at(-1)[3]).not.toHaveProperty('pinnedIds')
    })

    it('should copy description from original chat', () => {
      composable.forkChat(mockChatId, mockMessageId)

      const updateCalls = chatsStore.updateChat.mock.calls
      const metadataCall = updateCalls.find(call => call[1].description !== undefined)

      expect(metadataCall).toBeDefined()
      expect(metadataCall[1].description).toBe('Discussion about the fantasy world')
    })

    it('should copy messages up to and including the selected message', () => {
      composable.forkChat(mockChatId, mockMessageId)

      // Should duplicate the first message only (mockMessageId is the first one)
      expect(messagesStore.duplicateMessage).toHaveBeenCalledTimes(1)
      expect(messagesStore.duplicateMessage).toHaveBeenCalledWith(
        mockMessages[0],
        expect.any(String)
      )
    })

    it('should copy all messages when forking at the last message', () => {
      const lastMessageId = 'msg_002'
      composable.forkChat(mockChatId, lastMessageId)

      // Should duplicate both messages
      expect(messagesStore.duplicateMessage).toHaveBeenCalledTimes(2)
      expect(messagesStore.duplicateMessage).toHaveBeenCalledWith(
        mockMessages[0],
        expect.any(String)
      )
      expect(messagesStore.duplicateMessage).toHaveBeenCalledWith(
        mockMessages[1],
        expect.any(String)
      )
    })

    it('should update lastMessageAt on the forked chat', () => {
      composable.forkChat(mockChatId, mockMessageId)

      expect(chatsStore.updateChat).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          lastMessageAt: mockMessages[0].created,
          messageCount: 1,
        })
      )
    })

    it('should preserve message timestamps when forking', () => {
      composable.forkChat(mockChatId, mockMessageId)

      const duplicateCall = messagesStore.duplicateMessage.mock.calls[0]
      const originalMessage = duplicateCall[0]

      // The duplicateMessage function should be called with the original message
      expect(originalMessage.created).toBe(mockMessages[0].created)
      expect(originalMessage.updated).toBe(mockMessages[0].updated)
    })

    it('should throw error when original chat not found', () => {
      chatsStore.chats = new Map() // Empty map

      expect(() => composable.forkChat('non_existent', mockMessageId)).toThrow(
        "Cannot fork chat 'non_existent': chat not found"
      )
    })

    it('should throw error when message not found in chat', () => {
      expect(() => composable.forkChat(mockChatId, 'non_existent_msg')).toThrow(
        "Message 'non_existent_msg' not found in chat"
      )
    })

    it('should handle forking chat without description', () => {
      const chatWithoutDescription = {
        ...mockChats[0],
        description: undefined,
      }
      chatsStore.chats = new Map([[mockChatId, chatWithoutDescription]])

      const forkedChat = composable.forkChat(mockChatId, mockMessageId)

      expect(forkedChat).toBeDefined()
      expect(chatsStore.updateChat).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          lastMessageAt: expect.any(Number),
          messageCount: 1,
        })
      )
    })

    it('should return the forked chat', () => {
      const forkedChat = composable.forkChat(mockChatId, mockMessageId)

      expect(forkedChat).toBeDefined()
      expect(forkedChat.id).toBeDefined()
      expect(forkedChat.title).toContain('- forked')
      expect(forkedChat.storyId).toBe(mockStoryId)
    })

    it('should handle forking from first message in chat', () => {
      composable.forkChat(mockChatId, mockMessageId)

      expect(messagesStore.duplicateMessage).toHaveBeenCalledTimes(1)
      expect(messagesStore.duplicateMessage).toHaveBeenCalledWith(
        mockMessages[0],
        expect.any(String)
      )
    })

    it('should set correct message count on forked chat', () => {
      composable.forkChat(mockChatId, 'msg_002') // Fork at second message

      expect(chatsStore.updateChat).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          messageCount: 2,
        })
      )
    })
  })
})
