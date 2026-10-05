import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAISummarize } from '@/composables/useAISummarize'
import summarizePrompt from '@/ai/prompts/summarize.md?raw'
import summarizeUserPrompt from '@/ai/prompts/summarize-user.md?raw'

const DEFAULT_SUMMARIZE_PROMPT = summarizePrompt.trim()
const DEFAULT_SUMMARIZE_USER_PROMPT = summarizeUserPrompt.trim()

// Mock stores
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: vi.fn(),
}))

vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: vi.fn(),
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
}))

vi.mock('@/composables/useAIService', () => ({
  useAIService: vi.fn(),
}))

vi.mock('@/composables/useAIContext', () => ({
  useAIContext: vi.fn(),
}))

// Mock utilities
vi.mock('@/utils/markdown', () => ({
  stripMarkdown: vi.fn(text => {
    // Simple mock that strips markdown
    return text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  }),
}))

describe('useAISummarize', () => {
  let mockAIConfig
  let mockAIService
  let mockAIContext
  let mockDocumentsStore
  let mockStoriesStore

  const mockStoryId = 'story_123'
  const mockSceneId = 'scene_456'

  const mockProfile = {
    id: 'profile_1',
    name: 'Test Write Profile',
    providerId: 'provider_1',
    model: 'gpt-4',
    completionType: 'chat',
    systemPrompt: 'You are a helpful summarization assistant',
  }

  const mockProvider = {
    id: 'provider_1',
    name: 'Test Provider',
    type: 'openrouter',
    apiKey: 'test-api-key',
  }

  const mockScene = {
    id: mockSceneId,
    storyId: mockStoryId,
    title: 'Chapter 1',
    content: 'This is the content of the chapter. It has multiple sentences and paragraphs.',
  }

  beforeEach(async () => {
    // Set up Pinia
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Setup mock AI config
    mockAIConfig = {
      activeAIPreset: { value: mockProfile },
      getProvider: vi.fn().mockReturnValue(mockProvider),
    }

    // Setup mock AI service
    mockAIService = {
      generateChatCompletion: vi.fn(),
    }

    // Setup mock AI context
    const mockContextBuilder = {
      build: vi.fn().mockResolvedValue({
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'User prompt' },
        ],
      }),
    }
    mockAIContext = vi.fn().mockReturnValue(mockContextBuilder)

    // Setup mock scenes store
    mockDocumentsStore = {
      getDocument: vi.fn().mockReturnValue(mockScene),
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
    const { useDocumentsStore } = await import('@/stores/documentsStore')
    const { useStoriesStore } = await import('@/stores/storiesStore')

    useAIConfig.mockReturnValue(mockAIConfig)
    useAIService.mockReturnValue(mockAIService)
    useAIContext.mockImplementation(mockAIContext)
    useDocumentsStore.mockReturnValue(mockDocumentsStore)
    useStoriesStore.mockReturnValue(mockStoriesStore)
  })

  afterEach(() => {
    // Reset singleton state after each test
    const composable = useAISummarize()
    composable.isGenerating.value = false
  })

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const composable = useAISummarize()

      expect(composable.isGenerating.value).toBe(false)
    })
  })

  describe('AI configuration validation', () => {
    it('should throw error when no profile is configured', async () => {
      mockAIConfig.activeAIPreset.value = null
      const composable = useAISummarize()

      await expect(composable.handleSummarize(mockStoryId, mockSceneId)).rejects.toThrow(
        'Set up a provider to use AI features.'
      )
    })

    it('should throw error when provider is not found', async () => {
      mockAIConfig.getProvider.mockReturnValue(null)
      const composable = useAISummarize()

      await expect(composable.handleSummarize(mockStoryId, mockSceneId)).rejects.toThrow(
        'Set up a provider to use AI features.'
      )
    })

    it('should throw error when model is not selected', async () => {
      mockAIConfig.activeAIPreset.value = { ...mockProfile, model: null }
      const composable = useAISummarize()

      await expect(composable.handleSummarize(mockStoryId, mockSceneId)).rejects.toThrow(
        'Select a model in the settings menu.'
      )
    })

    it('should throw error when OpenRouter API key is missing', async () => {
      mockAIConfig.getProvider.mockReturnValue({ ...mockProvider, apiKey: null })
      const composable = useAISummarize()

      await expect(composable.handleSummarize(mockStoryId, mockSceneId)).rejects.toThrow(
        'Enter your OpenRouter API key to use AI features.'
      )
    })

    it('should throw error when generic provider endpoint is missing', async () => {
      mockAIConfig.getProvider.mockReturnValue({
        ...mockProvider,
        type: 'generic',
        endpoint: null,
      })
      const composable = useAISummarize()

      await expect(composable.handleSummarize(mockStoryId, mockSceneId)).rejects.toThrow(
        'You need to provide a provider endpoint in the settings menu.'
      )
    })
  })

  describe('handleSummarize', () => {
    it('should throw error when scene has no content', async () => {
      mockDocumentsStore.getDocument.mockReturnValue({
        ...mockScene,
        content: '',
      })
      const composable = useAISummarize()

      await expect(composable.handleSummarize(mockStoryId, mockSceneId)).rejects.toThrow(
        'No content to summarize. The chapter appears to be empty.'
      )
    })

    it('should throw error when already generating', async () => {
      const composable = useAISummarize()
      composable.isGenerating.value = true

      await expect(composable.handleSummarize(mockStoryId, mockSceneId)).rejects.toThrow(
        "Can't start a new generation while one is in progress."
      )
    })

    describe('chat completion mode', () => {
      it('should generate summary using chat completion', async () => {
        const composable = useAISummarize()

        mockAIService.generateChatCompletion.mockImplementation(
          async (messages, profile, callback) => {
            callback({ content: 'This is ' })
            callback({ content: 'a summary.' })
            return { usage: { promptTokens: 100, completionTokens: 20 } }
          }
        )

        const summary = await composable.handleSummarize(mockStoryId, mockSceneId)

        expect(summary).toBe('This is a summary.')
        expect(mockAIService.generateChatCompletion).toHaveBeenCalled()
        expect(composable.isGenerating.value).toBe(false)
      })

      it('should call onChunk callback for streaming', async () => {
        const composable = useAISummarize()
        const onChunkMock = vi.fn()

        mockAIService.generateChatCompletion.mockImplementation(
          async (messages, profile, callback) => {
            callback({ content: 'Part 1 ' })
            callback({ content: 'Part 2' })
            return {}
          }
        )

        await composable.handleSummarize(mockStoryId, mockSceneId, onChunkMock)

        expect(onChunkMock).toHaveBeenCalledWith('Part 1 ')
        expect(onChunkMock).toHaveBeenCalledWith('Part 2')
      })

      it('should strip markdown from summary', async () => {
        const composable = useAISummarize()

        mockAIService.generateChatCompletion.mockImplementation(
          async (messages, profile, callback) => {
            callback({ content: '**Bold text** and *italic*' })
            return {}
          }
        )

        const summary = await composable.handleSummarize(mockStoryId, mockSceneId)

        // stripMarkdown mock removes ** and *
        expect(summary).toBe('Bold text and italic')
      })
    })

    it('should handle errors during generation', async () => {
      const composable = useAISummarize()

      const error = new Error('API error')
      mockAIService.generateChatCompletion.mockRejectedValue(error)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(composable.handleSummarize(mockStoryId, mockSceneId)).rejects.toThrow(
        'API error'
      )

      expect(consoleSpy).toHaveBeenCalledWith('Failed to generate summary:', error)
      expect(composable.isGenerating.value).toBe(false)

      consoleSpy.mockRestore()
    })

    it('should build context with correct parameters', async () => {
      const composable = useAISummarize()

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: 'Summary' })
          return {}
        }
      )

      const { useAIContext } = await import('@/composables/useAIContext')
      const mockContextBuilder = useAIContext()

      await composable.handleSummarize(mockStoryId, mockSceneId)

      expect(mockContextBuilder.build).toHaveBeenCalledWith({
        mode: 'summarize',
        systemPrompt: DEFAULT_SUMMARIZE_PROMPT,
        userPrompt: DEFAULT_SUMMARIZE_USER_PROMPT,
        documentId: mockSceneId,
      })
    })
  })

  describe('stopGeneration', () => {
    it('should stop generation and reset state', () => {
      const composable = useAISummarize()
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      composable.isGenerating.value = true

      composable.stopGeneration()

      expect(consoleSpy).toHaveBeenCalledWith('Stopping AI generation...')
      expect(composable.isGenerating.value).toBe(false)

      consoleSpy.mockRestore()
    })

    it('aborts its own request and keeps what arrived', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const composable = useAISummarize()
      /** @type {AbortSignal|undefined} */
      let signal
      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback, options) => {
          signal = options.signal
          callback({ content: 'The keeper ' })
          await new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason))
          )
        }
      )

      const summary = composable.handleSummarize(mockStoryId, mockSceneId)
      await vi.waitFor(() => expect(signal).toBeDefined())
      composable.stopGeneration()

      expect(signal.aborted).toBe(true)
      expect(await summary).toBe('The keeper')
      expect(composable.isGenerating.value).toBe(false)
    })
  })

  describe('system prompt resolution', () => {
    it('should use global context prompt (no story overrides for summarize)', async () => {
      const composable = useAISummarize()

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: 'Summary' })
          return {}
        }
      )

      const { useAIContext } = await import('@/composables/useAIContext')
      const mockContextBuilder = useAIContext()

      await composable.handleSummarize(mockStoryId, mockSceneId)

      expect(mockContextBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: DEFAULT_SUMMARIZE_PROMPT,
        })
      )
    })
  })

  describe('singleton behavior', () => {
    it('should share state between multiple instances', async () => {
      const instance1 = useAISummarize()
      const instance2 = useAISummarize()

      // Verify they share the same state refs
      expect(instance1.isGenerating).toBe(instance2.isGenerating)

      mockAIService.generateChatCompletion.mockImplementation(
        async (messages, profile, callback) => {
          callback({ content: 'Summary' })
          return {}
        }
      )

      const promise = instance1.handleSummarize(mockStoryId, mockSceneId)

      // Both instances should see the same generating state
      expect(instance2.isGenerating.value).toBe(true)

      await promise

      expect(instance1.isGenerating.value).toBe(false)
      expect(instance2.isGenerating.value).toBe(false)
    })

    it('should allow stopping generation from any instance', () => {
      const instance1 = useAISummarize()
      const instance2 = useAISummarize()

      instance1.isGenerating.value = true

      instance2.stopGeneration()

      expect(instance1.isGenerating.value).toBe(false)
      expect(instance2.isGenerating.value).toBe(false)
    })
  })
})
