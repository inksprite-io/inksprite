import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import MultiSelect from 'primevue/multiselect'
import AiAllowedProviders from '@/components/writer/settings/ai/AiAllowedProviders.vue'
import AiPresetGroup from '@/components/writer/settings/ai/AiPresetGroup.vue'

vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({
    listOpenRouterProviders: async () => [{ slug: 'deepinfra', name: 'DeepInfra' }],
    listModelProviders: async () => [{ slug: 'deepinfra', name: 'DeepInfra' }],
  }),
}))

const preset = { value: null }
const providers = { or: { id: 'or', type: 'openrouter' }, local: { id: 'local', type: 'llamacpp' } }
const updatePreset = vi.fn()
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    activeAIPreset: preset,
    getProvider: id => providers[id] || null,
    updatePreset,
  }),
}))

/** @param {string[]} [modelValue] */
async function mountAllowed(modelValue) {
  const wrapper = mount(AiAllowedProviders, {
    props: { modelValue },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  await flushPromises()
  return wrapper
}

describe('AiAllowedProviders', () => {
  it('shows any provider allowed when nothing is set', async () => {
    const wrapper = await mountAllowed(undefined)

    expect(wrapper.findComponent(MultiSelect).props('modelValue')).toEqual([])
    expect(wrapper.find('button[aria-label="Reset Allowed Providers"]').exists()).toBe(false)
  })

  it('emits the chosen slugs', async () => {
    const wrapper = await mountAllowed(undefined)

    wrapper.findComponent(MultiSelect).vm.$emit('update:modelValue', ['deepinfra'])

    expect(wrapper.emitted('update:modelValue')).toEqual([[['deepinfra']]])
  })

  it('emits an emptied list as nothing set, so allowing any stores nothing', async () => {
    const wrapper = await mountAllowed(['deepinfra'])

    wrapper.findComponent(MultiSelect).vm.$emit('update:modelValue', null)
    await wrapper.find('button[aria-label="Reset Allowed Providers"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[undefined], [undefined]])
  })
})

describe('AiPresetGroup allowed providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mountGroup = () =>
    mount(AiPresetGroup, {
      global: {
        plugins: [PrimeVue],
        stubs: {
          AiPresetSelector: true,
          AiProviderSelector: true,
          AiModelSelector: true,
          AiGenerationGroup: true,
          AiSamplingGroup: true,
          AiAllowedProviders: {
            name: 'AiAllowedProviders',
            props: ['modelValue', 'model'],
            emits: ['update:modelValue'],
            template: '<div />',
          },
        },
      },
    })

  it('keeps them on the preset, beside its model', () => {
    preset.value = { id: 'pr1', providerId: 'or', model: 'glm', allowedProviders: ['novita'] }
    const allowed = mountGroup().findComponent({ name: 'AiAllowedProviders' })

    expect(allowed.props('modelValue')).toEqual(['novita'])
    expect(allowed.props('model')).toBe('glm')
    allowed.vm.$emit('update:modelValue', ['deepinfra'])
    expect(updatePreset).toHaveBeenCalledWith('pr1', { allowedProviders: ['deepinfra'] })
  })

  it('offers none off OpenRouter, where nothing routes', () => {
    preset.value = { id: 'pr1', providerId: 'local', model: 'gemma' }

    expect(mountGroup().findComponent({ name: 'AiAllowedProviders' }).exists()).toBe(false)
  })
})
