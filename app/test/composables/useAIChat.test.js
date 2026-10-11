import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIChat } from '@/composables/useAIChat'
import { TITLE_DEFAULTS } from '@/ai/defaults.js'
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  DEFAULT_ROLEPLAY_NOTE,
  DEFAULT_ROLEPLAY_NSFW_NOTE,
} from '@/ai/prompts/index.js'
import { SKILL_MAX_ROUNDS } from '@/ai/skills/index.js'
import { setWebSearch } from '@/web/config.js'

// Mock stores
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: vi.fn(),
}))

vi.mock('@/stores/scenesStore', () => ({
  useScenesStore: vi.fn(),
}))

vi.mock('@/stores/aiProvidersStore', () => ({
  useAIProvidersStore: vi.fn(),
}))

vi.mock('@/stores/aiParameterPresetStore', () => ({
  useAIParameterPresetStore: vi.fn(),
}))

vi.mock('@/stores/aiPresetStore', () => ({
  useAIPresetStore: vi.fn(),
}))

// Mock composables
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: vi.fn(),
  defaultContextOptionsChat: {
    includeLorebook: true,
    includeOverview: true,
    includeStructure: false,
    includePartContext: true,
  },
}))

vi.mock('@/composables/useAIService', () => ({
  useAIService: vi.fn(),
}))

vi.mock('@/composables/useAIContext', () => ({
  useAIContext: vi.fn(),
}))

vi.mock('@/composables/useChats', () => ({
  useChats: vi.fn(),
}))

/** The mocked profile library: built-ins from source, saved ones by id. */
const { mockSavedProfiles, mockProfilesReady } = vi.hoisted(() => ({
  mockSavedProfiles: new Map(),
  mockProfilesReady: vi.fn(async () => {}),
}))

vi.mock('@/composables/useProfiles', async () => {
  const { getBuiltInProfile } = await import('@/ai/profiles/index.js')
  return {
    useProfiles: () => ({
      ready: mockProfilesReady,
      getProfile: id => {
        const builtIn = getBuiltInProfile(id)
        if (builtIn) return { ...builtIn, readOnly: true }
        return mockSavedProfiles.get(id) || null
      },
    }),
  }
})

const debug = { value: false }
const applyEdits = { value: 'auto' }
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ debug, applyEdits }),
}))

const mockDocuments = vi.hoisted(() => ({
  revertEdit: vi.fn(() => true),
  reapplyEdit: vi.fn(async () => true),
}))
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => mockDocuments }))

const mockApplyProposal = vi.hoisted(() => vi.fn())
vi.mock('@/ai/tools/documents.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  applyProposal: mockApplyProposal,
}))

vi.mock('@/ai/tools/index.js', () => ({
  getEnabledToolDefinitions: vi.fn().mockReturnValue([]),
  getToolDefinitionsFor: vi.fn().mockReturnValue([]),
  getToolTimeout: vi.fn(),
  executeTool: vi.fn(),
  hasTools: vi.fn().mockReturnValue(false),
  isSkill: vi.fn(name => name === 'director' || name === 'scene'),
  // A tool of the connected server's, in the approval tests.
  // A skill of the writer's that answers as the reply.
  handsOverReply: vi.fn(name => name === 'scene'),
}))

const mockAllowTool = vi.hoisted(() => vi.fn())
const mockAllowServer = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useMcpServers.js', () => ({
  useMcpServers: () => ({
    ready: async () => {},
    allowTool: mockAllowTool,
    allowServer: mockAllowServer,
  }),
}))
vi.mock('@/composables/useWebSearch.js', () => ({
  useWebSearch: () => ({ ready: async () => {} }),
}))

