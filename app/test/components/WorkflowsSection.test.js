import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import WorkflowsSection from '@/components/writer/settings/WorkflowsSection.vue'
import { REASONING_EFFORT_OPTIONS } from '@/ai/defaults.js'

const state = ref({ convert: {} })
const setWorkflow = vi.fn((name, patch) => {
  state.value = { ...state.value, [name]: { ...state.value[name], ...patch } }
})
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ workflows: computed(() => state.value), setWorkflow }),
}))

const preset = ref(null)
const providers = { p1: { id: 'p1', type: 'openrouter' }, p2: { id: 'p2', type: 'generic' } }
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ activeAIPreset: preset, getProvider: id => providers[id] || null }),
}))

// The selectors fetch providers and models; what matters here is what they are given.
const stub = name => ({
  name,
  props: ['selectedProviderId', 'selectedModelId'],
  template: '<div />',
})

const mountSection = () =>
  mount(WorkflowsSection, {
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: Tooltip },
      stubs: {
        AiProviderSelector: stub('AiProviderSelector'),
        AiModelSelector: stub('AiModelSelector'),
        // Fetches OpenRouter's directory; what matters is what it holds.
        AiAllowedProviders: {
          name: 'AiAllowedProviders',
          props: ['modelValue', 'model'],
          emits: ['update:modelValue'],
          template: '<div />',
        },
      },
    },
  })

describe('WorkflowsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.value = { convert: {} }
    preset.value = {
      providerId: 'p1',
      model: 'glm',
      generationOverrides: { reasoningEffort: 'low' },
    }
  })

  it('starts a role from the active preset: its provider, model, and effort', async () => {
    const wrapper = mountSection()
    await wrapper.vm.$nextTick()

    expect(setWorkflow).toHaveBeenCalledWith('convert', {
      providerId: 'p1',
      model: 'glm',
      reasoningEffort: 'low',
    })
    expect(wrapper.findComponent({ name: 'AiModelSelector' }).props('selectedModelId')).toBe('glm')
  })

  it('takes the providers allowed for the preset’s model with it', () => {
    preset.value = { ...preset.value, allowedProviders: ['deepinfra'] }
    mountSection()

    expect(setWorkflow).toHaveBeenCalledWith(
      'convert',
      expect.objectContaining({ model: 'glm', allowedProviders: ['deepinfra'] })
    )
  })

  it('offers allowed providers for an OpenRouter model, and keeps them the workflow’s', () => {
    state.value = { convert: { providerId: 'p1', model: 'glm', reasoningEffort: 'high' } }
    const wrapper = mountSection()
    const allowed = wrapper.findComponent({ name: 'AiAllowedProviders' })
    expect(allowed.props('model')).toBe('glm')

    allowed.vm.$emit('update:modelValue', ['deepinfra'])

    expect(setWorkflow).toHaveBeenCalledWith('convert', { allowedProviders: ['deepinfra'] })
  })

  it('offers no allowed providers off OpenRouter, where nothing routes', () => {
    state.value = { convert: { providerId: 'p2', model: 'gemma', reasoningEffort: 'high' } }
    const wrapper = mountSection()

    expect(wrapper.findComponent({ name: 'AiAllowedProviders' }).exists()).toBe(false)
  })

  it('takes the app default effort from a preset that sets none', () => {
    preset.value = { providerId: 'p1', model: 'glm' }
    mountSection()

    expect(setWorkflow).toHaveBeenCalledWith(
      'convert',
      expect.objectContaining({ reasoningEffort: 'medium' })
    )
  })

  it('fills in only what a role has not been given', () => {
    state.value = { convert: { providerId: 'p2', model: 'sonnet', reasoningEffort: null } }
    mountSection()

    expect(setWorkflow).toHaveBeenCalledWith('convert', { reasoningEffort: 'low' })

    vi.clearAllMocks()
    state.value = { convert: { providerId: 'p2', model: 'sonnet', reasoningEffort: 'high' } }
    mountSection()
    expect(setWorkflow).not.toHaveBeenCalled()
  })

  it('calls it Reasoning Effort and offers what the AI section offers', () => {
    state.value = { convert: { providerId: 'p2', model: 'sonnet', reasoningEffort: 'high' } }
    const wrapper = mountSection()

    expect(wrapper.text()).toContain('Reasoning Effort')
    expect(wrapper.text()).not.toContain('Thinking')
    const select = wrapper.findComponent({ name: 'Select' })
    expect(select.props('options')).toBe(REASONING_EFFORT_OPTIONS)
    expect(select.props('modelValue')).toBe('high')
    expect(select.props('size')).toBe('small')
  })
})
