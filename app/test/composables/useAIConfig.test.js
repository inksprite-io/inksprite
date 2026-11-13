import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'
import db from '@/stores/db'

// Mock the database module so the stores start empty.
vi.mock('@/stores/db', () => ({
  default: {
    aiProfiles: { toArray: vi.fn().mockResolvedValue([]) },
    aiProviders: { toArray: vi.fn().mockResolvedValue([]) },
    chatProfiles: { toArray: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

describe('useAIConfig connections', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('makes no connection of its own on a first start: setup adds the writer’s', async () => {
    const aiConfig = useAIConfig()
    await aiConfig.init()

    expect(aiConfig.providers.value).toEqual([])
  })

  it('keeps the built-ins an install has, in their order, the writer’s after', async () => {
    db.aiProviders.toArray.mockResolvedValueOnce([
      { id: 'provider_mine', name: 'Mine', type: 'generic', endpoint: 'http://box:1234/v1' },
      {
        id: 'provider_lmstudio_default',
        name: 'LM Studio',
        type: 'generic',
        endpoint: 'http://box:1234/v1',
        isDefault: true,
      },
      {
        id: 'provider_openrouter_default',
        name: 'OpenRouter',
        type: 'openrouter',
        apiKey: 'sk-or-1',
        isDefault: true,
      },
    ])
    const aiConfig = useAIConfig()
    await aiConfig.init()

    expect(aiConfig.providers.value.map(p => p.name)).toEqual(['OpenRouter', 'LM Studio', 'Mine'])
    expect(aiConfig.getProvider('provider_openrouter_default').apiKey).toBe('sk-or-1')
  })
})

describe('useAIConfig moving the speech server onto a connection', () => {
  const appState = useApplicationState()

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    appState.resetState()
  })

  /** The application state as a version before this one saved it. */
  const savedBefore = narration => {
    appState.state.value.narration = narration
  }

  it("moves Kokoro's usual address onto the Kokoro connection, with its key", async () => {
    savedBefore({ endpoint: 'http://localhost:8880/v1', apiKey: 'k1', model: 'kokoro' })
    const aiConfig = useAIConfig()
    await aiConfig.init()

    expect(aiConfig.getProvider('provider_kokoro_default')).toMatchObject({
      endpoint: 'http://localhost:8880/v1',
      apiKey: 'k1',
    })
    expect(appState.state.value.narration).toEqual({
      providerId: 'provider_kokoro_default',
      model: 'kokoro',
    })
  })

  it('moves another address onto the Kokoro connection', async () => {
    savedBefore({ endpoint: 'http://box:8880/v1', apiKey: '', model: 'kokoro' })
    const aiConfig = useAIConfig()
    await aiConfig.init()

    expect(aiConfig.getProvider('provider_kokoro_default')).toMatchObject({
      endpoint: 'http://box:8880/v1',
      added: true,
    })
    expect(aiConfig.getProvider('provider_kokoro_default').apiKey).toBeUndefined()
  })

  it("moves OpenAI's address onto the OpenAI connection, leaving a key it has", async () => {
    db.aiProviders.toArray.mockResolvedValueOnce([
      {
        id: 'provider_openai_default',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-chat',
        isDefault: true,
      },
    ])
    savedBefore({ endpoint: 'https://api.openai.com/v1', apiKey: 'sk-speech', model: 'tts-1-hd' })
    const aiConfig = useAIConfig()
    await aiConfig.init()

    expect(aiConfig.getProvider('provider_openai_default').apiKey).toBe('sk-chat')
    expect(appState.narration.value).toEqual({
      providerId: 'provider_openai_default',
      model: 'tts-1-hd',
    })
  })

  it('moves nothing once moved', async () => {
    appState.setNarration({ providerId: 'provider_openrouter_default', model: 'acme/voice' })
    const aiConfig = useAIConfig()
    await aiConfig.init()

    expect(appState.state.value.narration).toEqual({
      providerId: 'provider_openrouter_default',
      model: 'acme/voice',
    })
    expect(aiConfig.getProvider('provider_kokoro_default')).toBeNull()
  })
})

describe("useAIConfig a model's settings", () => {
  /** @type {ReturnType<typeof useAIConfig>} */
  let aiConfig
  const OR = 'provider_openrouter_default'

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    vi.clearAllMocks()
    useApplicationState().resetState()

    aiConfig = useAIConfig()
    await aiConfig.init()
    aiConfig.createProvider({ id: OR, name: 'OpenRouter', type: 'openrouter', apiKey: 'sk-or' })
  })

  it('starts new chats on Sonnet on OpenRouter, where nothing else says', () => {
    expect(aiConfig.startingPreset.value).toMatchObject({
      providerId: OR,
      model: '~anthropic/claude-sonnet-latest',
    })
  })

  it('runs a model never changed on the app’s settings, keeping nothing', () => {
    const run = aiConfig.runOn('p_box', 'qwen')

    expect(run).toMatchObject({ providerId: 'p_box', model: 'qwen', generationOverrides: {} })
    expect(aiConfig.settingsOf('p_box', 'qwen')).toBeNull()
    expect(aiConfig.getPreset(run.id)).toBeNull()
  })

  it('keeps a model’s settings the first time one is changed, and only the change', () => {
    const before = aiConfig.presets.value.length
    aiConfig.changeModelSettings('p_box', 'qwen', {
      generationOverrides: { parameters: { temperature: 0.6 } },
    })

    expect(aiConfig.presets.value).toHaveLength(before + 1)
    expect(aiConfig.runOn('p_box', 'qwen').generationOverrides).toEqual({
      parameters: { temperature: 0.6 },
    })
    // The same model on another connection has settings of its own.
    expect(aiConfig.runOn('p_other', 'qwen').generationOverrides).toEqual({})

    aiConfig.changeModelSettings('p_box', 'qwen', { toolsEnabled: false })
    expect(aiConfig.presets.value).toHaveLength(before + 1)
    expect(aiConfig.runOn('p_box', 'qwen')).toMatchObject({
      toolsEnabled: false,
      generationOverrides: { parameters: { temperature: 0.6 } },
    })
  })

  it('routes a recommended model as it is recommended, until the writer changes it', () => {
    expect(aiConfig.runOn(OR, 'z-ai/glm-5.2')).toMatchObject({
      allowedProviders: ['siliconflow', 'novita'],
      fallbacks: true,
      ignoredProviders: ['alibaba', 'z-ai'],
    })

    aiConfig.changeModelSettings(OR, 'z-ai/glm-5.2', { allowedProviders: [] })
    const run = aiConfig.runOn(OR, 'z-ai/glm-5.2')
    expect(run.allowedProviders).toEqual([])
    expect(run.ignoredProviders).toEqual(['alibaba', 'z-ai'])
    // A model nobody recommends is routed as the connection says.
    expect(aiConfig.runOn(OR, 'acme/other')).not.toHaveProperty('allowedProviders')
  })

  describe('presetFor', () => {
    it('runs a chat on its model, over its profile’s', () => {
      expect(
        aiConfig.presetFor(
          { providerId: 'p_box', model: 'qwen' },
          { settings: { providerId: OR, model: 'm' } }
        )
      ).toMatchObject({ providerId: 'p_box', model: 'qwen' })
    })

    it('runs one that names none on its profile’s, then on what new chats start on', () => {
      expect(
        aiConfig.presetFor({}, { settings: { providerId: 'p_box', model: 'qwen' } }).model
      ).toBe('qwen')
      expect(aiConfig.presetFor({}, { settings: {} }).model).toBe('~anthropic/claude-sonnet-latest')
      expect(aiConfig.presetFor(null, null).model).toBe('~anthropic/claude-sonnet-latest')
    })

    it('no longer reads the preset a chat named before', () => {
      aiConfig.changeModelSettings('p_box', 'qwen', { toolsEnabled: false })
      const stored = aiConfig.settingsOf('p_box', 'qwen')

      expect(aiConfig.presetFor({ presetId: stored.id }, null).model).toBe(
        '~anthropic/claude-sonnet-latest'
      )
    })

    it('starts them on the model of the preset chosen for chats before profiles kept their own', () => {
      aiConfig.changeModelSettings('p_box', 'chosen-model', { toolsEnabled: true })
      useApplicationState().state.value.ai.activeChatProfileId = aiConfig.settingsOf(
        'p_box',
        'chosen-model'
      ).id

      expect(aiConfig.presetFor({}, { settings: {} }).model).toBe('chosen-model')
    })
  })

  describe('mergeDuplicates', () => {
    /** A preset from before, as the store makes it. */
    const old = async (id, model, updated, settings = {}) => {
      const { useAIPresetStore } = await import('@/stores/aiPresetStore')
      const preset = useAIPresetStore().createPreset({
        id,
        name: id,
        providerId: 'p_box',
        model,
        ...settings,
      })
      preset.updated = updated
      return preset
    }

    it('keeps the last changed of the presets on a connection and model, and lets the rest go', async () => {
      await old('preset_a', 'glm', 1, { generationOverrides: { parameters: { temperature: 0.2 } } })
      await old('preset_b', 'glm', 3, { generationOverrides: { parameters: { temperature: 0.9 } } })
      await old('preset_c', 'qwen', 2)

      expect(aiConfig.mergeDuplicates()).toBe(1)

      expect(aiConfig.getPreset('preset_a')).toBeNull()
      expect(aiConfig.runOn('p_box', 'glm').generationOverrides).toEqual({
        parameters: { temperature: 0.9 },
      })
      expect(aiConfig.getPreset('preset_c')).not.toBeNull()
      expect(aiConfig.mergeDuplicates()).toBe(0)
    })

    it('keeps the built-in one in the winner’s place, with the winner’s settings', async () => {
      await old('preset_mine', '~anthropic/claude-sonnet-latest', Date.now() + 1000, {
        generationOverrides: { maxTokens: 900 },
      })
      const { useAIPresetStore } = await import('@/stores/aiPresetStore')
      useAIPresetStore().getPreset('preset_mine').providerId = OR

      aiConfig.mergeDuplicates()

      expect(aiConfig.getPreset('preset_mine')).toBeNull()
      expect(aiConfig.getPreset('profile_default_chat').generationOverrides).toEqual({
        maxTokens: 900,
      })
    })
  })

  it('lets a connection’s model settings go with it, the built-in one kept', () => {
    aiConfig.changeModelSettings('p_box', 'qwen', { toolsEnabled: false })
    aiConfig.forgetModelSettings('p_box')
    aiConfig.forgetModelSettings(OR)

    expect(aiConfig.settingsOf('p_box', 'qwen')).toBeNull()
    expect(aiConfig.getPreset('profile_default_chat')).not.toBeNull()
  })
})
