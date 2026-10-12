import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AiSamplingGroup from '@/components/writer/settings/ai/AiSamplingGroup.vue'
import CustomSlider from '@/components/writer/settings/ai/CustomSlider.vue'
import { AI_DEFAULTS, resolveAISettings } from '@/ai/defaults.js'

const effective = ref({ ...AI_DEFAULTS })

vi.mock('@/composables/useGenerationSettings', () => ({
  useGenerationSettings: () => ({
    effective,
    isOverridden: () => false,
    isParameterOverridden: () => false,
    setSetting: vi.fn(),
    setParameter: vi.fn(),
    resetSettings: vi.fn(),
    resetParameter: vi.fn(),
  }),
}))

const preset = ref({ id: 'profile_1', providerId: 'local', model: 'qwen' })
const providers = {
  local: { id: 'local', type: 'generic', endpoint: 'http://box:1234/v1' },
  ollama: { id: 'provider_ollama_default', type: 'generic', endpoint: 'http://box:11434/v1' },
  anthropic: { id: 'anthropic', type: 'anthropic' },
}

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ activeAIPreset: preset, getProvider: id => providers[id] || null }),
}))

const listed = ref({})
vi.mock('@/composables/useModelLists', () => ({
  useModelLists: () => ({
    listOf: id => (listed.value[id] ? { models: listed.value[id] } : undefined),
  }),
}))

/** An older Claude, which takes three samplers, but only while it isn't thinking. */
const OLDER_CLAUDE = {
  id: 'claude-haiku-4-5',
  traits: {
    samplers: ['temperature', 'topP', 'topK'],
    reasoning: { optional: true, levels: ['low', 'medium', 'high'] },
  },
}

const mountGroup = () =>
  mount(AiSamplingGroup, {
    global: {
      plugins: [PrimeVue],
      stubs: { ExpandableSection: { template: '<section><slot /></section>' } },
      directives: { tooltip: {} },
    },
  })

/** The sliders shown, by the setting each is named after. */
const sliders = wrapper =>
  Object.fromEntries(
    wrapper.findAllComponents(CustomSlider).map(slider => [slider.props('label'), slider])
  )

describe('AiSamplingGroup', () => {
  beforeEach(() => {
    effective.value = { ...AI_DEFAULTS }
    preset.value = { id: 'profile_1', providerId: 'local', model: 'qwen' }
    listed.value = {}
  })

  it('offers a server we know nothing of every sampler, and the seed', () => {
    const wrapper = mountGroup()

    expect(Object.keys(sliders(wrapper))).toHaveLength(8)
    expect(wrapper.find('[aria-label="Seed"]').exists()).toBe(true)
  })

  it('offers a server only the samplers it reads', () => {
    preset.value = { id: 'profile_1', providerId: 'ollama', model: 'qwen' }

    expect(Object.keys(sliders(mountGroup()))).toEqual([
      'Temperature',
      'Top-P',
      'Frequency penalty',
      'Presence penalty',
    ])
  })

  it('shows nothing for a model that takes no sampler', () => {
    preset.value = { id: 'profile_1', providerId: 'anthropic', model: 'claude-sonnet-5-5' }
    listed.value = { anthropic: [{ id: 'claude-sonnet-5-5', traits: { samplers: [] } }] }

    expect(mountGroup().find('section').exists()).toBe(false)
  })

  it('offers an older Claude its samplers only while reasoning is off', () => {
    preset.value = { id: 'profile_1', providerId: 'anthropic', model: OLDER_CLAUDE.id }
    listed.value = { anthropic: [OLDER_CLAUDE] }

    effective.value = resolveAISettings({ reasoningEffort: 'medium' })
    expect(mountGroup().find('section').exists()).toBe(false)

    effective.value = resolveAISettings({ reasoningEffort: 'disabled' })
    expect(Object.keys(sliders(mountGroup()))).toEqual(['Temperature', 'Top-P', 'Top-K'])
  })

  it('holds Claude’s top-p while a temperature is set, which it takes instead', () => {
    preset.value = { id: 'profile_1', providerId: 'anthropic', model: OLDER_CLAUDE.id }
    listed.value = { anthropic: [OLDER_CLAUDE] }

    effective.value = resolveAISettings({ reasoningEffort: 'disabled' })
    expect(sliders(mountGroup())['Top-P'].props('disabled')).toBe(false)

    effective.value = resolveAISettings({
      reasoningEffort: 'disabled',
      parameters: { temperature: 0.5 },
    })
    const shown = sliders(mountGroup())
    expect(shown['Top-P'].props('disabled')).toBe(true)
    expect(shown.Temperature.props('disabled')).toBe(false)
  })
})
