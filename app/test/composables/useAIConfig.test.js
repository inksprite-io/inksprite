import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIConfig } from '@/composables/useAIConfig'
import { BUILT_IN_PROVIDERS } from '@/ai/providers.js'
import { useApplicationState } from '@/composables/useApplicationState'
import db from '@/stores/db'

// Mock the database module so the stores start empty.
vi.mock('@/stores/db', () => ({
  default: {
    aiProfiles: { toArray: vi.fn().mockResolvedValue([]) },
    aiProviders: { toArray: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

describe('useAIConfig built-in providers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('starts a first install with every built-in, first in the menu and fixed', async () => {
    const aiConfig = useAIConfig()
    aiConfig.createProvider({ name: 'Mine', type: 'generic', endpoint: 'http://box:1234/v1' })
    await aiConfig.init()

    expect(aiConfig.providers.value.map(p => p.name)).toEqual([
      ...BUILT_IN_PROVIDERS.map(entry => entry.name),
      'Mine',
    ])
    // `server` is what the app knows of a built-in, not stored on it.
    for (const { id, name, type, endpoint } of BUILT_IN_PROVIDERS) {
      expect(aiConfig.getProvider(id)).toMatchObject({ id, name, type, endpoint, isDefault: true })
    }
  })

  it('adds the built-ins an install is missing and leaves the rest as the writer has them', async () => {
    // An install from before there were any but OpenRouter, with its key in.
    db.aiProviders.toArray.mockResolvedValueOnce([
      {
        id: 'provider_openrouter_default',
        name: 'OpenRouter',
        type: 'openrouter',
        apiKey: 'sk-or-1',
        isDefault: true,
      },
      {
        id: 'provider_lmstudio_default',
        name: 'LM Studio',
        type: 'generic',
        endpoint: 'http://box:1234/v1',
        isDefault: true,
      },
    ])

    const aiConfig = useAIConfig()
    await aiConfig.init()

    expect(aiConfig.getProvider('provider_openrouter_default').apiKey).toBe('sk-or-1')
    expect(aiConfig.getProvider('provider_lmstudio_default').endpoint).toBe('http://box:1234/v1')
    expect(aiConfig.getProvider('provider_ollama_default').endpoint).toBe(
      'http://localhost:11434/v1'
    )
    expect(aiConfig.providers.value).toHaveLength(BUILT_IN_PROVIDERS.length)
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

    expect(aiConfig.getProvider('provider_kokoro_default').endpoint).toBe('http://box:8880/v1')
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
    expect(aiConfig.getProvider('provider_kokoro_default').apiKey).toBeUndefined()
  })
})

describe('useAIConfig presets', () => {
  /** @type {ReturnType<typeof useAIConfig>} */
  let aiConfig

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    vi.clearAllMocks()

    aiConfig = useAIConfig()
    await aiConfig.init()
  })

  it('starts with a single default preset that is active', () => {
    expect(aiConfig.presets.value).toHaveLength(1)
    expect(aiConfig.activeAIPreset.value.isDefault).toBe(true)
  })

  describe('createPreset', () => {
    it('adds a preset and switches to it', () => {
      const created = aiConfig.createPreset('Local Gemma')

      expect(aiConfig.presets.value).toHaveLength(2)
      expect(aiConfig.activeAIPresetId.value).toBe(created.id)
      expect(created.name).toBe('Local Gemma')
    })

    it('reuses the active preset’s provider', () => {
      const providerId = aiConfig.activeAIPreset.value.providerId

      expect(aiConfig.createPreset().providerId).toBe(providerId)
    })

    it('copies the tuning in use, so it does not have to be re-entered', () => {
      const source = aiConfig.activeAIPreset.value
      aiConfig.updatePreset(source.id, {
        model: 'z-ai/glm-4.6',
        generationOverrides: { maxTokens: 512, parameters: { temperature: 0.2 } },
      })

      const made = aiConfig.createPreset('Another')

      // What somebody reaching for a new preset almost always wants: the same
      // setup pointed at another model.
      expect(made.model).toBe('z-ai/glm-4.6')
      expect(made.generationOverrides).toEqual({
        maxTokens: 512,
        parameters: { temperature: 0.2 },
      })
      expect(aiConfig.activeAIPresetId.value).toBe(made.id)
    })

    it('copies the overrides rather than sharing them', () => {
      const source = aiConfig.activeAIPreset.value
      aiConfig.updatePreset(source.id, { generationOverrides: { maxTokens: 512 } })

      const made = aiConfig.createPreset('Another')
      aiConfig.updatePreset(made.id, { generationOverrides: { maxTokens: 4096 } })

      // Tuning one model must not retune the other.
      expect(aiConfig.getPreset(source.id).generationOverrides).toEqual({ maxTokens: 512 })
    })

    it('copies the providers allowed and ignored for the model, and keeps them its own', () => {
      const source = aiConfig.activeAIPreset.value
      aiConfig.updatePreset(source.id, {
        allowedProviders: ['deepinfra'],
        ignoredProviders: ['novita'],
      })

      const made = aiConfig.createPreset('Another')
      expect(made.allowedProviders).toEqual(['deepinfra'])
      expect(made.ignoredProviders).toEqual(['novita'])

      aiConfig.updatePreset(made.id, { allowedProviders: undefined, ignoredProviders: undefined })
      expect(aiConfig.getPreset(source.id).allowedProviders).toEqual(['deepinfra'])
      expect(aiConfig.getPreset(source.id).ignoredProviders).toEqual(['novita'])
    })

    it('leaves the fields off a copy of a preset that allows any provider and ignores none', () => {
      const made = aiConfig.createPreset('Another')
      expect(made).not.toHaveProperty('allowedProviders')
      expect(made).not.toHaveProperty('ignoredProviders')
    })
  })

  describe('deletePreset', () => {
    it('moves off the preset before deleting it', () => {
      const created = aiConfig.createPreset('Doomed')
      expect(aiConfig.activeAIPresetId.value).toBe(created.id)

      aiConfig.deletePreset(created.id)

      // Never left pointing at a deleted preset.
      expect(aiConfig.activeAIPresetId.value).not.toBe(created.id)
      expect(aiConfig.activeAIPreset.value).not.toBeNull()
      expect(aiConfig.presets.value).toHaveLength(1)
    })

    it('leaves an inactive preset’s selection alone', () => {
      const created = aiConfig.createPreset('Spare')
      const defaultId = aiConfig.presets.value.find(p => p.isDefault).id
      aiConfig.setActiveAIPreset(defaultId)

      aiConfig.deletePreset(created.id)

      expect(aiConfig.activeAIPresetId.value).toBe(defaultId)
    })

    it('refuses to delete the last remaining preset', () => {
      const defaultId = aiConfig.presets.value.find(p => p.isDefault).id

      // Nothing to switch to, so it declines rather than leaving the app
      // pointing at a deleted preset.
      expect(aiConfig.deletePreset(defaultId)).toBe(false)
      expect(aiConfig.presets.value).toHaveLength(1)
    })

    it('refuses to delete the default preset even when others exist', () => {
      const defaultId = aiConfig.presets.value.find(p => p.isDefault).id
      aiConfig.createPreset('Spare')

      expect(() => aiConfig.deletePreset(defaultId)).toThrow(/default preset/i)
    })
  })
})
