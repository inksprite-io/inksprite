import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import MultiSelect from 'primevue/multiselect'
import AiModelUpstreams from '@/components/writer/settings/ai/AiModelUpstreams.vue'
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
    shownPreset: preset,
    getProvider: id => providers[id] || null,
    updatePreset,
  }),
}))

/** @param {import('@/ai/routing.js').ModelUpstreams} [upstreams] */
async function mountLists(upstreams) {
  const wrapper = mount(AiModelUpstreams, {
    props: { upstreams },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  await flushPromises()
  const [allowed, ignored] = wrapper.findAllComponents(MultiSelect)
  return { wrapper, allowed, ignored }
}

describe('AiModelUpstreams', () => {
  it('shows any provider allowed and none ignored when nothing is set', async () => {
    const { wrapper, allowed, ignored } = await mountLists(undefined)

    expect(allowed.props('modelValue')).toEqual([])
    expect(allowed.props('ariaLabel')).toBe('Allowed providers')
    expect(ignored.props('modelValue')).toEqual([])
    expect(ignored.props('ariaLabel')).toBe('Ignored providers')
    expect(wrapper.find('button[aria-label^="Reset"]').exists()).toBe(false)
  })

  it('emits the list that changed, alone', async () => {
    const { wrapper, allowed, ignored } = await mountLists({ ignoredProviders: ['novita'] })

    expect(ignored.props('modelValue')).toEqual(['novita'])
    allowed.vm.$emit('update:modelValue', ['deepinfra'])
    ignored.vm.$emit('update:modelValue', ['novita', 'deepinfra'])

    expect(wrapper.emitted('update')).toEqual([
      [{ allowedProviders: ['deepinfra'] }],
      [{ ignoredProviders: ['novita', 'deepinfra'] }],
    ])
  })

  it('emits an emptied list as nothing set, so an empty list stores nothing', async () => {
    const { wrapper, allowed, ignored } = await mountLists({
      allowedProviders: ['deepinfra'],
      ignoredProviders: ['novita'],
    })

    allowed.vm.$emit('update:modelValue', null)
    ignored.vm.$emit('update:modelValue', null)
    await wrapper.find('button[aria-label="Reset Allowed providers"]').trigger('click')
    await wrapper.find('button[aria-label="Reset Ignored providers"]').trigger('click')

    expect(wrapper.emitted('update')).toEqual([
      [{ allowedProviders: undefined }],
      [{ ignoredProviders: undefined }],
      [{ allowedProviders: undefined }],
      [{ ignoredProviders: undefined }],
    ])
  })
})

describe('AiPresetGroup provider lists', () => {
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
          AiModelUpstreams: {
            name: 'AiModelUpstreams',
            props: ['upstreams', 'model'],
            emits: ['update'],
            template: '<div />',
          },
        },
      },
    })

  it('keeps them on the preset, beside its model', () => {
    preset.value = {
      id: 'pr1',
      providerId: 'or',
      model: 'glm',
      allowedProviders: ['novita'],
      ignoredProviders: ['together'],
    }
    const lists = mountGroup().findComponent({ name: 'AiModelUpstreams' })

    expect(lists.props('upstreams').allowedProviders).toEqual(['novita'])
    expect(lists.props('upstreams').ignoredProviders).toEqual(['together'])
    expect(lists.props('model')).toBe('glm')
    lists.vm.$emit('update', { allowedProviders: ['deepinfra'] })
    lists.vm.$emit('update', { ignoredProviders: undefined })
    expect(updatePreset).toHaveBeenCalledWith('pr1', { allowedProviders: ['deepinfra'] })
    expect(updatePreset).toHaveBeenCalledWith('pr1', { ignoredProviders: undefined })
  })

  it('offers none off OpenRouter, where nothing routes', () => {
    preset.value = { id: 'pr1', providerId: 'local', model: 'gemma' }

    expect(mountGroup().findComponent({ name: 'AiModelUpstreams' }).exists()).toBe(false)
  })
})
