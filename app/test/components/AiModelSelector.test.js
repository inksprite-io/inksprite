import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import PrimeVue from 'primevue/config'
import Select from 'primevue/select'
import AiModelSelector from '@/components/writer/settings/ai/AiModelSelector.vue'
import { useModelLists } from '@/composables/useModelLists'

const listModels = vi.fn()
vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({ listModels }),
}))

/** @type {Record<string, any>} */
const providers = reactive({})
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: id => providers[id] || null }),
}))

vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }))

/** @param {Record<string, any>} props */
async function mountSelector(props) {
  const wrapper = mount(AiModelSelector, {
    props,
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  await flushPromises()
  return wrapper
}

// The lists are app-wide and outlive a test, so each test has providers of
// its own.
let count = 0
/** A provider no test has shown before. */
function provider(fields) {
  const id = `provider_${++count}`
  providers[id] = { id, type: 'generic', endpoint: 'http://localhost:8080/v1', ...fields }
  return id
}

describe('AiModelSelector', () => {
  beforeEach(() => {
    listModels.mockReset()
  })

  it('asks a provider with no address for nothing', async () => {
    const id = provider({ endpoint: '' })

    const wrapper = await mountSelector({ selectedProviderId: id })

    expect(listModels).not.toHaveBeenCalled()
    expect(wrapper.findComponent(Select).props('placeholder')).toBe('Provider not connected')
    expect(wrapper.find('button[aria-label="Refresh models"]').attributes('disabled')).toBeDefined()
  })

  it('asks a hosted service with no key for nothing, but OpenRouter, whose list is public', async () => {
    const openai = provider({ type: 'openai', endpoint: undefined, apiKey: '' })
    const wrapper = await mountSelector({ selectedProviderId: openai })

    expect(listModels).not.toHaveBeenCalled()
    expect(wrapper.findComponent(Select).props('placeholder')).toBe('Provider not connected')

    listModels.mockResolvedValue([{ id: 'z-ai/glm-5.2', name: 'GLM 5.2' }])
    await mountSelector({
      selectedProviderId: provider({ type: 'openrouter', endpoint: undefined, apiKey: '' }),
    })

    expect(listModels).toHaveBeenCalledTimes(1)
  })

  it('asks nothing as an address is typed, and waits for Connect', async () => {
    const id = provider({ endpoint: '' })
    const wrapper = await mountSelector({ selectedProviderId: id })

    for (const typed of ['h', 'ht', 'http://localhost:8080/v1']) {
      providers[id] = { ...providers[id], endpoint: typed }
      await flushPromises()
    }

    expect(listModels).not.toHaveBeenCalled()
    expect(wrapper.findComponent(Select).props('placeholder')).toBe('Provider not connected')
  })

  it('shows the models Connect found', async () => {
    const id = provider({ endpoint: '' })
    listModels.mockResolvedValue([{ id: 'small', name: 'small' }])
    const wrapper = await mountSelector({ selectedProviderId: id })
    providers[id] = { ...providers[id], endpoint: 'http://localhost:8080/v1' }

    await useModelLists().load(id)
    await flushPromises()

    expect(wrapper.findComponent(Select).props('options')).toEqual([{ id: 'small', name: 'small' }])
  })

  it('asks a provider shown for the first time, once for every picker', async () => {
    const id = provider()
    listModels.mockResolvedValue([{ id: 'small', name: 'small' }])

    await mountSelector({ selectedProviderId: id })
    const second = await mountSelector({ selectedProviderId: id })

    expect(listModels).toHaveBeenCalledTimes(1)
    expect(second.findComponent(Select).props('options')).toEqual([{ id: 'small', name: 'small' }])
  })

  it('does not ask again when the key changes', async () => {
    const id = provider({ type: 'openrouter', endpoint: undefined })
    listModels.mockResolvedValue([])
    await mountSelector({ selectedProviderId: id })

    providers[id] = { ...providers[id], apiKey: 'sk-new' }
    await flushPromises()

    expect(listModels).toHaveBeenCalledTimes(1)
  })

  it('says it is not connected once the list is let go', async () => {
    const id = provider()
    listModels.mockResolvedValue([{ id: 'small', name: 'small' }])
    const wrapper = await mountSelector({ selectedProviderId: id })

    useModelLists().forget(id)
    await flushPromises()

    expect(wrapper.findComponent(Select).props('options')).toEqual([])
    expect(wrapper.findComponent(Select).props('placeholder')).toBe('Provider not connected')
    expect(listModels).toHaveBeenCalledTimes(1)
  })

  it('says the list failed to load rather than that there are none', async () => {
    const id = provider({ endpoint: 'http://nowhere/v1' })
    listModels.mockRejectedValue(new Error('Failed to fetch'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const wrapper = await mountSelector({ selectedProviderId: id })

    expect(wrapper.findComponent(Select).props('placeholder')).toBe("Couldn't load models")
  })

  it('lets go of a model the provider no longer serves', async () => {
    const id = provider()
    listModels.mockResolvedValueOnce([{ id: 'small', name: 'small' }])
    listModels.mockResolvedValueOnce([{ id: 'large', name: 'large' }])
    const wrapper = await mountSelector({ selectedProviderId: id, selectedModelId: 'small' })
    expect(wrapper.emitted('update:selectedModelId')).toBeUndefined()

    await wrapper.find('button[aria-label="Refresh models"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:selectedModelId')).toEqual([[null]])
  })

  it('keeps the latest answer when an older one arrives after it', async () => {
    const id = provider()
    /** @type {(models: any[]) => void} */
    let answerOld = () => {}
    listModels.mockReturnValueOnce(new Promise(resolve => (answerOld = resolve)))
    listModels.mockResolvedValueOnce([{ id: 'new', name: 'new' }])
    const wrapper = await mountSelector({ selectedProviderId: id })

    await useModelLists().load(id)
    answerOld([{ id: 'old', name: 'old' }])
    await flushPromises()

    expect(wrapper.findComponent(Select).props('options')).toEqual([{ id: 'new', name: 'new' }])
    expect(wrapper.findComponent(Select).props('loading')).toBe(false)
  })
})