describe('useAIChat', () => {
  let mockAIConfig
  let mockAIService
  let mockAIContext
  let mockChatsApi
  let mockStoriesStore

  const mockStoryId = 'story_123'
  const mockChatId = 'chat_789'

  const mockProfile = {
    id: 'profile_1',
    name: 'Test Chat Profile',
    providerId: 'provider_1',
    model: 'gpt-4',
    completionType: 'chat',
    contextOptions: {
      includeLorebook: true,
      includeOverview: true,
      includeStructure: false,
      includePartContext: true,
    },
  }

  const mockProvider = {
    id: 'provider_1',
    name: 'Test Provider',
    type: 'openrouter',
    apiKey: 'test-api-key',
  }

  const mockChat = {
    id: mockChatId,
    storyId: mockStoryId,
    title: 'Test Chat',
    contextOptions: null,
  }

  beforeEach(async () => {
    // Set up Pinia
    setActivePinia(createPinia())
    vi.clearAllMocks()
    debug.value = false

    // Setup mock AI config
    mockAIConfig = {
      activeAIPreset: { value: mockProfile },
      getProvider: vi.fn().mockReturnValue(mockProvider),
    }

    // Setup mock AI service
    mockAIService = {
      generateChatCompletion: vi.fn(),
      generateTextCompletion: vi.fn(),
    }

    // Setup mock AI context
    const mockContextBuilder = {
      build: vi.fn().mockResolvedValue({
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'User message' },
        ],
        completionType: 'chat',
      }),
    }
    mockAIContext = vi.fn().mockReturnValue(mockContextBuilder)

    // Setup mock chats API
    mockSavedProfiles.clear()
    mockChatsApi = {
      getChatById: vi.fn().mockReturnValue(mockChat),
      defaultProfileId: vi.fn(() => 'builtin_profile_chat'),
      updateChat: vi.fn(),
      addMessage: vi.fn(),
      updateMessage: vi.fn(),
      beginAlternate: vi.fn(),
      selectAlternate: vi.fn(),
      getMessageById: vi.fn(),
      streamMessageContent: vi.fn(),
      writeTurn: vi.fn(),
      getMessagesForChat: vi.fn().mockReturnValue({ value: [] }),
      truncateMessagesForChat: vi.fn(),
    }

    // Setup mock stories store
    mockStoriesStore = {
      getStory: vi.fn().mockReturnValue({
        id: mockStoryId,
        title: 'Test Story',
        options: {},
      }),
    }

    // Apply mocks
    const { useAIConfig } = await import('@/composables/useAIConfig')
    const { useAIService } = await import('@/composables/useAIService')
    const { useAIContext } = await import('@/composables/useAIContext')
    const { useChats } = await import('@/composables/useChats')
    const { useStoriesStore } = await import('@/stores/storiesStore')

    useAIConfig.mockReturnValue(mockAIConfig)
    useAIService.mockReturnValue(mockAIService)
    useAIContext.mockImplementation(mockAIContext)
    useChats.mockReturnValue(mockChatsApi)
    useStoriesStore.mockReturnValue(mockStoriesStore)
  })

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      expect(composable.isGenerating.value).toBe(false)
      expect(composable.isThinking.value).toBe(false)
    })
  })

  describe('AI configuration validation', () => {
    it('should throw error when no profile is configured', async () => {
      mockAIConfig.activeAIPreset.value = null
      const composable = useAIChat(mockStoryId, mockChatId)

      // Mock addMessage to return a user message so validation happens
      mockChatsApi.addMessage.mockReturnValue({
        id: 'msg_user',
        role: 'user',
        content: 'Hello',
      })
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })

      await expect(composable.sendMessage('Hello')).rejects.toThrow(
        'Set up a provider to use chat.'
      )
    })

    it('should throw error when provider is not found', async () => {
      mockAIConfig.getProvider.mockReturnValue(null)
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.addMessage.mockReturnValue({
        id: 'msg_user',
        role: 'user',
        content: 'Hello',
      })
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })

      await expect(composable.sendMessage('Hello')).rejects.toThrow(
        'Set up a provider to use chat.'
      )
    })

    it('should throw error when model is not selected', async () => {
      mockAIConfig.activeAIPreset.value = { ...mockProfile, model: null }
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.addMessage.mockReturnValue({
        id: 'msg_user',
        role: 'user',
        content: 'Hello',
      })
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })

      await expect(composable.sendMessage('Hello')).rejects.toThrow(
        'Select a model for chat in the settings menu.'
      )
    })

    it('should throw error when OpenRouter API key is missing', async () => {
      mockAIConfig.getProvider.mockReturnValue({ ...mockProvider, apiKey: null })
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.addMessage.mockReturnValue({
        id: 'msg_user',
        role: 'user',
        content: 'Hello',
      })
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })

      await expect(composable.sendMessage('Hello')).rejects.toThrow(
        'Enter your OpenRouter API key to use chat.'
      )
    })

    it('should throw error when a self-hosted provider has no endpoint', async () => {
      mockAIConfig.getProvider.mockReturnValue({
        ...mockProvider,
        type: 'generic',
        endpoint: null,
      })
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.addMessage.mockReturnValue({
        id: 'msg_user',
        role: 'user',
        content: 'Hello',
      })
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })

      await expect(composable.sendMessage('Hello')).rejects.toThrow(
        'Enter the endpoint for this connection in the settings menu.'
      )
    })
  })

  describe('configurationError', () => {
    it('is null when there is a provider to send to', () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      expect(composable.configurationError.value).toBeNull()
    })

    it('names what a send would fail with, before one is tried', () => {
      mockAIConfig.getProvider.mockReturnValue({ ...mockProvider, apiKey: null })
      const composable = useAIChat(mockStoryId, mockChatId)

      const error = composable.configurationError.value
      expect(error?.name).toBe('ProviderNotConfiguredError')
      expect(error?.message).toBe('Enter your OpenRouter API key to use chat.')
      expect(mockChatsApi.addMessage).not.toHaveBeenCalled()
    })

    it('reports a missing model as a plain error', () => {
      mockAIConfig.activeAIPreset.value = { ...mockProfile, model: null }
      const composable = useAIChat(mockStoryId, mockChatId)

      const error = composable.configurationError.value
      expect(error?.name).toBe('Error')
      expect(error?.message).toBe('Select a model for chat in the settings menu.')
    })
  })

  describe('sendMessage', () => {
    it('asks for no turn when the writer only settled something', async () => {
      // Rolling the oracle twice is not asking to be answered. The writer says
      // when they are ready, by saying something.
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage.mockReturnValue({ id: 'msg_command', role: 'user' })

      const answered = await composable.sendMessage(
        '/oracle(likely) Is the door locked?\n/oracle(unlikely) Can they pick it?'
      )

      expect(answered).toBeNull()
      expect(mockAIService.generateChatCompletion).not.toHaveBeenCalled()
      // Two questions, one turn.
      expect(mockChatsApi.addMessage).toHaveBeenCalledTimes(1)
      expect(composable.isGenerating.value).toBe(false)
    })

    it('answers a submission that says anything at all, commands and all', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })
      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'The handle does not move.' })
        return {}
      })

      await composable.sendMessage('I try the handle.\n/oracle(likely) Is it locked?')

      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(1)
      // One turn, in the order it was written, so the roll follows the action.
      expect(mockChatsApi.addMessage.mock.calls[0][2]).toMatch(
        /^I try the handle\.\n\n<oracle likelihood="likely">\nIs it locked\?\n/
      )
    })

    it('should send a message and generate AI response', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      const userMsg = { id: 'msg_user', chatId: mockChatId, role: 'user', content: 'Hello AI' }
      const assistantMsg = {
        id: 'msg_assistant',
        chatId: mockChatId,
        role: 'assistant',
        content: '',
      }

      mockChatsApi.addMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg)

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: 'Hello ' })
          callback({ content: 'human!' })
          return { usage: { promptTokens: 10, completionTokens: 5 } }
        }
      )

      const result = await composable.sendMessage('Hello AI')

      expect(mockChatsApi.addMessage).toHaveBeenCalledWith(mockChatId, 'user', 'Hello AI', null, [
        { type: 'text', content: 'Hello AI' },
      ])
      expect(mockChatsApi.addMessage).toHaveBeenCalledWith(mockChatId, 'assistant', '', null)
      expect(result).toEqual(assistantMsg)
      expect(composable.isGenerating.value).toBe(false)
    })

    it('should generate title for first message', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user', content: 'Help me write' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (messages, profile, callback) => {
          // Title generation
          callback({ content: 'Writing Help' })
          return {}
        })
        .mockImplementationOnce(async (messages, profile, callback) => {
          // Response generation
          callback({ content: 'I can help!' })
          return {}
        })

      await composable.sendMessage('Help me write')

      expect(mockChatsApi.updateChat).toHaveBeenCalledWith(mockChatId, {
        title: 'Writing Help',
      })
    })

    it('shows the calls the model is writing, and takes them down when the turn ends', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user', content: 'Question' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })

      const pending = [{ id: 'call_1', name: 'edit_document', arguments: '{"path":"a' }]
      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: '', reasoning: null, toolCalls: pending })
          callback({ content: 'Done.' })
          return {}
        }
      )

      await composable.sendMessage('Question')

      const calls = mockChatsApi.streamMessageContent.mock.calls.filter(
        call => call[0] === 'msg_assistant'
      )
      expect(calls.some(call => call[4] === pending)).toBe(true)
      expect(calls.at(-1)[4]).toEqual([])
      expect(composable.isThinking.value).toBe(false)
    })

    it('should handle reasoning content', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user', content: 'Question' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ reasoning: 'Thinking about ' })
          callback({ reasoning: 'the question...' })
          callback({ content: 'Here is ' })
          callback({ content: 'my answer' })
          return {}
        }
      )

      await composable.sendMessage('Question')

      expect(composable.isThinking.value).toBe(false)
      expect(mockChatsApi.streamMessageContent).toHaveBeenCalled()
    })

    it('should throw error when already generating', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      composable.isGenerating.value = true

      await expect(composable.sendMessage('Hello')).rejects.toThrow(
        "Can't start a new generation while one is in progress."
      )
    })

    it('should throw error when user message creation fails', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.addMessage.mockReturnValueOnce(null)

      await expect(composable.sendMessage('Hello')).rejects.toThrow('Failed to add user message')
    })

    it('should throw error when assistant message creation fails', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user', content: 'Hello' })
        .mockReturnValueOnce(null)

      await expect(composable.sendMessage('Hello')).rejects.toThrow(
        'Failed to create assistant message'
      )
    })
  })

  describe('insertMessage', () => {
    it("writes the writer's turn and asks for nothing back", async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage.mockReturnValue({ id: 'msg_user', role: 'user' })

      await composable.insertMessage('The road climbs for another hour.')

      expect(mockChatsApi.addMessage).toHaveBeenCalledWith(
        mockChatId,
        'user',
        'The road climbs for another hour.',
        null,
        [{ type: 'text', content: 'The road climbs for another hour.' }]
      )
      expect(mockAIService.generateChatCompletion).not.toHaveBeenCalled()
      expect(composable.isGenerating.value).toBe(false)
    })

    it('writes more under a turn pushed in without a reply into that turn', async () => {
      // Three oracles and then a sentence is one turn however many times the
      // box was emptied into it, and reaches the model as one.
      const composable = useAIChat(mockStoryId, mockChatId)
      const pushed = {
        id: 'msg_user',
        role: 'user',
        segments: [{ type: 'text', content: 'The road climbs.' }],
      }
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [pushed] })

      const written = await composable.insertMessage('Snow on it.')

      expect(mockChatsApi.addMessage).not.toHaveBeenCalled()
      expect(mockChatsApi.writeTurn).toHaveBeenCalledWith(
        'msg_user',
        [pushed.segments[0], { type: 'text', content: 'Snow on it.' }],
        'The road climbs.\n\nSnow on it.'
      )
      expect(written).toBe(pushed)
    })

    it('answers a turn taken as somebody, since somebody taking one is a turn', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_cody', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })
      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'The closet smells of cedar.' })
        return {}
      })

      await composable.sendMessage('@cody I quickly hide in the closet.')

      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(1)
    })

    it('runs the commands in a pushed turn, since it is the same submission', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage.mockReturnValue({ id: 'msg_command', role: 'user' })

      await composable.insertMessage('/oracle(likely) Is the door locked?')

      expect(mockChatsApi.addMessage.mock.calls[0][2]).toMatch(
        /^<oracle likelihood="likely">\nIs the door locked\?\n(yes|no|exceptional (yes|no))\n<\/oracle>$/
      )
      expect(mockAIService.generateChatCompletion).not.toHaveBeenCalled()
    })

    it('writes the assistant voice verbatim, slashes and all', async () => {
      // Nothing is parsed out of narration. A line that opens with a slash is
      // a line that opens with a slash, and the Game Master never ran a tool
      // the writer typed on their behalf.
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage.mockReturnValue({ id: 'msg_pushed', role: 'assistant' })

      const written = await composable.insertMessage(
        '/oracle Is the door locked?\nThe innkeeper looks up.',
        'assistant'
      )

      expect(mockChatsApi.addMessage).toHaveBeenCalledTimes(1)
      expect(mockChatsApi.addMessage).toHaveBeenCalledWith(
        mockChatId,
        'assistant',
        '/oracle Is the door locked?\nThe innkeeper looks up.'
      )
      expect(written).toEqual({ id: 'msg_pushed', role: 'assistant' })
    })

    it('names no chat it was the first message of', async () => {
      // Pushing is the one thing here that promises not to call a model, and
      // titling costs a round trip. The chat keeps its name until a real send.
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [] })
      mockChatsApi.addMessage.mockReturnValue({ id: 'msg_user', role: 'user' })

      await composable.insertMessage('Snow, and the road under it.')

      expect(mockAIService.generateChatCompletion).not.toHaveBeenCalled()
      expect(mockChatsApi.updateChat).not.toHaveBeenCalled()
    })

    it('writes nothing when there is nothing in the box', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      expect(await composable.insertMessage('   ')).toBeNull()
      expect(mockChatsApi.addMessage).not.toHaveBeenCalled()
    })

    it('refuses while a turn is being generated', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      composable.isGenerating.value = true

      await expect(composable.insertMessage('later', 'assistant')).rejects.toThrow(
        "Can't add a message while a generation is in progress."
      )
      expect(mockChatsApi.addMessage).not.toHaveBeenCalled()
    })
  })

  describe('words before a round that loads a skill', () => {
    /** A turn that says something and calls `name`, then writes the scene. */
    const turnCalling = async name => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([{ type: 'function', function: { name } }])
      tools.executeTool.mockImplementation(async call => ({
        tool_call_id: call.id,
        content: '{"name":"house-style","instructions":"Present tense."}',
      }))
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Let me load the house style first.' })
          return {
            toolCalls: [
              {
                id: 'c1',
                type: 'function',
                function: { name, arguments: '{"name":"house-style"}' },
              },
            ],
          }
        })
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'The door is open.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })
      try {
        await composable.sendMessage('Write the scene.')
      } finally {
        tools.hasTools.mockReturnValue(false)
        tools.getEnabledToolDefinitions.mockReturnValue([])
        tools.executeTool.mockReset()
      }
      const [, content, reasoning] = mockChatsApi.streamMessageContent.mock.calls.at(-1)
      return { content, reasoning }
    }

    it('puts them with the thinking, where a hand-off puts them', async () => {
      const { content, reasoning } = await turnCalling('use_skill')

      expect(content).toBe('The door is open.')
      expect(reasoning).toContain('Let me load the house style first.')
    })

    it('leaves them in the reply before a read, where they can be half of an answer', async () => {
      const { content } = await turnCalling('read_document')

      expect(content).toBe('Let me load the house style first.\n\nThe door is open.')
    })
  })

  describe('how many rounds a turn may make', () => {
    const call = (id, args = '{}') => ({
      id,
      type: 'function',
      function: { name: 'roll_dice', arguments: args },
    })

    /**
     * Run a turn whose model calls a tool in every round it is not told to
     * stop, with these settings, and these answers from the tool. Hands back
     * the requests the service saw.
     */
    const runTurn = async ({ overrides, args = n => `{"n":${n}}`, answer = n => `"${n}"` }) => {
      mockAIConfig.activeAIPreset.value = { ...mockProfile, generationOverrides: overrides }
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'roll_dice' } },
      ])
      let answered = 0
      tools.executeTool.mockImplementation(async toolCall => ({
        tool_call_id: toolCall.id,
        content: answer(++answered),
      }))

      let round = 0
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback, options) => {
        round++
        if (options.toolChoice === 'none') {
          callback({ content: 'I rolled a lot; nothing is left.' })
          return {}
        }
        return { toolCalls: [call(`c${round}`, args(round))] }
      })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      try {
        await composable.sendMessage('Roll for everyone.')
      } finally {
        tools.hasTools.mockReturnValue(false)
        tools.getEnabledToolDefinitions.mockReturnValue([])
        tools.executeTool.mockReset()
        mockAIConfig.activeAIPreset.value = mockProfile
      }

      const [, content] = mockChatsApi.streamMessageContent.mock.calls.at(-1)
      return { requests: mockAIService.generateChatCompletion.mock.calls, content }
    }

    it('asks once more without tools after the rounds the preset allows, and ends on that', async () => {
      const { requests, content } = await runTurn({ overrides: { maxToolRounds: 2 } })

      expect(requests).toHaveLength(3)
      expect(requests[1][3].toolChoice).toBeUndefined()
      expect(requests[2][3].toolChoice).toBe('none')
      // Still declared: the conversation has called them.
      expect(requests[2][3].tools).toHaveLength(1)
      expect(requests[2][0].at(-1)).toEqual({
        role: 'user',
        content: expect.stringContaining('made its 2 rounds of tool calls'),
      })
      expect(content).toBe('I rolled a lot; nothing is left.')
    })

    it('allows a hundred rounds when nothing has said otherwise', async () => {
      const { requests } = await runTurn({})

      expect(requests).toHaveLength(101)
      expect(requests[100][3].toolChoice).toBe('none')
    })

    it('stops a turn that keeps making the same calls and getting the same answers', async () => {
      const { requests } = await runTurn({
        overrides: { maxToolRounds: 0 },
        args: () => '{"dice":"1d20"}',
        answer: () => '{"error":"No such table."}',
      })

      // Three rounds the same, then the one that answers.
      expect(requests).toHaveLength(4)
      expect(requests[3][3].toolChoice).toBe('none')
      expect(requests[3][0].at(-1).content).toMatch(/same answers three rounds running/)
    })

    it('does not take three rolls of the same die for going round', async () => {
      const { requests } = await runTurn({
        overrides: { maxToolRounds: 5 },
        args: () => '{"dice":"1d20"}',
      })

      expect(requests).toHaveLength(6)
      expect(requests[5][0].at(-1).content).toMatch(/made its 5 rounds/)
    })

    it('runs nothing a model calls after being told to answer, and says it stopped', async () => {
      mockAIConfig.activeAIPreset.value = {
        ...mockProfile,
        generationOverrides: { maxToolRounds: 1 },
      }
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'roll_dice' } },
      ])
      tools.executeTool.mockResolvedValue({ tool_call_id: 'c1', content: '"4"' })
      mockAIService.generateChatCompletion.mockResolvedValue({ toolCalls: [call('c1')] })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })
      try {
        await composable.sendMessage('Roll.')
      } finally {
        tools.hasTools.mockReturnValue(false)
        tools.getEnabledToolDefinitions.mockReturnValue([])
        mockAIConfig.activeAIPreset.value = mockProfile
      }

      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(2)
      expect(tools.executeTool).toHaveBeenCalledTimes(1)
      tools.executeTool.mockReset()
      const [, content] = mockChatsApi.streamMessageContent.mock.calls.at(-1)
      expect(content).toContain('*[Stopped after 1 rounds of tool calls]*')
    })
  })

  describe('tool selection', () => {
    /** Drive one generation and return the tool definitions the service saw. */
    const captureTools = async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return {}
      })

      await composable.sendMessage('Hello')

      return mockAIService.generateChatCompletion.mock.calls[0][3].tools
    }

    beforeEach(async () => {
      const { hasTools, getEnabledToolDefinitions } = await import('@/ai/tools/index.js')
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'roll_dice' } },
      ])
    })

    it('offers whatever the registry says is enabled', async () => {
      expect((await captureTools()).map(t => t.function.name)).toEqual(['roll_dice'])
    })

    it("passes the chat's disabled tools and groups to the registry", async () => {
      mockChatsApi.getChatById.mockReturnValue({
        ...mockChat,
        disabledTools: ['oracle'],
        disabledToolGroups: ['lore'],
      })

      await captureTools()

      const { getEnabledToolDefinitions } = await import('@/ai/tools/index.js')
      expect(getEnabledToolDefinitions).toHaveBeenCalledWith({
        disabledTools: ['oracle'],
        disabledGroups: ['lore'],
        // No server is connected, so none is offered; nor is the web set up.
        servers: [],
        web: false,
      })
    })

    it('asks for everything when the chat has no opinion', async () => {
      await captureTools()

      const { getEnabledToolDefinitions } = await import('@/ai/tools/index.js')
      expect(getEnabledToolDefinitions).toHaveBeenCalledWith({
        disabledTools: undefined,
        disabledGroups: undefined,
        servers: [],
        web: false,
      })
    })

    it('offers the web to a chat that asked for it, once a service can search', async () => {
      setWebSearch({ id: 'web', service: 'exa', keys: {}, profiles: [] })
      mockChatsApi.getChatById.mockReturnValue({ ...mockChat, web: true })

      try {
        await captureTools()
      } finally {
        setWebSearch(null)
      }

      const { getEnabledToolDefinitions } = await import('@/ai/tools/index.js')
      expect(getEnabledToolDefinitions).toHaveBeenCalledWith(expect.objectContaining({ web: true }))
    })

    it('sends no tools when the profile has tool use off', async () => {
      mockAIConfig.activeAIPreset.value = { ...mockProfile, toolsEnabled: false }

      expect(await captureTools()).toBeUndefined()
    })
  })

  describe('generation overrides', () => {
    /**
     * Drive one generation and return the options the service was called with.
     * @returns {Promise<Object>}
     */
    const captureOptions = async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return {}
      })

      await composable.sendMessage('Hello')

      return mockAIService.generateChatCompletion.mock.calls[0][3]
    }

    it("should pass the profile's overrides to the service", async () => {
      const generationOverrides = { maxTokens: 512, parameters: { temperature: 0.2 } }
      mockAIConfig.activeAIPreset.value = { ...mockProfile, generationOverrides }

      expect((await captureOptions()).overrides).toEqual(generationOverrides)
    })

    it('should send no overrides when the profile has none', async () => {
      expect((await captureOptions()).overrides).toBeUndefined()
    })

    it('should leave title generation on its own settings', async () => {
      mockAIConfig.activeAIPreset.value = {
        ...mockProfile,
        generationOverrides: { maxTokens: 4096 },
      }
      const composable = useAIChat(mockStoryId, mockChatId)

      // An empty chat triggers title generation before the reply.
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return {}
      })

      await composable.sendMessage('Hello')

      const [titleCall, replyCall] = mockAIService.generateChatCompletion.mock.calls
      expect(titleCall[3].overrides).toEqual(TITLE_DEFAULTS)
      expect(replyCall[3].overrides).toEqual({ maxTokens: 4096 })
    })
  })

  describe('token usage', () => {
    /** Drive one generation and return the metadata written to the message. */
    const captureMetadata = async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('Hello')

      // A tool loop writes the trajectory mid-turn, so the final call is the
      // one carrying the completed metadata.
      const calls = mockChatsApi.updateMessage.mock.calls.filter(([id]) => id === 'msg_assistant')
      return calls.at(-1)?.[1]?.metadata
    }

    it('says which model wrote the answer, and where it ran', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return { usage: { prompt_tokens: 1200, completion_tokens: 80 } }
      })

      expect(await captureMetadata()).toMatchObject({ model: 'gpt-4', provider: 'Test Provider' })
    })

    it('says every call it makes goes back with the conversation', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return {}
      })

      expect(await captureMetadata()).toMatchObject({ callsKept: true })
    })

    it('says so before a word arrives, so a turn that fails still says what on', async () => {
      mockAIService.generateChatCompletion.mockRejectedValue(new Error('Connection lost'))
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('Hello').catch(() => {})

      const first = mockChatsApi.updateMessage.mock.calls.find(([id]) => id === 'msg_assistant')
      expect(first[1].metadata).toMatchObject({ model: 'gpt-4', provider: 'Test Provider' })
    })

    it('records usage from a single-request turn', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return { usage: { prompt_tokens: 1200, completion_tokens: 80 } }
      })

      expect((await captureMetadata()).usage).toEqual({
        promptTokens: 1200,
        completionTokens: 80,
        requests: 1,
      })
    })

    it('keeps the final context size and sums what was generated', async () => {
      const { hasTools, getEnabledToolDefinitions, executeTool } = await import(
        '@/ai/tools/index.js'
      )
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'roll_dice' } },
      ])
      executeTool.mockResolvedValue({ tool_call_id: 'call_1', content: '{"total":4}' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'rolling' })
          return {
            usage: { prompt_tokens: 1200, completion_tokens: 20 },
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'roll_dice', arguments: '{}' } },
            ],
          }
        })
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: ' done' })
          return { usage: { prompt_tokens: 1400, completion_tokens: 30 } }
        })

      // promptTokens is the last request's, since that's the context the next
      // turn builds on; completions accumulate because each request is billed.
      expect((await captureMetadata()).usage).toEqual({
        promptTokens: 1400,
        completionTokens: 50,
        requests: 2,
      })

      hasTools.mockReturnValue(false)
      getEnabledToolDefinitions.mockReturnValue([])
    })

    it('omits usage when the provider reports none', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return {}
      })

      expect(await captureMetadata()).not.toHaveProperty('usage')
    })

    it('starts a new paragraph when the model speaks again after a tool round', async () => {
      const { hasTools, getEnabledToolDefinitions, executeTool } = await import(
        '@/ai/tools/index.js'
      )
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'roll_dice' } },
      ])
      executeTool.mockResolvedValue({ tool_call_id: 'call_1', content: '{"total":4}' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Let me roll.' })
          return {
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'roll_dice', arguments: '{}' } },
            ],
          }
        })
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'A four.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user', content: 'Roll' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })

      await composable.sendMessage('Roll')

      const streamed = mockChatsApi.streamMessageContent.mock.calls
        .filter(call => call[0] === 'msg_assistant')
        .map(call => call[1])
      // The preamble and the answer are two paragraphs, not "Let me roll.A four."
      expect(streamed.at(-1)).toBe('Let me roll.\n\nA four.')

      hasTools.mockReturnValue(false)
      getEnabledToolDefinitions.mockReturnValue([])
    })
  })

  describe('what a tool call read', () => {
    /** Run one turn whose only tool call is `name`, and return the trajectory. */
    const trajectoryFor = async (name, result) => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([{ type: 'function', function: { name } }])
      tools.executeTool.mockResolvedValue({
        tool_call_id: 'call_1',
        content: JSON.stringify(result),
        result,
      })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [{ id: 'call_1', type: 'function', function: { name, arguments: '{}' } }],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'done' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('Hello')

      tools.hasTools.mockReturnValue(false)
      tools.getEnabledToolDefinitions.mockReturnValue([])

      return mockChatsApi.updateMessage.mock.calls
        .filter(([id]) => id === 'msg_assistant')
        .at(-1)[1].metadata.apiTrajectory
    }

    it('notes the document a read put in front of the model', async () => {
      // The context builder needs to know which document a result was, to keep
      // it current instead of replaying the copy that came back.
      const trajectory = await trajectoryFor('read_document', {
        id: 'doc_elara',
        path: 'notes/Elara',
        type: 'text',
        content: 'A knight.',
      })

      expect(trajectory.find(item => item.role === 'tool')._document).toBe('doc_elara')
    })

    it('notes nothing for a call that read nothing', async () => {
      const trajectory = await trajectoryFor('roll_dice', { total: 4 })

      expect(trajectory.find(item => item.role === 'tool')).not.toHaveProperty('_document')
    })
  })

  describe('skills', () => {
    /**
     * Drive one turn whose only tool call is `director`, and hand back the tool
     * context it was executed with.
     */
    const contextForToolCall = async () => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'director' } },
      ])
      tools.executeTool.mockResolvedValue({
        tool_call_id: 'call_1',
        content: '{"direction":"Stay in the scene."}',
      })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'director', arguments: '{}' } },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'The market thins out.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('I look around.')

      tools.hasTools.mockReturnValue(false)
      tools.getEnabledToolDefinitions.mockReturnValue([])

      return tools.executeTool.mock.calls.at(-1)[1]
    }

    it('runs a skill and the tools called beside it, in one step', async () => {
      // Nothing is held back. A call made in the same step as `director` was
      // chosen without the direction, and telling the model to ask again cost
      // every other call in that step a round trip — setting up the notes and
      // asking the Director are not the same question. The prompt is what
      // keeps it from re-asking what the Director already asked.
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'director' } },
        { type: 'function', function: { name: 'create_document' } },
      ])
      tools.executeTool.mockResolvedValue({ tool_call_id: 'call_x', content: '{"ok":true}' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            {
              id: 'call_c',
              type: 'function',
              function: { name: 'create_document', arguments: '{"path":"notes/GM Notes"}' },
            },
            { id: 'call_d', type: 'function', function: { name: 'director', arguments: '{}' } },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'The road opens ahead of you.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage("Let's start the game.")

      expect(tools.executeTool.mock.calls.map(call => call[0].function.name)).toEqual([
        'create_document',
        'director',
      ])

      tools.hasTools.mockReturnValue(false)
      tools.getEnabledToolDefinitions.mockReturnValue([])
    })

    it('runs a step of ordinary tools concurrently, as before', async () => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'oracle' } },
        { type: 'function', function: { name: 'roll_dice' } },
      ])
      tools.executeTool.mockResolvedValue({ tool_call_id: 'call_o', content: '{"answer":"Yes"}' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            { id: 'call_o', type: 'function', function: { name: 'oracle', arguments: '{}' } },
            { id: 'call_r', type: 'function', function: { name: 'roll_dice', arguments: '{}' } },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'It holds.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('I test the rope.')

      // Nothing in this step was waiting on an answer, so nothing is held back.
      expect(tools.executeTool).toHaveBeenCalledTimes(2)

      tools.hasTools.mockReturnValue(false)
      tools.getEnabledToolDefinitions.mockReturnValue([])
    })

    it('hands a tool the means to run another inference', async () => {
      const context = await contextForToolCall()

      expect(context.storyId).toBe(mockStoryId)
      expect(context.chatId).toBe(mockChatId)
      expect(typeof context.consult).toBe('function')
    })

    it('tells a tool what the chat has loaded, as the chat stands when it asks', async () => {
      const context = await contextForToolCall()
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [
          {
            id: 'msg_load',
            role: 'user',
            segments: [
              {
                type: 'command',
                command: {
                  name: 'house-style',
                  input: '',
                  prompt: true,
                  load: true,
                  result: 'Past.',
                },
              },
            ],
          },
        ],
      })

      expect(context.loadedSkills()).toEqual(['house-style'])
    })

    it('runs the same conversation under the prompt it was given', async () => {
      const { consult } = await contextForToolCall()

      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'The scene has what it needs.' })
        return {}
      })

      const said = await consult('You are the Director.')

      expect(mockAIContext().build).toHaveBeenCalledWith({
        mode: 'chat',
        systemPrompt: 'You are the Director.',
        chatId: mockChatId,
        // As a transcript, so there is no assistant turn to continue. A skill
        // that named no roles gets the API's own names for them.
        transcript: { user: 'user', assistant: 'assistant' },
      })
      expect(said).toBe('The scene has what it needs.')
    })

    it('offers a skill that named no tools nothing to call', async () => {
      const { consult } = await contextForToolCall()

      mockAIService.generateChatCompletion.mockClear()
      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'Keep going.' })
        return {}
      })

      await consult('You are the Director.')

      // One inference and no loop: a skill that asked for nothing answers.
      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(1)
      expect(mockAIService.generateChatCompletion.mock.calls.at(-1)[3].tools).toBeUndefined()
    })

    it('offers a skill the tools its role names', async () => {
      const tools = await import('@/ai/tools/index.js')
      const { consult } = await contextForToolCall()

      tools.getToolDefinitionsFor.mockReturnValue([
        { type: 'function', function: { name: 'oracle' } },
      ])
      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'Press.' })
        return {}
      })

      await consult('You are the Director.', ['oracle', 'roll_table'])

      // Depth 1: the turn is 0 and this is a skill consulted from it.
      expect(tools.getToolDefinitionsFor).toHaveBeenCalledWith(['oracle', 'roll_table'], 1)
      expect(mockAIService.generateChatCompletion.mock.calls.at(-1)[3].tools).toEqual([
        { type: 'function', function: { name: 'oracle' } },
      ])
    })

    it('answers a skill’s call to a tool it was not given, without running it', async () => {
      const tools = await import('@/ai/tools/index.js')
      const { consult } = await contextForToolCall()

      tools.getToolDefinitionsFor.mockReturnValue([
        { type: 'function', function: { name: 'oracle' } },
      ])
      tools.executeTool.mockClear()
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            { id: 'call_w', type: 'function', function: { name: 'web_search', arguments: '{}' } },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Press.' })
          return {}
        })

      expect(await consult('You are the Director.', ['oracle'])).toBe('Press.')
      expect(tools.executeTool).not.toHaveBeenCalled()
      const [messages] = mockAIService.generateChatCompletion.mock.calls.at(-1)
      expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_w' })
      expect(JSON.parse(messages.at(-1).content).error).toMatch(/^Not run: web_search/)
    })

    it('gives the turn’s own calls the conversation, and a skill’s calls none', async () => {
      const tools = await import('@/ai/tools/index.js')
      const turn = await contextForToolCall()
      expect(turn.conversation()).toEqual([{ id: 'msg_1' }])

      tools.getToolDefinitionsFor.mockReturnValue([
        { type: 'function', function: { name: 'read_document' } },
      ])
      tools.executeTool.mockClear()
      tools.executeTool.mockResolvedValue({ tool_call_id: 'call_2', content: '{}' })
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            {
              id: 'call_2',
              type: 'function',
              function: { name: 'read_document', arguments: '{"path":"notes/Elara"}' },
            },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Done.' })
          return {}
        })

      await turn.consult('You write scenes.', ['read_document'])

      // A skill reads a transcript without the calls, so a read above is not
      // in front of it and it is never told one is.
      const [, context] = tools.executeTool.mock.calls.at(-1)
      expect(context.chatId).toBe(mockChatId)
      expect(context.conversation).toBeUndefined()
    })

    it("does not let the chat's tool switches reach a skill", async () => {
      const tools = await import('@/ai/tools/index.js')
      const { consult } = await contextForToolCall()

      // Those switches say what the assistant the writer is talking to may do.
      // Reading them here would mean switching off RPG Tools quietly put
      // the Director back to guessing at the outcomes its advice turns on.
      mockChatsApi.getChatById.mockReturnValue({
        ...mockChat,
        disabledTools: ['oracle'],
        disabledToolGroups: ['rpg'],
      })
      tools.getToolDefinitionsFor.mockClear()
      tools.getToolDefinitionsFor.mockReturnValue([
        { type: 'function', function: { name: 'oracle' } },
      ])
      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'Press.' })
        return {}
      })

      await consult('You are the Director.', ['oracle'])

      expect(tools.getToolDefinitionsFor).toHaveBeenCalledWith(['oracle'], 1)
      expect(mockAIService.generateChatCompletion.mock.calls.at(-1)[3].tools).toEqual([
        { type: 'function', function: { name: 'oracle' } },
      ])
    })

    it('consults a skill reached from a skill one depth further down', async () => {
      // The Director asks `interpret`; interpret runs at depth 2, which is
      // where getToolDefinitionsFor stops offering skills. The count is kept
      // here rather than passed along by whoever calls consult.
      const tools = await import('@/ai/tools/index.js')
      const { consult } = await contextForToolCall()

      tools.getToolDefinitionsFor.mockReturnValue([
        { type: 'function', function: { name: 'interpret' } },
      ])
      tools.executeTool.mockResolvedValue({
        tool_call_id: 'call_i',
        content: '{"interpretation":"The innkeeper is hiding her son."}',
      })
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            {
              id: 'call_i',
              type: 'function',
              function: { name: 'interpret', arguments: '{"question":"What is she hiding?"}' },
            },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Press on the son.' })
          return {}
        })

      await consult('You are the Director.', ['interpret'])

      const nested = tools.executeTool.mock.calls.at(-1)[1].consult
      tools.getToolDefinitionsFor.mockClear()
      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'An idea.' })
        return {}
      })

      await nested('You are the interpreter.', ['oracle'])

      expect(tools.getToolDefinitionsFor).toHaveBeenCalledWith(['oracle'], 2)
    })

    it("runs a skill's tool calls and answers from what came back", async () => {
      const tools = await import('@/ai/tools/index.js')
      const { consult } = await contextForToolCall()

      tools.getToolDefinitionsFor.mockReturnValue([
        { type: 'function', function: { name: 'oracle' } },
      ])
      tools.executeTool.mockResolvedValue({
        tool_call_id: 'call_o',
        content: '{"answer":"No, and"}',
      })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            {
              id: 'call_o',
              type: 'function',
              function: { name: 'oracle', arguments: '{"question":"Are they followed?"}' },
            },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({
            content: 'I asked whether they are followed: no, and the patrol turned back.',
          })
          return {}
        })

      const said = await consult('You are the Director.', ['oracle'])

      expect(tools.executeTool).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'call_o' }),
        expect.objectContaining({ storyId: mockStoryId, chatId: mockChatId })
      )
      expect(said).toBe('I asked whether they are followed: no, and the patrol turned back.')

      // The second request carries the call and its result, so the skill is
      // answering with the roll in front of it rather than from memory.
      const sent = mockAIService.generateChatCompletion.mock.calls.at(-1)[0]
      expect(sent.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_o' }] })
      expect(sent.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_o' })
    })

    it('treats a skill that spends its rounds without answering as silent', async () => {
      const tools = await import('@/ai/tools/index.js')
      const { consult } = await contextForToolCall()

      tools.getToolDefinitionsFor.mockReturnValue([
        { type: 'function', function: { name: 'oracle' } },
      ])
      tools.executeTool.mockResolvedValue({ tool_call_id: 'call_o', content: '{}' })
      mockAIService.generateChatCompletion.mockClear()
      mockAIService.generateChatCompletion.mockImplementation(async () => ({
        toolCalls: [
          { id: 'call_o', type: 'function', function: { name: 'oracle', arguments: '{}' } },
        ],
      }))

      // A half-finished consultation is not advice. The caller reports having
      // heard nothing and the turn narrates unadvised.
      expect(await consult('You are the Director.', ['oracle'])).toBe('')
      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(SKILL_MAX_ROUNDS)
    })

    it('keeps what a skill said out of the message the player is watching', async () => {
      const { consult } = await contextForToolCall()

      mockChatsApi.streamMessageContent.mockClear()
      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'Press harder.' })
        return {}
      })

      await consult('You are the Director.')

      expect(mockChatsApi.streamMessageContent).not.toHaveBeenCalled()
    })

    it('drops inline reasoning from what a skill said', async () => {
      const { consult } = await contextForToolCall()

      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: '<think>weighing it</think>Move to the meeting.' })
        return {}
      })

      expect(await consult('You are the Director.')).toBe('Move to the meeting.')
    })

    /**
     * Run one turn whose tool takes `duration` to answer while declaring
     * `declared` as its own limit, and return the result the model saw.
     */
    const toolResultAfter = async (duration, declared) => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'director' } },
      ])
      tools.getToolTimeout.mockReturnValue(declared)
      tools.executeTool.mockImplementation(
        () =>
          new Promise(resolve => {
            setTimeout(
              () => resolve({ tool_call_id: 'call_1', content: '{"direction":"Go on."}' }),
              duration
            )
          })
      )

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'director', arguments: '{}' } },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'The market thins out.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      vi.useFakeTimers()
      try {
        const turn = composable.sendMessage('I look around.')
        await vi.advanceTimersByTimeAsync(duration + 1)
        await turn
      } finally {
        vi.useRealTimers()
        tools.hasTools.mockReturnValue(false)
        tools.getEnabledToolDefinitions.mockReturnValue([])
        tools.getToolTimeout.mockReturnValue(undefined)
        tools.executeTool.mockReset()
      }

      const trajectory = mockChatsApi.updateMessage.mock.calls
        .filter(([id]) => id === 'msg_assistant')
        .at(-1)[1].metadata.apiTrajectory

      return JSON.parse(trajectory.find(item => item.role === 'tool').content)
    }

    it('gives a skill the time an inference takes', async () => {
      // The default limit suits a document lookup. A skill that declares its
      // own gets it, or every call on a slow model would be cut off.
      expect(await toolResultAfter(30000, 120000)).toEqual({ direction: 'Go on.' })
    })

    it('holds a tool that declares nothing to the default limit', async () => {
      expect(await toolResultAfter(30000, undefined)).toEqual({
        error: expect.stringMatching(/timed out/i),
      })
    })
  })

  describe('a server’s tools', () => {
    const wiki = {
      id: 'mcp_wiki',
      name: 'Wiki',
      prefix: 'wiki',
      url: 'https://wiki.example/mcp',
      tools: [
        { name: 'edit', exposed: 'wiki__edit', inputSchema: {} },
        {
          name: 'search',
          exposed: 'wiki__search',
          inputSchema: {},
          annotations: { readOnlyHint: true },
        },
      ],
      prompts: [],
      profiles: ['builtin_profile_chat'],
      allowed: [],
      created: 1,
      updated: 1,
    }

    /**
     * Start a turn whose model calls these tools in its first round and then
     * says something, without waiting for it. Hands back the turn, and what
     * the turn is waiting on.
     */
    const startTurn = async calls => {
      const { setServers } = await import('@/mcp/servers.js')
      setServers([wiki])
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'wiki__edit' } },
        { type: 'function', function: { name: 'wiki__search' } },
        { type: 'function', function: { name: 'edit_document' } },
      ])
      tools.executeTool.mockImplementation(async call => ({
        tool_call_id: call.id,
        content: '"done"',
      }))

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({ toolCalls: calls }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Done.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      const { useToolApprovals } = await import('@/composables/useToolApprovals.js')
      const { pending, answer } = useToolApprovals('msg_assistant')
      const turn = composable.sendMessage('Fix the wiki page.')
      return { composable, turn, pending, answer, tools }
    }

    const call = (id, name) => ({ id, type: 'function', function: { name, arguments: '{}' } })

    const toolResults = () =>
      mockChatsApi.updateMessage.mock.calls
        .filter(([id, patch]) => id === 'msg_assistant' && patch.metadata?.apiTrajectory)
        .at(-1)[1]
        .metadata.apiTrajectory.filter(item => item.role === 'tool')

    afterEach(async () => {
      const { setServers } = await import('@/mcp/servers.js')
      setServers([])
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(false)
      tools.getEnabledToolDefinitions.mockReturnValue([])
      tools.executeTool.mockReset()
      mockAllowTool.mockClear()
      mockAllowServer.mockClear()
    })

    it('offers the turn the servers the chat is on', async () => {
      const { turn, tools } = await startTurn([call('c1', 'wiki__search')])
      await turn

      expect(tools.getEnabledToolDefinitions).toHaveBeenCalledWith(
        expect.objectContaining({ servers: ['mcp_wiki'] })
      )
    })

    it('runs a tool that only reads without asking', async () => {
      const { turn, pending, tools } = await startTurn([call('c1', 'wiki__search')])
      await turn

      expect(pending.value).toEqual([])
      expect(tools.executeTool).toHaveBeenCalledTimes(1)
    })

    it('waits for the writer before a tool that may change something, and runs it on Allow', async () => {
      const { turn, pending, answer, tools } = await startTurn([call('c1', 'wiki__edit')])

      await vi.waitFor(() => expect(pending.value).toHaveLength(1))
      expect(pending.value[0]).toMatchObject({ id: 'c1', name: 'wiki__edit' })
      expect(tools.executeTool).not.toHaveBeenCalled()

      answer('c1', 'allow')
      await turn

      expect(tools.executeTool).toHaveBeenCalledTimes(1)
      expect(mockAllowTool).not.toHaveBeenCalled()
    })

    it('tells the model the writer did not allow it, on Deny', async () => {
      const { turn, pending, answer, tools } = await startTurn([call('c1', 'wiki__edit')])

      await vi.waitFor(() => expect(pending.value).toHaveLength(1))
      answer('c1', 'deny')
      await turn

      expect(tools.executeTool).not.toHaveBeenCalled()
      expect(JSON.parse(toolResults()[0].content).error).toMatch(/did not allow/)
    })

    it('remembers Always allow for the tool', async () => {
      const { turn, pending, answer } = await startTurn([call('c1', 'wiki__edit')])

      await vi.waitFor(() => expect(pending.value).toHaveLength(1))
      answer('c1', 'always')
      await turn

      expect(mockAllowTool).toHaveBeenCalledWith('wiki__edit')
    })

    it('runs a call asked for over and over in one round once, and says so', async () => {
      const { turn, tools } = await startTurn(
        Array.from({ length: 30 }, (_, i) => call(`r${i}`, 'edit_document'))
      )
      await turn

      // A response that came apart: one call, thirty times. It runs once, and
      // the first repeat answers for the rest, which are off the record.
      expect(tools.executeTool).toHaveBeenCalledTimes(1)
      const results = toolResults()
      expect(results.map(result => result.tool_call_id)).toEqual(['r0', 'r1'])
      expect(JSON.parse(results[1].content).error).toMatch(/nor were 28 more calls/)
    })

    it('answers a call to a tool the turn was not offered, and runs the rest', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { turn, tools } = await startTurn([
        call('c1', 'wiki__search'),
        call('c2', 'web_search', '{"query":"tides"}'),
      ])
      await turn

      // Called in an earlier turn of the chat, and switched off since: the
      // model can see it in the conversation, and the registry still holds it.
      expect(tools.executeTool).toHaveBeenCalledTimes(1)
      expect(tools.executeTool.mock.calls[0][0].id).toBe('c1')
      const results = toolResults()
      expect(results.map(result => result.tool_call_id)).toEqual(['c1', 'c2'])
      expect(JSON.parse(results[1].content).error).toBe(
        'Not run: web_search is not one of the tools this chat offers now.'
      )
      expect(warn).toHaveBeenCalledWith('Calls to tools not offered:', ['web_search'])
    })

    it('remembers Always allow for everything from the server', async () => {
      const { turn, pending, answer, tools } = await startTurn([call('c1', 'wiki__edit')])

      await vi.waitFor(() => expect(pending.value).toHaveLength(1))
      answer('c1', 'always-server')
      await turn

      expect(tools.executeTool).toHaveBeenCalledTimes(1)
      expect(mockAllowServer).toHaveBeenCalledWith('wiki__edit')
      expect(mockAllowTool).not.toHaveBeenCalled()
    })

    it('denies what it was waiting on when the turn is stopped', async () => {
      const { composable, turn, pending, tools } = await startTurn([call('c1', 'wiki__edit')])

      await vi.waitFor(() => expect(pending.value).toHaveLength(1))
      composable.stopGeneration()
      await turn

      expect(pending.value).toEqual([])
      expect(tools.executeTool).not.toHaveBeenCalled()
    })

    it('applies edits as the setting says while a server’s tools are on offer', async () => {
      applyEdits.value = 'auto'
      const { turn, tools } = await startTurn([call('c1', 'edit_document')])
      await turn

      expect(tools.executeTool.mock.calls[0][1].propose).toBeUndefined()
    })
  })

  describe('what a skill did, and a reply handed to one', () => {
    /**
     * Run one turn whose model makes these calls in its first round, with each
     * tool answered by `answer(call, context)`, and every later request — the
     * skills' and the turn's — answered by `rounds` in order. Hands back what
     * the turn left on the message.
     */
    const turnWith = async (calls, answer, rounds) => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue(
        calls.map(call => ({ type: 'function', function: { name: call.function.name } }))
      )
      tools.executeTool.mockImplementation(async (call, context) => {
        const result = await answer(call, context)
        return { tool_call_id: call.id, content: JSON.stringify(result), result }
      })

      mockAIService.generateChatCompletion.mockImplementationOnce(async (m, p, callback) => {
        callback({ content: 'Let me hand this over.' })
        return { toolCalls: calls }
      })
      for (const round of rounds) {
        mockAIService.generateChatCompletion.mockImplementationOnce(round)
      }

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      let executed = []
      try {
        await composable.sendMessage('Write the scene at the door.')
        executed = tools.executeTool.mock.calls.map(([call]) => call.function.name)
      } finally {
        tools.hasTools.mockReturnValue(false)
        tools.getEnabledToolDefinitions.mockReturnValue([])
        tools.executeTool.mockReset()
      }

      const [, content, reasoning] = mockChatsApi.streamMessageContent.mock.calls.at(-1)
      const trajectory = mockChatsApi.updateMessage.mock.calls
        .filter(([id, patch]) => id === 'msg_assistant' && patch.metadata?.apiTrajectory)
        .at(-1)[1].metadata.apiTrajectory
      return {
        content,
        reasoning,
        trajectory,
        results: trajectory.filter(item => item.role === 'tool'),
        executed,
      }
    }

    const call = (id, name, args = '{}') => ({
      id,
      type: 'function',
      function: { name, arguments: args },
    })

    /** A skill that consults once and answers with what it heard. */
    const consulting = async (call, context) => {
      if (call.function.name === 'oracle') return { answer: 'Yes' }
      const said = await context.consult('Write it.', ['oracle'])
      return said ? { answer: said } : { error: 'It had nothing to say.' }
    }

    const writes = (text, thinking) => async (m, p, callback) => {
      if (thinking) callback({ reasoning: thinking })
      callback({ content: text })
      return {}
    }

    it('keeps what a skill thought and called beside its answer', async () => {
      const { results } = await turnWith([call('call_d', 'director')], consulting, [
        async (m, p, callback) => {
          callback({ reasoning: 'Is the door locked?' })
          return { toolCalls: [call('call_o', 'oracle', '{"question":"Locked?"}')] }
        },
        writes('Have it open.'),
        writes('The door gives.'),
      ])

      expect(results[0]._consultation).toEqual({
        thinking: 'Is the door locked?',
        calls: [
          { name: 'oracle', arguments: '{"question":"Locked?"}', result: '{"answer":"Yes"}' },
        ],
      })
    })

    it('ends the turn on what a skill wrote as the reply', async () => {
      const { content, reasoning, results } = await turnWith(
        [call('call_s', 'scene', '{"brief":"The door"}')],
        consulting,
        [writes('The door opens on a hall.', 'Short, then stop.')]
      )

      // The skill's request and nothing after it: a round more would hand the
      // model the scene to rewrite.
      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(2)
      expect(content).toBe('The door opens on a hall.')
      // What the model said before handing over is its working, kept with the
      // thinking rather than run into the scene.
      expect(reasoning).toBe('Let me hand this over.\n\nShort, then stop.')
      expect(JSON.parse(results[0].content)).toEqual({ reply: 'Written as the reply.' })
      expect(results[0]._consultation).toEqual({ calls: [], reply: true })
    })

    it('streams the reply into the message as the skill writes it', async () => {
      await turnWith([call('call_s', 'scene')], consulting, [writes('The door opens.')])

      expect(mockChatsApi.streamMessageContent).toHaveBeenCalledWith(
        'msg_assistant',
        'The door opens.',
        'Let me hand this over.',
        expect.any(Object)
      )
    })

    it('runs the round’s other calls before the skill that writes the reply', async () => {
      const { executed, results } = await turnWith(
        [call('call_s', 'scene'), call('call_o', 'oracle')],
        consulting,
        [writes('The door opens.')]
      )

      expect(executed).toEqual(['oracle', 'scene'])
      // Still in the order the model called them, so each result follows its call.
      expect(results.map(result => result.tool_call_id)).toEqual(['call_s', 'call_o'])
    })

    it('lets one skill write the reply and tells the model about the other', async () => {
      // Two different asks, so neither is a repeat of the other.
      const other = call('call_b', 'scene')
      other.function.arguments = '{"brief":"Another scene."}'
      const { executed, results } = await turnWith([call('call_a', 'scene'), other], consulting, [
        writes('The door opens.'),
      ])

      expect(executed).toEqual(['scene'])
      expect(JSON.parse(results[1].content).error).toMatch(/only one skill/i)
    })

    it('gives the turn back when the skill writes nothing', async () => {
      const { content, reasoning, results } = await turnWith(
        [call('call_s', 'scene')],
        consulting,
        [writes(''), writes('I’ll write it myself.')]
      )

      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(3)
      expect(content).toBe('Let me hand this over.\n\nI’ll write it myself.')
      expect(reasoning).toBeNull()
      expect(JSON.parse(results[0].content)).toEqual({ error: 'It had nothing to say.' })
    })
  })

  describe('what a role runs under', () => {
    /** Run one turn whose only tool call is `director`, and hand back the context it got. */
    const runWithTool = async () => {
      const { hasTools, getEnabledToolDefinitions, executeTool } = await import(
        '@/ai/tools/index.js'
      )
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'director' } },
      ])
      executeTool.mockResolvedValue({ tool_call_id: 'call_1', content: '{"direction":"go"}' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'director', arguments: '{}' } },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'The innkeeper looks up.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })
      await composable.sendMessage('I push open the inn door.')

      return executeTool.mock.calls.at(-1)[1]
    }

    it("hands a role the profile's wording for it", async () => {
      mockSavedProfiles.set('chatprofile_1', {
        id: 'chatprofile_1',
        name: 'Mine',
        settings: { skills: { director: { prompt: 'Say what the scene needs, briefly.' } } },
      })
      mockChatsApi.getChatById.mockReturnValue({ ...mockChat, profileId: 'chatprofile_1' })

      const context = await runWithTool()

      // The wording is the profile's business, not the skill's: a skill that
      // worked it out itself would have to know which chat it was in.
      expect(context.promptFor('director')).toBe('Say what the scene needs, briefly.')
    })

    it("falls back to the skill's own wording when the profile has not said", async () => {
      const { INTERPRET_PROMPT } = await import('@/ai/skills/interpret/index.js')
      mockChatsApi.getChatById.mockReturnValue({ ...mockChat, profileId: 'builtin_profile_chat' })

      const context = await runWithTool()

      expect(context.promptFor('interpret')).toBe(INTERPRET_PROMPT)
    })
  })

  describe('thinking across a tool call', () => {
    /** Run a turn that thinks, calls a tool, then answers. */
    const runTurn = async () => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'director' } },
      ])
      tools.executeTool.mockResolvedValue({ tool_call_id: 'call_1', content: '{}' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ reasoning: 'weighing it' })
          return {
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'director', arguments: '{}' } },
            ],
          }
        })
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'The market thins out.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('I look around.')

      tools.hasTools.mockReturnValue(false)
      tools.getEnabledToolDefinitions.mockReturnValue([])

      return {
        continuation: mockAIService.generateChatCompletion.mock.calls[1][0],
        trajectory: mockChatsApi.updateMessage.mock.calls
          .filter(([id]) => id === 'msg_assistant')
          .at(-1)[1].metadata.apiTrajectory,
      }
    }

    it('carries the turn its own thinking into the next request', async () => {
      // Otherwise the continuation shows a model that reached for a tool and
      // never had a thought, and it stops thinking for the rest of the turn.
      const { continuation } = await runTurn()

      const assistant = continuation.find(m => m.role === 'assistant' && m.tool_calls)
      expect(assistant._reasoning).toBe('weighing it')
    })

    it('keeps it out of what gets stored', async () => {
      // Reasoning is wanted while a turn is running and never after it.
      const { trajectory } = await runTurn()

      expect(trajectory.find(item => item.tool_calls)).not.toHaveProperty('_reasoning')
      expect(JSON.stringify(trajectory)).not.toContain('weighing it')
    })
  })

  describe('saved context', () => {
    /** Drive one generation and return every metadata patch the message got. */
    const generate = async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('Hello')

      return mockChatsApi.updateMessage.mock.calls
        .filter(([id]) => id === 'msg_assistant')
        .map(([, patch]) => patch.metadata)
    }

    it('keeps the request when the debug setting is on', async () => {
      debug.value = true
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return {}
      })

      const patches = await generate()

      expect(patches.at(-1).context).toEqual([
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
      ])
    })

    it('writes it before the turn runs, so a turn that fails still has one', async () => {
      debug.value = true
      mockAIService.generateChatCompletion.mockImplementation(async () => {
        throw new Error('connection lost')
      })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await expect(composable.sendMessage('Hello')).rejects.toThrow('connection lost')

      const patches = mockChatsApi.updateMessage.mock.calls
        .filter(([id]) => id === 'msg_assistant')
        .map(([, patch]) => patch.metadata)
      expect(patches[0].context).toHaveLength(2)
    })

    it('survives the writes a tool loop makes mid-turn', async () => {
      // updateMessage replaces metadata whole, so anything written during the
      // loop would drop the context if it did not carry it along.
      debug.value = true
      const { hasTools, getEnabledToolDefinitions, executeTool } = await import(
        '@/ai/tools/index.js'
      )
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'roll_dice' } },
      ])
      executeTool.mockResolvedValue({ tool_call_id: 'call_1', content: '{"total":4}' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'rolling' })
          return {
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'roll_dice', arguments: '{}' } },
            ],
          }
        })
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: ' done' })
          return {}
        })

      const patches = await generate()

      expect(patches.every(patch => patch.context?.length === 2)).toBe(true)
      expect(patches.at(-1).apiTrajectory.length).toBeGreaterThan(0)

      hasTools.mockReturnValue(false)
      getEnabledToolDefinitions.mockReturnValue([])
    })

    it('stops carrying it once the debug setting is switched off mid-turn', async () => {
      // Switching it off forgets every saved request; a turn still running
      // must not write its own back with the writes it has left to make.
      debug.value = true
      const { hasTools, getEnabledToolDefinitions, executeTool } = await import(
        '@/ai/tools/index.js'
      )
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'roll_dice' } },
      ])
      executeTool.mockResolvedValue({ tool_call_id: 'call_1', content: '{"total":4}' })

      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'rolling' })
          debug.value = false
          return {
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'roll_dice', arguments: '{}' } },
            ],
          }
        })
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: ' done' })
          return {}
        })

      const patches = await generate()

      expect(patches[0].context).toHaveLength(2)
      expect(patches.slice(1).length).toBeGreaterThan(0)
      expect(patches.slice(1).every(patch => patch.context === undefined)).toBe(true)
      expect(patches.at(-1).apiTrajectory.length).toBeGreaterThan(0)

      hasTools.mockReturnValue(false)
      getEnabledToolDefinitions.mockReturnValue([])
    })

    it('keeps nothing when the debug setting is off', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return {}
      })

      const patches = await generate()

      expect(patches.every(patch => patch.context === undefined)).toBe(true)
    })
  })

  describe('reasoning', () => {
    /** Drive one generation and hand back what was written to the message. */
    const generate = async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('Hello')

      const updates = mockChatsApi.updateMessage.mock.calls.filter(([id]) => id === 'msg_assistant')
      const streams = mockChatsApi.streamMessageContent.mock.calls.filter(
        ([id]) => id === 'msg_assistant'
      )
      return {
        trajectory: updates.at(-1)?.[1]?.metadata?.apiTrajectory,
        reasoning: streams.at(-1)?.[2],
        timing: streams.at(-1)?.[3],
      }
    }

    /** Put the tool layer in play for one test, and take it back out after. */
    const withTools = async () => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'roll_dice' } },
      ])
      tools.executeTool.mockResolvedValue({ tool_call_id: 'call_1', content: '{"total":4}' })
      return () => {
        tools.hasTools.mockReturnValue(false)
        tools.getEnabledToolDefinitions.mockReturnValue([])
      }
    }

    it('keeps the reasoning behind the final answer', async () => {
      // The closing thought is as much part of the trajectory as the ones
      // before a tool call, and dropping it made the record of the turn
      // disagree with what the model actually sent.
      const details = [{ type: 'reasoning.text', text: 'so the answer is 4', index: 0 }]
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Four.' })
        return { reasoningDetails: details }
      })

      const { trajectory } = await generate()

      expect(trajectory).toEqual([
        { role: 'assistant', content: 'Four.', reasoning_details: details },
      ])
    })

    it('leaves tool_calls off an entry that made none', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Four.' })
        return {}
      })

      const { trajectory } = await generate()

      expect(trajectory[0]).not.toHaveProperty('tool_calls')
    })

    it('separates the thinking on either side of a tool call', async () => {
      // Thinking restarts after every tool result. Run together, the panel
      // reads as one thought that changed its mind mid-sentence.
      const restore = await withTools()
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ reasoning: 'I should roll for this.' })
          return {
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'roll_dice', arguments: '{}' } },
            ],
          }
        })
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ reasoning: 'A four. Low.' })
          callback({ content: 'You rolled a four.' })
          return {}
        })

      const { reasoning } = await generate()

      expect(reasoning).toBe('I should roll for this.\n\nA four. Low.')
      restore()
    })

    describe('across rounds', () => {
      let now
      let restore
      beforeEach(async () => {
        now = 0
        vi.spyOn(Date, 'now').mockImplementation(() => now)
        restore = await withTools()
      })
      afterEach(() => {
        vi.mocked(Date.now).mockRestore()
        restore()
      })

      const rollCall = {
        toolCalls: [
          { id: 'call_1', type: 'function', function: { name: 'roll_dice', arguments: '{}' } },
        ],
      }

      it('adds up the time thought in every round', async () => {
        const tools = await import('@/ai/tools/index.js')
        tools.executeTool.mockImplementation(async () => {
          now = 5000
          return { tool_call_id: 'call_1', content: '{"total":4}' }
        })
        mockAIService.generateChatCompletion
          .mockImplementationOnce(async (m, p, callback) => {
            now = 1000
            callback({ reasoning: 'I should roll for this.' })
            now = 2000
            return rollCall
          })
          .mockImplementationOnce(async (m, p, callback) => {
            // Taking in the result before the first thought counts: it is
            // the wait the writer sat through.
            now = 8000
            callback({ reasoning: 'A four. Low.' })
            now = 9000
            callback({ content: 'You rolled a four.' })
            return {}
          })

        const { timing } = await generate()

        // 0 to 2000, then 5000 to 9000; not the 3000s from the start to the
        // tool call, and not the 9000 from the start to the answer.
        expect(timing.thinkingTime).toBe(6000)
      })

      it('says which calls the model is taking in, and since when', async () => {
        const composable = useAIChat(mockStoryId, mockChatId)
        const tools = await import('@/ai/tools/index.js')
        tools.executeTool.mockImplementation(async () => {
          now = 5000
          return { tool_call_id: 'call_1', content: '{"total":4}' }
        })
        const seen = []
        mockAIService.generateChatCompletion
          .mockImplementationOnce(async () => {
            seen.push({ ...composable.activity.value })
            return rollCall
          })
          .mockImplementationOnce(async (m, p, callback) => {
            seen.push({ ...composable.activity.value })
            callback({ content: 'You rolled a four.' })
            return {}
          })
        mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
        mockChatsApi.addMessage
          .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
          .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

        await composable.sendMessage('Hello')

        // Nothing to name before the first call; after it, the calls whose
        // results the request carries, timed from when it went out.
        expect(seen[0]).toEqual({ messageId: 'msg_assistant', phase: 'waiting', since: 0 })
        expect(seen[1]).toEqual({
          messageId: 'msg_assistant',
          phase: 'waiting',
          since: 5000,
          calls: [{ name: 'roll_dice', arguments: '{}' }],
        })
      })

      it('says which call the model is writing while it writes it', async () => {
        const composable = useAIChat(mockStoryId, mockChatId)
        let seen
        mockAIService.generateChatCompletion
          .mockImplementationOnce(async (m, p, callback) => {
            callback({
              content: '',
              reasoning: null,
              toolCalls: [{ id: 'call_1', name: 'roll_dice', arguments: '{"notation": "2d' }],
            })
            seen = { ...composable.activity.value }
            return rollCall
          })
          .mockImplementationOnce(async (m, p, callback) => {
            callback({ content: 'Four.' })
            return {}
          })
        mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
        mockChatsApi.addMessage
          .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
          .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

        await composable.sendMessage('Hello')

        expect(seen).toEqual({
          messageId: 'msg_assistant',
          phase: 'calling',
          since: 0,
          calls: [{ name: 'roll_dice', arguments: '{"notation": "2d' }],
        })
      })

      it('says what the turn is doing, and nothing once it is done', async () => {
        const composable = useAIChat(mockStoryId, mockChatId)
        const seen = []
        const look = () => seen.push(composable.activity.value?.phase ?? null)
        const tools = await import('@/ai/tools/index.js')
        tools.executeTool.mockImplementation(async () => {
          look()
          return { tool_call_id: 'call_1', content: '{"total":4}' }
        })
        mockAIService.generateChatCompletion
          .mockImplementationOnce(async (m, p, callback) => {
            look()
            callback({ reasoning: 'I should roll for this.' })
            look()
            return rollCall
          })
          .mockImplementationOnce(async (m, p, callback) => {
            look()
            callback({ reasoning: 'A four.' })
            look()
            callback({ content: 'You rolled a four.' })
            look()
            return {}
          })
        mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
        mockChatsApi.addMessage
          .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
          .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

        await composable.sendMessage('Hello')

        expect(seen).toEqual([
          'waiting',
          'thinking',
          'running', // the tool
          'waiting', // the model taking in what it returned
          'thinking',
          'writing',
        ])
        expect(composable.activity.value).toBeNull()
      })
    })

    it('runs consecutive chunks of one thought together', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ reasoning: 'Thinking about ' })
        callback({ reasoning: 'the question...' })
        callback({ content: 'Answer' })
        return {}
      })

      const { reasoning } = await generate()

      expect(reasoning).toBe('Thinking about the question...')
    })

    it('stops thinking on a turn that produced no content', async () => {
      // thinkingFinishTime is what clears the "Thinking…" label, and it was
      // only ever stamped by the first content chunk — so a turn cut short
      // mid-thought left the message thinking for good.
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ reasoning: 'Half a thought' })
        return { finishReason: 'cancelled' }
      })

      const { timing } = await generate()

      expect(timing.thinkingFinishTime).toBeGreaterThan(0)
    })

    it('keeps why a turn failed on its answer, with what it had written', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Half a' })
        throw new Error('connection lost')
      })
      const composable = useAIChat(mockStoryId, mockChatId)
      const answer = { id: 'msg_assistant', role: 'assistant', content: '', metadata: null }
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce(answer)
      mockChatsApi.getMessageById.mockImplementation(id =>
        id === 'msg_assistant'
          ? { value: { ...answer, metadata: { model: 'm' } } }
          : { value: null }
      )

      await expect(composable.sendMessage('Hello')).rejects.toMatchObject({
        name: 'AnswerFailedError',
        messageId: 'msg_assistant',
      })

      const last = mockChatsApi.updateMessage.mock.calls
        .filter(([id]) => id === 'msg_assistant')
        .at(-1)
      expect(last[1].metadata).toEqual({ model: 'm', error: 'connection lost' })
    })

    it('reports a failure before there is an answer as it is', async () => {
      mockAIContext().build.mockRejectedValueOnce(new Error('No such chat'))
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage.mockReturnValueOnce({ id: 'msg_user', role: 'user' })

      await expect(composable.sendMessage('Hello')).rejects.toMatchObject({
        name: 'Error',
        message: 'No such chat',
      })
    })

    it('stops thinking on a turn that threw', async () => {
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ reasoning: 'Half a thought' })
        throw new Error('connection lost')
      })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await expect(composable.sendMessage('Hello')).rejects.toThrow('connection lost')

      const streams = mockChatsApi.streamMessageContent.mock.calls.filter(
        ([id]) => id === 'msg_assistant'
      )
      expect(streams.at(-1)?.[3].thinkingFinishTime).toBeGreaterThan(0)
    })
  })

  describe('generating state', () => {
    it('should report generating during title generation', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      // An empty chat triggers title generation before the reply.
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      const seen = []
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        // Sampled once per call: the title round trip, then the reply.
        seen.push(composable.isGenerating.value)
        callback({ content: 'Response' })
        return {}
      })

      await composable.sendMessage('Hello')

      // True for both, so the stop button is offered for the whole wait and
      // not just once the reply starts streaming.
      expect(seen).toEqual([true, true])
      expect(composable.isGenerating.value).toBe(false)
    })

    it('should clear the flag when title generation throws', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      mockAIService.generateChatCompletion
        .mockRejectedValueOnce(new Error('API error'))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Response' })
          return {}
        })

      await composable.sendMessage('Hello')

      expect(composable.isGenerating.value).toBe(false)
    })

    it('should save an edit made while a reply is being written', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      composable.isGenerating.value = true
      mockChatsApi.getMessageById.mockReturnValue({
        value: { id: 'msg_1', segments: [{ type: 'text', content: 'I try the handle.' }] },
      })

      await composable.editCommand('msg_1', null, 'I try the door.')

      expect(mockChatsApi.updateMessage).toHaveBeenCalledWith(
        'msg_1',
        expect.objectContaining({ content: 'I try the door.' })
      )
      // Still the reply's, which is still being written.
      expect(composable.isGenerating.value).toBe(true)
    })

    it('should refuse an edit to the message being written', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      composable.isGenerating.value = true
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [
          { id: 'msg_1', role: 'user' },
          { id: 'msg_2', role: 'assistant' },
        ],
      })
      mockChatsApi.getMessageById.mockReturnValue({
        value: { id: 'msg_2', segments: [{ type: 'text', content: 'The door' }] },
      })

      await expect(composable.editCommand('msg_2', null, 'The window')).rejects.toThrow(
        /still being written/i
      )
      expect(mockChatsApi.updateMessage).not.toHaveBeenCalled()
    })

    it('should refuse an edit that asks the model while a reply is being written', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      composable.isGenerating.value = true
      mockChatsApi.getMessageById.mockReturnValue({
        value: { id: 'msg_1', segments: [{ type: 'text', content: 'I try the handle.' }] },
      })

      await expect(
        composable.editCommand('msg_1', null, 'I try the handle.\n/interpret Is he lying?')
      ).rejects.toThrow(/busy/i)
      expect(mockChatsApi.updateMessage).not.toHaveBeenCalled()
      expect(mockAIService.generateChatCompletion).not.toHaveBeenCalled()
    })
  })

  describe('what a turn changed', () => {
    beforeEach(() => {
      applyEdits.value = 'auto'
      mockDocuments.revertEdit.mockReset().mockImplementation(() => true)
    })

    const edit = (n, documentId = 'doc_1') => ({
      documentId,
      path: `notes/${documentId}`,
      tool: 'edit_document',
      old: `old ${n}`,
      new: `new ${n}`,
    })

    it("keeps what the turn's tools changed on the message", async () => {
      const { hasTools, getEnabledToolDefinitions, executeTool } = await import(
        '@/ai/tools/index.js'
      )
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'edit_document' } },
      ])
      // The tool records through the context it is handed, as the real one does.
      executeTool.mockImplementation(async (call, context) => {
        context.edits?.push(edit(1))
        return { tool_call_id: call.id, content: '{"success":true}' }
      })
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'edit_document', arguments: '{}' },
            },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Changed it.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('Change it')

      const calls = mockChatsApi.updateMessage.mock.calls.filter(([id]) => id === 'msg_assistant')
      expect(calls.at(-1)[1].metadata.documentEdits).toEqual([edit(1)])
    })

    it('keeps a decision the writer made while the turn was still writing', async () => {
      const { hasTools, getEnabledToolDefinitions, executeTool } = await import(
        '@/ai/tools/index.js'
      )
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'edit_document' } },
      ])
      executeTool.mockImplementation(async (call, context) => {
        context.edits?.push({ ...edit(1), id: 'e1', status: 'proposed' })
        return { tool_call_id: call.id, content: '{"proposed":true}' }
      })
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'edit_document', arguments: '{}' },
            },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'I proposed a change.' })
          return {}
        })
      // By the time the turn writes its record, the writer has accepted.
      const accepted = {
        ...edit(1),
        id: 'e1',
        old: 'applied old',
        new: 'applied new',
        status: 'accepted',
      }
      mockChatsApi.getMessageById.mockReturnValue({
        value: { id: 'msg_assistant', metadata: { documentEdits: [accepted] } },
      })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('Change it')

      const calls = mockChatsApi.updateMessage.mock.calls.filter(([id]) => id === 'msg_assistant')
      expect(calls.at(-1)[1].metadata.documentEdits).toEqual([accepted])
    })

    const conversation = () => [
      { id: 'msg_1', role: 'user', content: 'a' },
      { id: 'msg_2', role: 'assistant', content: 'b', metadata: { documentEdits: [edit(1)] } },
      { id: 'msg_3', role: 'user', content: 'c' },
      {
        id: 'msg_4',
        role: 'assistant',
        content: 'd',
        metadata: { documentEdits: [edit(2), edit(3, 'doc_2')] },
      },
    ]

    it('plans a rewind: what goes, and what it touched, newest first', () => {
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: conversation() })
      const plan = useAIChat(mockStoryId, mockChatId).rewindPlan('msg_1')

      expect(plan.messages.map(m => m.id)).toEqual(['msg_2', 'msg_3', 'msg_4'])
      expect(plan.edits).toEqual([edit(3, 'doc_2'), edit(2), edit(1)])
      expect(plan.documents).toEqual([
        { documentId: 'doc_2', path: 'notes/doc_2' },
        { documentId: 'doc_1', path: 'notes/doc_1' },
      ])
    })

    it('rewinds: undoes newest first, drops what came after, and says what it left', () => {
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: conversation() })
      mockDocuments.revertEdit.mockImplementation(e => e.new !== 'new 2')

      const outcome = useAIChat(mockStoryId, mockChatId).rewindTo('msg_1')

      expect(mockDocuments.revertEdit.mock.calls.map(([e]) => e.new)).toEqual([
        'new 3',
        'new 2',
        'new 1',
      ])
      expect(outcome.reverted.map(e => e.new)).toEqual(['new 3', 'new 1'])
      expect(outcome.skipped.map(e => e.new)).toEqual(['new 2'])
      expect(mockChatsApi.truncateMessagesForChat).toHaveBeenCalledWith(mockChatId, 1)
    })

    it('rewinding to the last message changes nothing', () => {
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: conversation() })
      const outcome = useAIChat(mockStoryId, mockChatId).rewindTo('msg_4')
      expect(outcome).toEqual({ reverted: [], skipped: [] })
      expect(mockDocuments.revertEdit).not.toHaveBeenCalled()
    })

    it('leaves a proposal never made, or turned down, out of a rewind', () => {
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [
          { id: 'msg_1', role: 'user', content: 'a' },
          {
            id: 'msg_2',
            role: 'assistant',
            content: 'b',
            metadata: {
              documentEdits: [
                { ...edit(1), status: 'proposed' },
                { ...edit(2), status: 'rejected' },
                { ...edit(3), status: 'accepted' },
                edit(4),
              ],
            },
          },
        ],
      })

      const plan = useAIChat(mockStoryId, mockChatId).rewindPlan('msg_1')
      expect(plan.edits.map(e => e.new)).toEqual(['new 4', 'new 3'])
    })

    it('asks first when the chat says so, and the tools are told', async () => {
      const { hasTools, getEnabledToolDefinitions, executeTool } = await import(
        '@/ai/tools/index.js'
      )
      hasTools.mockReturnValue(true)
      getEnabledToolDefinitions.mockReturnValue([
        { type: 'function', function: { name: 'edit_document' } },
      ])
      executeTool.mockResolvedValue({ tool_call_id: 'call_1', content: '{}' })
      applyEdits.value = 'ask'
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async () => ({
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'edit_document', arguments: '{}' },
            },
          ],
        }))
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Proposed.' })
          return {}
        })

      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      await composable.sendMessage('Change it')

      expect(executeTool.mock.calls.at(-1)[1].propose).toBe(true)
    })

    describe('deciding a proposal', () => {
      const proposed = () => ({ ...edit(1), status: 'proposed' })
      const message = edits => ({
        id: 'msg_2',
        role: 'assistant',
        content: 'b',
        metadata: { usage: { requests: 1 }, documentEdits: edits },
      })

      it('accepts: applies it and records the pair as applied', async () => {
        mockChatsApi.getMessageById.mockReturnValue({ value: message([proposed(), edit(2)]) })
        mockApplyProposal.mockResolvedValue({
          documentId: 'doc_1',
          path: 'notes/doc_1',
          old: 'old',
          new: 'new',
        })

        await useAIChat(mockStoryId, mockChatId).acceptEdit('msg_2', 0)

        expect(mockApplyProposal).toHaveBeenCalledWith(mockStoryId, proposed())
        expect(mockChatsApi.updateMessage).toHaveBeenCalledWith('msg_2', {
          metadata: {
            usage: { requests: 1 },
            documentEdits: [
              {
                documentId: 'doc_1',
                path: 'notes/doc_1',
                tool: 'edit_document',
                old: 'old',
                new: 'new',
                status: 'accepted',
              },
              edit(2),
            ],
          },
        })
      })

      it('accepts nothing when the document has changed since', async () => {
        mockChatsApi.getMessageById.mockReturnValue({ value: message([proposed()]) })
        mockApplyProposal.mockResolvedValue({
          error: 'The passage has changed since this was proposed.',
        })

        await expect(useAIChat(mockStoryId, mockChatId).acceptEdit('msg_2', 0)).rejects.toThrow(
          'changed since'
        )
        expect(mockChatsApi.updateMessage).not.toHaveBeenCalled()
      })

      it('rejects: keeps the record, marked so', () => {
        mockChatsApi.getMessageById.mockReturnValue({ value: message([proposed()]) })

        useAIChat(mockStoryId, mockChatId).rejectEdit('msg_2', 0)

        expect(mockChatsApi.updateMessage).toHaveBeenCalledWith('msg_2', {
          metadata: {
            usage: { requests: 1 },
            documentEdits: [{ ...proposed(), status: 'rejected' }],
          },
        })
      })

      it('has nothing to decide for a change already made or decided', async () => {
        mockChatsApi.getMessageById.mockReturnValue({ value: message([edit(1)]) })
        const composable = useAIChat(mockStoryId, mockChatId)
        await expect(composable.acceptEdit('msg_2', 0)).rejects.toThrow('Nothing is waiting')
        expect(() => composable.rejectEdit('msg_2', 0)).toThrow('Nothing is waiting')
      })
    })

    it("undoes a turn's changes before asking it again", async () => {
      const messages = conversation()
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: messages })
      mockChatsApi.getMessageById.mockReturnValue({ value: messages[3] })
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Again.' })
        return {}
      })

      await useAIChat(mockStoryId, mockChatId).regenerateMessage('msg_4')

      expect(mockDocuments.revertEdit.mock.calls.map(([e]) => e.new)).toEqual(['new 3', 'new 2'])
      expect(mockChatsApi.truncateMessagesForChat).toHaveBeenCalledWith(mockChatId, 4)
      expect(mockChatsApi.beginAlternate).toHaveBeenCalledWith('msg_4')
    })

    describe('selectAlternate', () => {
      /** A conversation ending on a message showing the answer whose changes these are. */
      const showing = (edits, alternate = 0) => [
        { id: 'msg_1', role: 'user', content: 'a' },
        {
          id: 'msg_2',
          role: 'assistant',
          content: 'b',
          alternate,
          metadata: { documentEdits: edits },
        },
      ]

      it('undoes what this answer did and makes what the other did, oldest first', async () => {
        mockChatsApi.getMessagesForChat.mockReturnValue({ value: showing([edit(1)]) })
        mockChatsApi.selectAlternate.mockReturnValue({
          id: 'msg_2',
          role: 'assistant',
          metadata: { documentEdits: [edit(2), edit(3, 'doc_2')] },
        })
        mockDocuments.reapplyEdit.mockImplementation(async e => e.new !== 'new 3')

        const outcome = await useAIChat(mockStoryId, mockChatId).selectAlternate('msg_2', 1)

        expect(mockDocuments.revertEdit.mock.calls.map(([e]) => e.new)).toEqual(['new 1'])
        expect(mockChatsApi.selectAlternate).toHaveBeenCalledWith('msg_2', 1)
        expect(mockDocuments.reapplyEdit.mock.calls.map(([e]) => e.new)).toEqual(['new 2', 'new 3'])
        expect(outcome).toEqual({ skipped: [edit(3, 'doc_2')] })
      })

      it('has nothing to do for the answer already showing', async () => {
        mockChatsApi.getMessagesForChat.mockReturnValue({ value: showing([edit(1)], 1) })

        const outcome = await useAIChat(mockStoryId, mockChatId).selectAlternate('msg_2', 1)

        expect(outcome).toEqual({ skipped: [] })
        expect(mockChatsApi.selectAlternate).not.toHaveBeenCalled()
        expect(mockDocuments.revertEdit).not.toHaveBeenCalled()
      })

      it('turns only the last message', async () => {
        mockChatsApi.getMessagesForChat.mockReturnValue({
          value: [...showing([]), { id: 'msg_3', role: 'user', content: 'c' }],
        })

        await expect(
          useAIChat(mockStoryId, mockChatId).selectAlternate('msg_2', 1)
        ).rejects.toThrow('Only the last message')
      })

      it('waits for an answer being written', async () => {
        mockChatsApi.getMessagesForChat.mockReturnValue({ value: showing([]) })
        const composable = useAIChat(mockStoryId, mockChatId)
        composable.isGenerating.value = true

        await expect(composable.selectAlternate('msg_2', 1)).rejects.toThrow('being written')
      })
    })
  })

  describe('regenerateMessage', () => {
    it('asks the message again in its place, reading the conversation as it stood', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      const messages = [
        { id: 'msg_1', role: 'user', content: 'Hello' },
        { id: 'msg_2', role: 'assistant', content: 'Hi there' },
        { id: 'msg_3', role: 'user', content: 'How are you?' },
      ]

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: messages })
      mockChatsApi.getMessageById.mockReturnValue({ value: messages[1] })

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: 'New response' })
          return {}
        }
      )

      const answered = await composable.regenerateMessage('msg_2')

      // What came after it goes; it stays, emptied, and is written into.
      expect(mockChatsApi.truncateMessagesForChat).toHaveBeenCalledWith(mockChatId, 2)
      expect(mockChatsApi.beginAlternate).toHaveBeenCalledWith('msg_2')
      expect(mockChatsApi.addMessage).not.toHaveBeenCalled()
      expect(mockAIContext().build).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: mockChatId, before: 'msg_2' })
      )
      expect(answered).toBe(messages[1])
      expect(mockChatsApi.streamMessageContent).toHaveBeenCalledWith(
        'msg_2',
        'New response',
        null,
        expect.anything(),
        []
      )
    })

    it('says on the answer why asking again failed, and that it is no longer waiting', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      const messages = [
        { id: 'msg_1', role: 'user', content: 'Hello' },
        { id: 'msg_2', role: 'assistant', content: '', metadata: null },
      ]
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: messages })
      mockChatsApi.getMessageById.mockReturnValue({ value: messages[1] })
      mockAIContext().build.mockRejectedValueOnce(new Error('Document too large'))

      const failure = composable.regenerateMessage('msg_2')

      await expect(failure).rejects.toMatchObject({
        name: 'AnswerFailedError',
        messageId: 'msg_2',
        message: 'Document too large',
      })
      expect(mockChatsApi.updateMessage).toHaveBeenCalledWith('msg_2', {
        metadata: { error: 'Document too large' },
      })
      expect(composable.activity.value).toBeNull()
      expect(composable.isGenerating.value).toBe(false)
    })

    it('asks again only what the assistant said', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [{ id: 'msg_1', role: 'user', content: 'Hello' }],
      })

      await expect(composable.regenerateMessage('msg_1')).rejects.toThrow('Only an answer')
    })

    it('should throw error when message not found', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [] })

      await expect(composable.regenerateMessage('non_existent')).rejects.toThrow(
        'Message not found'
      )
    })
  })

  describe('generateChatTitle', () => {
    it('should generate a short title', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: 'Character Development' })
          return {}
        }
      )

      const title = await composable.generateChatTitle('Help me develop my main character')

      expect(title).toBe('Character Development')
      expect(mockAIService.generateChatCompletion).toHaveBeenCalled()
    })

    it('should clean up title with quotes', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: '"Plot Ideas"' })
          return {}
        }
      )

      const title = await composable.generateChatTitle('I need plot ideas')

      expect(title).toBe('Plot Ideas')
    })

    /** Stream `content` back from the title call and return the title. */
    const titleFrom = async content => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content })
        return {}
      })
      return composable.generateChatTitle('anything')
    }

    it('should strip an inline thinking block', async () => {
      // Local backends stream reasoning in the content channel; the reasoning
      // controls are only sent to OpenRouter, so this has to be handled here.
      expect(await titleFrom('<think>Short and punchy.</think>Plot Ideas')).toBe('Plot Ideas')
    })

    it('should come back empty when the response is nothing but thinking', async () => {
      // Cut off mid-thought, so there is no closing tag and no answer.
      expect(await titleFrom('<think>The user is asking about')).toBe('')
    })

    it('should take the markdown off a title', async () => {
      expect(await titleFrom('## Part 1')).toBe('Part 1')
      expect(await titleFrom('**Not** a *Drill*')).toBe('Not a Drill')
      expect(await titleFrom('Title: `The Lighthouse`')).toBe('The Lighthouse')
    })

    it('should keep only the first line when the model adds commentary', async () => {
      expect(await titleFrom('Plot Ideas\n\nI chose this because it is concise.')).toBe(
        'Plot Ideas'
      )
    })

    it('should use the configured profile rather than a fixed model', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Plot Ideas' })
        return {}
      })

      await composable.generateChatTitle('anything')

      expect(mockAIService.generateChatCompletion.mock.calls[0][1]).toEqual({
        providerId: mockProfile.providerId,
        model: mockProfile.model,
      })
    })

    it('should limit title length', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      const longTitle = 'A'.repeat(150)
      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: longTitle })
          return {}
        }
      )

      const title = await composable.generateChatTitle('Test')

      expect(title.length).toBeLessThanOrEqual(100)
      expect(title.endsWith('...')).toBe(true)
    })

    it('should come back empty on error', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockAIService.generateChatCompletion.mockRejectedValue(new Error('API error'))

      const title = await composable.generateChatTitle('Test')

      expect(title).toBe('')
    })
  })

  describe('naming a chat', () => {
    /** A user turn and an empty answer, for each message sent. */
    const sends = () =>
      mockChatsApi.addMessage.mockImplementation((chatId, role) => ({
        id: `msg_${role}`,
        role,
        content: '',
      }))

    it('names a chat still waiting for a name from what it opened with', async () => {
      mockChatsApi.getChatById.mockReturnValue({ ...mockChat, title: 'Untitled Chat' })
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [
          { id: 'msg_1', role: 'user', content: 'Tell me about the lighthouse' },
          { id: 'msg_2', role: 'assistant', content: '' },
        ],
      })
      sends()
      const asked = []
      mockAIService.generateChatCompletion.mockImplementation(async (messages, p, callback) => {
        asked.push(messages)
        callback({ content: asked.length === 1 ? 'The Lighthouse' : 'Reply' })
        return {}
      })

      await useAIChat(mockStoryId, mockChatId).sendMessage('And the keeper?')

      expect(asked[0].at(-1).content).toContain('Tell me about the lighthouse')
      expect(mockChatsApi.updateChat).toHaveBeenCalledWith(mockChatId, { title: 'The Lighthouse' })
    })

    it('leaves a named chat alone', async () => {
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [{ id: 'msg_1', role: 'user', content: 'Hello' }],
      })
      sends()
      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Reply' })
        return {}
      })

      await useAIChat(mockStoryId, mockChatId).sendMessage('Again')

      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(1)
      expect(mockChatsApi.updateChat).not.toHaveBeenCalled()
    })

    it('starts the reply without waiting for the title', async () => {
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [] })
      sends()
      /** @type {() => void} */
      let finishTitle = () => {}
      let replyAsked = false
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          await new Promise(resolve => (finishTitle = resolve))
          callback({ content: 'Late Title' })
          return {}
        })
        .mockImplementationOnce(async (m, p, callback) => {
          replyAsked = true
          finishTitle()
          callback({ content: 'Reply' })
          return {}
        })

      await useAIChat(mockStoryId, mockChatId).sendMessage('Hello')

      expect(replyAsked).toBe(true)
      expect(mockChatsApi.updateChat).toHaveBeenCalledWith(mockChatId, { title: 'Late Title' })
    })

    it('keeps the name the writer gave it while the title was on its way', async () => {
      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [] })
      sends()
      mockAIService.generateChatCompletion
        .mockImplementationOnce(async (m, p, callback) => {
          mockChatsApi.getChatById.mockReturnValue({ ...mockChat, title: 'Mine' })
          callback({ content: 'Theirs' })
          return {}
        })
        .mockImplementationOnce(async (m, p, callback) => {
          callback({ content: 'Reply' })
          return {}
        })

      await useAIChat(mockStoryId, mockChatId).sendMessage('Hello')

      expect(mockChatsApi.updateChat).not.toHaveBeenCalledWith(mockChatId, { title: 'Theirs' })
    })
  })

  describe('stopGeneration', () => {
    // The tools these turns call, offered: one that was not would be answered
    // without running.
    beforeEach(async () => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(true)
      tools.getEnabledToolDefinitions.mockReturnValue(
        ['search', 'slow', 'edit_document'].map(name => ({ type: 'function', function: { name } }))
      )
    })

    afterEach(async () => {
      const tools = await import('@/ai/tools/index.js')
      tools.hasTools.mockReturnValue(false)
      tools.getEnabledToolDefinitions.mockReturnValue([])
    })

    it('should stop generation and reset state', () => {
      const composable = useAIChat(mockStoryId, mockChatId)
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      composable.isGenerating.value = true
      composable.isThinking.value = true

      composable.stopGeneration()

      expect(consoleSpy).toHaveBeenCalledWith('Stopping chat generation...')
      expect(composable.isGenerating.value).toBe(false)
      expect(composable.isThinking.value).toBe(false)

      consoleSpy.mockRestore()
    })

    /**
     * A turn writing into `msg_a`, held on its request until it is released or
     * its signal aborts it, which rejects the way fetch does.
     */
    const heldTurn = () => {
      /** @type {() => void} */
      let release = () => {}
      /** @type {AbortSignal|undefined} */
      let signal
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [{ id: 'msg_u', role: 'user', content: 'Hello' }],
      })
      mockChatsApi.addMessage.mockReturnValueOnce({ id: 'msg_a', role: 'assistant', content: '' })
      mockChatsApi.getMessageById.mockReturnValue({ value: undefined })
      mockAIService.generateChatCompletion.mockImplementationOnce(
        async (m, p, callback, options) => {
          signal = options.signal
          callback({ content: 'Once upon' })
          await new Promise((resolve, reject) => {
            release = resolve
            options.signal.addEventListener('abort', () => reject(options.signal.reason))
          })
          callback({ content: ' a time' })
          return {}
        }
      )
      return { release: () => release(), signal: () => signal }
    }

    it('finishes the message as it stands, and writes nothing to it after', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const composable = useAIChat(mockStoryId, mockChatId)
      const held = heldTurn()

      const turn = composable.resendMessage('msg_u')
      await vi.waitFor(() => expect(mockChatsApi.streamMessageContent).toHaveBeenCalled())
      const writes = mockChatsApi.streamMessageContent.mock.calls.length
      mockChatsApi.updateMessage.mockClear()
      composable.stopGeneration()

      // Finished there and then, thinking over and no longer streaming.
      expect(held.signal().aborted).toBe(true)
      expect(mockChatsApi.streamMessageContent.mock.calls.at(-1)).toEqual([
        'msg_a',
        'Once upon',
        null,
        expect.objectContaining({ streamingFinishTime: expect.any(Number) }),
        [],
      ])
      expect(composable.isGenerating.value).toBe(false)

      // Stopped is not failed, and the message may be gone by now, deleted
      // or being asked again.
      expect(await turn).toBeNull()
      expect(mockChatsApi.streamMessageContent).toHaveBeenCalledTimes(writes + 1)
      expect(mockChatsApi.updateMessage).not.toHaveBeenCalled()
    })

    it('leaves the chat to the turn that replaced it', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const composable = useAIChat(mockStoryId, mockChatId)
      const first = heldTurn()
      const firstTurn = composable.resendMessage('msg_u')
      await vi.waitFor(() => expect(mockChatsApi.streamMessageContent).toHaveBeenCalled())

      // Sent again while the first is being written: the first stops, and
      // the second asks under a signal of its own.
      const second = heldTurn()
      mockChatsApi.addMessage.mockReset()
      mockChatsApi.addMessage.mockReturnValueOnce({ id: 'msg_b', role: 'assistant', content: '' })
      const secondTurn = composable.resendMessage('msg_u')
      expect(first.signal().aborted).toBe(true)
      await vi.waitFor(() => expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(2))
      expect(second.signal().aborted).toBe(false)

      const toFirst = () =>
        mockChatsApi.streamMessageContent.mock.calls.filter(([id]) => id === 'msg_a').length
      const written = toFirst()
      await firstTurn
      expect(toFirst()).toBe(written)
      expect(composable.isGenerating.value).toBe(true)

      second.release()
      await secondTurn
      expect(composable.isGenerating.value).toBe(false)
    })

    it('stops the calls being run, and runs no further round', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const { executeTool } = await import('@/ai/tools/index.js')
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [{ id: 'msg_u', role: 'user', content: 'Hello' }],
      })
      mockChatsApi.addMessage.mockReturnValueOnce({ id: 'msg_a', role: 'assistant', content: '' })
      mockAIService.generateChatCompletion.mockResolvedValue({
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      })
      /** @type {AbortSignal|undefined} */
      let toolSignal
      executeTool.mockImplementationOnce(async (call, context) => {
        toolSignal = context.signal
        composable.stopGeneration()
        return { found: [] }
      })

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(await composable.resendMessage('msg_u')).toBeNull()

      expect(toolSignal.aborted).toBe(true)
      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(1)
      // Stopped is not failed.
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('failed'), expect.anything())
    })

    it('stops a call that has run out of time, and only that call', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const tools = await import('@/ai/tools/index.js')
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [{ id: 'msg_u', role: 'user', content: 'Hello' }],
      })
      mockChatsApi.addMessage.mockReturnValueOnce({ id: 'msg_a', role: 'assistant', content: '' })
      mockAIService.generateChatCompletion
        .mockResolvedValueOnce({
          toolCalls: [{ id: 'c1', type: 'function', function: { name: 'slow', arguments: '{}' } }],
        })
        .mockResolvedValueOnce({})
      /** @type {AbortSignal|undefined} */
      let toolSignal
      tools.executeTool.mockImplementationOnce((call, context) => {
        toolSignal = context.signal
        return new Promise(() => {})
      })

      vi.useFakeTimers()
      try {
        const turn = composable.resendMessage('msg_u')
        await vi.advanceTimersByTimeAsync(10001)
        await turn
      } finally {
        vi.useRealTimers()
        tools.executeTool.mockReset()
      }

      expect(toolSignal.aborted).toBe(true)
      expect(toolSignal.reason.message).toMatch(/slow timed out/)
      expect(warn).toHaveBeenCalledWith('Tool slow failed:', expect.stringMatching(/timed out/))
      // The turn goes on, with the model told.
      expect(mockAIService.generateChatCompletion).toHaveBeenCalledTimes(2)
      expect(mockAIService.generateChatCompletion.mock.calls[1][3].signal.aborted).toBe(false)
    })

    /**
     * A turn writing into `msg_a` that has said nothing yet, held until its
     * signal aborts it, with the message as the store has it.
     * @param {Object} [message] - What else is on the message
     */
    const silentTurn = (message = {}) => {
      const answer = {
        id: 'msg_a',
        role: 'assistant',
        content: '',
        reasoningContent: null,
        metadata: {},
        ...message,
      }
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [{ id: 'msg_u', role: 'user', content: 'Hello' }, answer],
      })
      mockChatsApi.addMessage.mockReturnValueOnce(answer)
      mockChatsApi.getMessageById.mockReturnValue({ value: answer })
      mockChatsApi.deleteMessage = vi.fn()
      mockChatsApi.dropAlternate = vi.fn()
      /** @type {AbortSignal|undefined} */
      let signal
      mockAIService.generateChatCompletion.mockImplementationOnce(
        async (m, p, callback, options) => {
          signal = options.signal
          await new Promise((_, reject) =>
            options.signal.addEventListener('abort', () => reject(options.signal.reason))
          )
        }
      )
      return { answer, signal: () => signal }
    }

    it('takes away a first answer stopped before it said anything', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const composable = useAIChat(mockStoryId, mockChatId)
      const turn = silentTurn()
      const sent = composable.resendMessage('msg_u')
      await vi.waitFor(() => expect(turn.signal()).toBeDefined())

      expect(await composable.stopGeneration()).toEqual({ skipped: [] })

      expect(mockChatsApi.deleteMessage).toHaveBeenCalledWith('msg_a')
      expect(await sent).toBeNull()
    })

    it('keeps an answer stopped once it has anything in it', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      for (const kept of [
        { content: 'Once upon' },
        { reasoningContent: 'Let me think.' },
        { metadata: { apiTrajectory: [{ role: 'assistant', content: null }] } },
      ]) {
        const composable = useAIChat(mockStoryId, mockChatId)
        silentTurn(kept)
        const sent = composable.resendMessage('msg_u')
        await vi.waitFor(() => expect(composable.activity.value).not.toBeNull())

        await composable.stopGeneration()
        await sent

        expect(mockChatsApi.deleteMessage).not.toHaveBeenCalled()
        expect(mockChatsApi.dropAlternate).not.toHaveBeenCalled()
      }
    })

    it('goes back to the answer asked instead of, on a retry stopped empty', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const composable = useAIChat(mockStoryId, mockChatId)
      const turn = silentTurn({ alternates: [{ content: 'Before.' }, {}], alternate: 1 })
      const edit = {
        documentId: 'doc_1',
        path: 'notes/doc_1',
        tool: 'edit_document',
        old: 'old',
        new: 'new',
      }
      mockChatsApi.dropAlternate.mockReturnValue({
        id: 'msg_a',
        content: 'Before.',
        metadata: { documentEdits: [edit] },
      })
      mockDocuments.reapplyEdit.mockResolvedValueOnce(false)
      const asked = composable.regenerateMessage('msg_a')
      await vi.waitFor(() => expect(turn.signal()).toBeDefined())

      // Its change is made again, where the writer has not been since.
      expect(await composable.stopGeneration()).toEqual({ skipped: [edit] })

      expect(mockChatsApi.dropAlternate).toHaveBeenCalledWith('msg_a')
      expect(mockDocuments.reapplyEdit).toHaveBeenCalledWith(edit)
      expect(mockChatsApi.deleteMessage).not.toHaveBeenCalled()
      await asked
    })

    it('takes nothing away when it stops to ask again', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const composable = useAIChat(mockStoryId, mockChatId)
      const turn = silentTurn()
      const first = composable.resendMessage('msg_u')
      await vi.waitFor(() => expect(turn.signal()).toBeDefined())

      // Asked again: the empty answer is the one being written into.
      mockAIService.generateChatCompletion.mockResolvedValueOnce({})
      await composable.regenerateMessage('msg_a')
      await first

      expect(turn.signal().aborted).toBe(true)
      expect(mockChatsApi.deleteMessage).not.toHaveBeenCalled()
      expect(mockChatsApi.dropAlternate).not.toHaveBeenCalled()
    })

    /**
     * A round of two calls: one that writes and finishes at once, and one
     * still running when `during` is called from inside it. The answer is
     * kept the way the store keeps it, so what is written to it can be read.
     * @param {(composable: any) => any} during
     */
    const roundStoppedPartway = async during => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const tools = await import('@/ai/tools/index.js')
      const composable = useAIChat(mockStoryId, mockChatId)
      const answer = { id: 'msg_a', role: 'assistant', content: '', metadata: {} }
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [{ id: 'msg_u', role: 'user', content: 'Hello' }, answer],
      })
      mockChatsApi.addMessage.mockReturnValueOnce(answer)
      mockChatsApi.getMessageById.mockReturnValue({ value: answer })
      mockChatsApi.updateMessage.mockImplementation((id, updates) => Object.assign(answer, updates))
      mockChatsApi.deleteMessage = vi.fn()
      mockChatsApi.dropAlternate = vi.fn()
      const call = (id, name) => ({ id, type: 'function', function: { name, arguments: '{}' } })
      mockAIService.generateChatCompletion
        .mockResolvedValueOnce({ toolCalls: [call('c1', 'edit_document'), call('c2', 'slow')] })
        .mockResolvedValueOnce({})
      const edit = {
        documentId: 'doc_1',
        path: 'notes/doc_1',
        tool: 'edit_document',
        old: 'a',
        new: 'b',
      }
      /** @type {any} */
      let after
      tools.executeTool.mockImplementation(async (toolCall, context) => {
        if (toolCall.function.name === 'edit_document') {
          context.edits.push(edit)
          return { tool_call_id: toolCall.id, content: '{"success":true}' }
        }
        after = during(composable)
        return new Promise(() => {})
      })
      try {
        await composable.resendMessage('msg_u')
        await after
      } finally {
        tools.executeTool.mockReset()
      }
      return { answer, edit }
    }

    it('keeps on the record what a round stopped partway changed', async () => {
      const { answer, edit } = await roundStoppedPartway(composable => composable.stopGeneration())

      // The write finished beside a call still running; the record has it, and
      // an answer that changed the project is not taken away as empty.
      expect(answer.metadata.documentEdits).toEqual([edit])
      expect(mockChatsApi.deleteMessage).not.toHaveBeenCalled()
    })

    it('undoes what a round stopped partway changed, when it is asked again', async () => {
      const { edit } = await roundStoppedPartway(composable =>
        composable.regenerateMessage('msg_a')
      )

      expect(mockDocuments.revertEdit).toHaveBeenCalledWith(edit)
    })

    it('starts no call once the turn is stopped', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const tools = await import('@/ai/tools/index.js')
      const composable = useAIChat(mockStoryId, mockChatId)
      mockChatsApi.getMessagesForChat.mockReturnValue({
        value: [{ id: 'msg_u', role: 'user', content: 'Hello' }],
      })
      mockChatsApi.addMessage.mockReturnValueOnce({ id: 'msg_a', role: 'assistant', content: '' })
      const call = (id, name) => ({ id, type: 'function', function: { name, arguments: '{}' } })
      mockAIService.generateChatCompletion.mockResolvedValueOnce({
        toolCalls: [call('c1', 'search'), call('c2', 'edit_document')],
      })
      tools.executeTool.mockImplementation(async toolCall => {
        if (toolCall.function.name === 'search') composable.stopGeneration()
        return { tool_call_id: toolCall.id, content: '{}' }
      })
      try {
        await composable.resendMessage('msg_u')
        // The second call was dispatched after the stop, and never ran.
        expect(tools.executeTool).toHaveBeenCalledTimes(1)
      } finally {
        tools.executeTool.mockReset()
      }
    })

    it('stops the answer being written when it is deleted', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      mockChatsApi.deleteMessage = vi.fn()
      const composable = useAIChat(mockStoryId, mockChatId)
      const held = heldTurn()
      const turn = composable.resendMessage('msg_u')
      await vi.waitFor(() => expect(mockChatsApi.streamMessageContent).toHaveBeenCalled())

      composable.removeCommand('msg_a')

      expect(held.signal().aborted).toBe(true)
      expect(mockChatsApi.deleteMessage).toHaveBeenCalledWith('msg_a')
      expect(composable.isGenerating.value).toBe(false)
      await turn
    })

    it('leaves the answer being written alone when another message is deleted', async () => {
      mockChatsApi.deleteMessage = vi.fn()
      const composable = useAIChat(mockStoryId, mockChatId)
      const held = heldTurn()
      const turn = composable.resendMessage('msg_u')
      await vi.waitFor(() => expect(mockChatsApi.streamMessageContent).toHaveBeenCalled())

      composable.removeCommand('msg_older')

      expect(held.signal().aborted).toBe(false)
      expect(composable.isGenerating.value).toBe(true)
      held.release()
      await turn
    })
  })

  describe('system prompt resolution', () => {
    it('should use the default chat prompt', async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: 'Response' })
          return {}
        }
      )

      const { useAIContext } = await import('@/composables/useAIContext')
      const mockContextBuilder = useAIContext()

      await composable.sendMessage('Hello')

      expect(mockContextBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: DEFAULT_CHAT_PROMPT,
        })
      )
    })

    /**
     * Drive one generation and return the systemPrompt the context builder saw.
     * @returns {Promise<string>}
     */
    const capturePromptForActiveProfile = async () => {
      const composable = useAIChat(mockStoryId, mockChatId)

      mockChatsApi.getMessagesForChat.mockReturnValue({ value: [{ id: 'msg_1' }] })
      mockChatsApi.addMessage
        .mockReturnValueOnce({ id: 'msg_user', role: 'user' })
        .mockReturnValueOnce({ id: 'msg_assistant', role: 'assistant', content: '' })

      mockAIService.generateChatCompletion.mockImplementation(async (m, p, callback) => {
        callback({ content: 'Response' })
        return {}
      })

      const { useAIContext } = await import('@/composables/useAIContext')
      const mockContextBuilder = useAIContext()

      await composable.sendMessage('Hello')

      return mockContextBuilder.build.mock.calls.at(-1)[0].systemPrompt
    }

    /** Point the mocked chat record at the given prompt settings. */
    const withChatSettings = settings =>
      mockChatsApi.getChatById.mockReturnValue({ ...mockChat, ...settings })

    /** Put a prompt of the user's own in the mocked library. */
    const withSavedProfile = (id, prompt) =>
      mockSavedProfiles.set(id, { id, name: 'Editor', settings: { prompt }, readOnly: false })

    it('should send the prompt the chat is on, as the library holds it now', async () => {
      withSavedProfile('chatprofile_editor', 'You are a terse editor.')
      withChatSettings({ profileId: 'chatprofile_editor' })

      expect(await capturePromptForActiveProfile()).toBe('You are a terse editor.')
    })

    it('should trim the prompt', async () => {
      withSavedProfile('chatprofile_editor', '\n  You are a terse editor.  \n')
      withChatSettings({ profileId: 'chatprofile_editor' })

      expect(await capturePromptForActiveProfile()).toBe('You are a terse editor.')
    })

    it('should send no instructions when the prompt is empty', async () => {
      withSavedProfile('chatprofile_silent', '')
      withChatSettings({ profileId: 'chatprofile_silent' })

      // The prompt is what the chat runs on even when it says nothing, so an
      // empty one means silence rather than a fall back to the built-in.
      expect(await capturePromptForActiveProfile()).toBe('')
    })

    it('should fall back to the built-in when the chat has no prompt', async () => {
      withChatSettings({ profileId: null })

      expect(await capturePromptForActiveProfile()).toBe(DEFAULT_CHAT_PROMPT)
    })

    it('should follow whichever built-in the chat is pointed at', async () => {
      withChatSettings({ profileId: 'builtin_profile_roleplay' })

      // Built-ins are source rather than data, so a chat that tracks one keeps
      // picking up improvements to it.
      expect(await capturePromptForActiveProfile()).toBe(DEFAULT_ROLEPLAY_PROMPT)
    })

    it("should fall back to the story's built-in when the chat's prompt is gone", async () => {
      mockChatsApi.defaultProfileId.mockReturnValue('builtin_profile_roleplay')
      withChatSettings({ profileId: 'chatprofile_deleted' })

      expect(await capturePromptForActiveProfile()).toBe(DEFAULT_ROLEPLAY_PROMPT)
    })

    it('should send no system prompt at all for a chat on Blank', async () => {
      withChatSettings({ profileId: 'builtin_profile_blank' })

      // Empty, not the default: Blank is the model with nothing in front of it.
      expect(await capturePromptForActiveProfile()).toBe('')
    })

    it('should run a chat on a built-in the app no longer ships under the default', async () => {
      // The Adventure profile was a built-in until it was retired; its chats
      // go on, under the Default prompt.
      withChatSettings({ profileId: 'builtin_profile_adventure' })

      expect(await capturePromptForActiveProfile()).toBe(DEFAULT_CHAT_PROMPT)
    })

    it('should wait for the library to load before reading the prompt', async () => {
      // The saved prompt only turns up once loading finishes; reading early
      // would find the built-ins alone and quietly send the wrong prompt.
      mockProfilesReady.mockImplementationOnce(async () => {
        withSavedProfile('chatprofile_late', 'Loaded in time.')
      })
      withChatSettings({ profileId: 'chatprofile_late' })

      expect(await capturePromptForActiveProfile()).toBe('Loaded in time.')
    })

    it('should ignore a prompt left on the AI preset', async () => {
      // A preset is what the request runs on, not how the chat is run; a stale
      // copy left on one must not win.
      mockAIConfig.activeAIPreset.value = {
        ...mockProfile,
        systemPrompt: 'Stale profile prompt.',
      }

      expect(await capturePromptForActiveProfile()).toBe(DEFAULT_CHAT_PROMPT)
    })

    it('should not push any story context; the document tools carry it', async () => {
      await capturePromptForActiveProfile()
      const { useAIContext } = await import('@/composables/useAIContext')
      const opts = useAIContext().build.mock.calls.at(-1)[0]

      expect(opts.systemPrompt).toBe(DEFAULT_CHAT_PROMPT)
      expect(opts.documentId).toBeUndefined()
    })

    /** Drive one generation and return the author's note the builder saw. */
    const captureNote = async () => {
      await capturePromptForActiveProfile()
      const { useAIContext } = await import('@/composables/useAIContext')
      return useAIContext().build.mock.calls.at(-1)[0].note
    }

    it("should send the chat's author's note", async () => {
      withChatSettings({ rules: 'Never write for the player.' })

      expect(await captureNote()).toBe('Never write for the player.')
    })

    it('should send it as the profile the chat runs on reads it', async () => {
      // Started on Roleplay, and run on Roleplay (NSFW) since the switch was
      // turned on: the opt-ins are in the NSFW one's note. See noteOnProfile.
      withChatSettings({ profileId: 'builtin_profile_roleplay_nsfw', rules: DEFAULT_ROLEPLAY_NOTE })

      expect(await captureNote()).toBe(DEFAULT_ROLEPLAY_NSFW_NOTE)
    })
  })
})
