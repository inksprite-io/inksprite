import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIConfig } from '@/composables/useAIConfig'

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
