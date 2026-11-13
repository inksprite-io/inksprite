import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import MultiSelect from 'primevue/multiselect'
import ToggleSwitch from 'primevue/toggleswitch'
import AiModelUpstreams from '@/components/writer/settings/ai/AiModelUpstreams.vue'

import OpenRouterProviderSelect from '@/components/writer/settings/ai/OpenRouterProviderSelect.vue'
import NanoGptProviderSelect from '@/components/writer/settings/ai/NanoGptProviderSelect.vue'

vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({
    listOpenRouterProviders: async () => [{ slug: 'deepinfra', name: 'DeepInfra' }],
    listModelProviders: async () => [{ slug: 'deepinfra', name: 'DeepInfra' }],
    listNanoGptProviders: async () => ({
      selectable: true,
      providers: [{ slug: 'deepinfra', name: 'DeepInfra', zdr: true }],
    }),
  }),
}))

/**
 * @param {import('@/ai/routing.js').ModelUpstreams} [upstreams] - What the model routes on
 * @param {Record<string, any>|null} [stored] - The writer's changes
 */
async function mountLists(upstreams, stored = null) {
  const wrapper = mount(AiModelUpstreams, {
    props: { upstreams, stored, model: 'z-ai/glm-5.2' },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  await flushPromises()
  const [preferred, ignored] = wrapper.findAllComponents(MultiSelect)
  return { wrapper, preferred, ignored }
}

describe('AiModelUpstreams', () => {
  it('shows none preferred and none ignored when nothing is set, and no fallback switch', async () => {
    const { wrapper, preferred, ignored } = await mountLists(undefined)

    expect(preferred.props('modelValue')).toEqual([])
    expect(preferred.props('ariaLabel')).toBe('Preferred providers')
    expect(ignored.props('modelValue')).toEqual([])
    expect(wrapper.findComponent(ToggleSwitch).exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Reset"]').exists()).toBe(false)
  })

  it('lets the first ones preferred be fallen back from, and emits the list that changed', async () => {
    const { wrapper, preferred, ignored } = await mountLists({ ignoredProviders: ['novita'] })

    preferred.vm.$emit('update:modelValue', ['deepinfra'])
    ignored.vm.$emit('update:modelValue', ['novita', 'deepinfra'])

    expect(wrapper.emitted('update')).toEqual([
      [{ allowedProviders: ['deepinfra'], fallbacks: true }],
      [{ ignoredProviders: ['novita', 'deepinfra'] }],
    ])
  })

  it('switches falling back to others, beside the preferred ones', async () => {
    const { wrapper } = await mountLists({ allowedProviders: ['deepinfra'], fallbacks: true })

    const fallback = wrapper.findComponent(ToggleSwitch)
    expect(fallback.props('modelValue')).toBe(true)
    fallback.vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('update')).toEqual([[{ fallbacks: false }]])
  })

  it('keeps an emptied list empty, and goes back to what the model starts with on reset', async () => {
    const stored = { allowedProviders: ['deepinfra'], ignoredProviders: ['novita'] }
    const { wrapper, preferred, ignored } = await mountLists(stored, stored)

    preferred.vm.$emit('update:modelValue', null)
    ignored.vm.$emit('update:modelValue', null)
    await wrapper.find('button[aria-label="Reset Preferred providers"]').trigger('click')
    await wrapper.find('button[aria-label="Reset Ignored providers"]').trigger('click')

    expect(wrapper.emitted('update')).toEqual([
      [{ allowedProviders: [] }],
      [{ ignoredProviders: [] }],
      [{ allowedProviders: undefined, fallbacks: undefined }],
      [{ ignoredProviders: undefined }],
    ])
  })

  it('offers OpenRouter’s providers for both lists, unless told the service is NanoGPT', async () => {
    const { wrapper } = await mountLists({ ignoredProviders: ['novita'] })

    const lists = wrapper.findAllComponents(OpenRouterProviderSelect)
    expect(lists.map(one => one.props('label'))).toEqual([
      'Preferred providers',
      'Ignored providers',
    ])
    expect(lists.map(one => one.props('model'))).toEqual(['z-ai/glm-5.2', 'z-ai/glm-5.2'])
    expect(lists[1].props('modelValue')).toEqual(['novita'])
    expect(wrapper.findComponent(NanoGptProviderSelect).exists()).toBe(false)
  })

  describe('on NanoGPT', () => {
    /** @param {Record<string, any>} [props] */
    async function mountNanoGpt(props = {}) {
      const wrapper = mount(AiModelUpstreams, {
        props: { model: 'z-ai/glm-5.2', service: 'nanogpt', ...props },
        global: { plugins: [PrimeVue], directives: { tooltip: {} } },
      })
      await flushPromises()
      const [preferred, ignored] = wrapper.findAllComponents(NanoGptProviderSelect)
      return { wrapper, preferred, ignored }
    }

    it('offers NanoGPT’s providers for both lists', async () => {
      const { wrapper, preferred, ignored } = await mountNanoGpt({
        upstreams: { allowedProviders: ['deepinfra'], ignoredProviders: ['novita'] },
      })

      expect(wrapper.findComponent(OpenRouterProviderSelect).exists()).toBe(false)
      expect(preferred.props()).toMatchObject({
        modelValue: ['deepinfra'],
        model: 'z-ai/glm-5.2',
        label: 'Preferred providers',
        zdrOnly: false,
      })
      expect(ignored.props()).toMatchObject({
        modelValue: ['novita'],
        model: 'z-ai/glm-5.2',
        label: 'Ignored providers',
        zdrOnly: false,
      })
    })

    it('offers both only the providers that keep nothing, where the connection asks that', async () => {
      const { preferred, ignored } = await mountNanoGpt({ zdrOnly: true })

      expect(preferred.props('zdrOnly')).toBe(true)
      expect(ignored.props('zdrOnly')).toBe(true)
    })

    it('keeps the lists as OpenRouter’s are kept, falling back from the first preferred', async () => {
      const { wrapper, preferred, ignored } = await mountNanoGpt()
      expect(wrapper.findComponent(ToggleSwitch).exists()).toBe(false)

      preferred.vm.$emit('update:modelValue', ['deepinfra'])
      ignored.vm.$emit('update:modelValue', ['novita'])

      expect(wrapper.emitted('update')).toEqual([
        [{ allowedProviders: ['deepinfra'], fallbacks: true }],
        [{ ignoredProviders: ['novita'] }],
      ])

      await wrapper.setProps({ upstreams: { allowedProviders: ['deepinfra'], fallbacks: true } })
      expect(wrapper.findComponent(ToggleSwitch).props('modelValue')).toBe(true)
    })
  })
})
