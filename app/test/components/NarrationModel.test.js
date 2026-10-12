import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import PrimeVue from 'primevue/config'
import NarrationModel from '@/components/writer/narration/NarrationModel.vue'

const lists = ref(/** @type {Record<string, {models: Array<{id: string}>}>} */ ({}))
vi.mock('@/composables/useModelLists', () => ({
  useModelLists: () => ({
    listOf: (id, kind) => (kind === 'speech' ? lists.value[id] : undefined),
  }),
}))

// The selectors fetch providers and models; what matters here is what they are given.
const stub = name => ({
  name,
  props: ['selectedProviderId', 'selectedModelId', 'kind'],
  emits: ['update:selectedProviderId', 'update:selectedModelId'],
  template: '<div />',
})

const mountModel = (choice = { providerId: 'provider_kokoro_default', model: 'kokoro' }) =>
  mount(NarrationModel, {
    props: { choice },
    global: {
      plugins: [PrimeVue],
      stubs: {
        AiProviderSelector: stub('AiProviderSelector'),
        AiModelSelector: stub('AiModelSelector'),
      },
    },
  })

describe('NarrationModel', () => {
  beforeEach(() => {
    lists.value = {}
  })

  it('picks from the connections that speak, and their speech models', () => {
    const wrapper = mountModel()

    expect(wrapper.findComponent({ name: 'AiProviderSelector' }).props()).toMatchObject({
      kind: 'speech',
      selectedProviderId: 'provider_kokoro_default',
    })
    expect(wrapper.findComponent({ name: 'AiModelSelector' }).props()).toMatchObject({
      kind: 'speech',
      selectedProviderId: 'provider_kokoro_default',
      selectedModelId: 'kokoro',
    })
  })

  it('lets the model go with another connection, and keeps it when the same one comes back', () => {
    const wrapper = mountModel()
    const provider = wrapper.findComponent({ name: 'AiProviderSelector' })

    provider.vm.$emit('update:selectedProviderId', 'provider_kokoro_default')
    expect(wrapper.emitted('choose')).toBeUndefined()

    provider.vm.$emit('update:selectedProviderId', 'provider_openrouter_default')
    expect(wrapper.emitted('choose')).toEqual([
      [{ providerId: 'provider_openrouter_default', model: null }],
    ])
  })

  it('chooses the model picked', () => {
    const wrapper = mountModel()
    wrapper.findComponent({ name: 'AiModelSelector' }).vm.$emit('update:selectedModelId', 'tts-1')
    expect(wrapper.emitted('choose')).toEqual([[{ model: 'tts-1' }]])
  })

  it("picks a connection's one model, and only when it has one", async () => {
    const wrapper = mountModel({ providerId: 'provider_kokoro_default', model: null })
    lists.value = { provider_kokoro_default: { models: [{ id: 'kokoro' }] } }
    await Promise.resolve()
    expect(wrapper.emitted('choose')).toEqual([[{ model: 'kokoro' }]])

    const other = mountModel({ providerId: 'provider_openai_default', model: null })
    lists.value = { provider_openai_default: { models: [{ id: 'tts-1' }, { id: 'tts-1-hd' }] } }
    await Promise.resolve()
    expect(other.emitted('choose')).toBeUndefined()
  })
})
