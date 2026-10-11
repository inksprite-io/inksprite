import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { reactive } from 'vue'
import PrimeVue from 'primevue/config'
import Select from 'primevue/select'
import AiModelSelector from '@/components/writer/settings/ai/AiModelSelector.vue'

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

enableAutoUnmount(afterEach)

describe('AiModelSelector', () => {
  beforeEach(() => {
    listModels.mockReset()
    for (const id of Object.keys(providers)) delete providers[id]
  })

  it('asks a provider with no address for nothing', async () => {
    providers.local = { id: 'local', type: 'generic', endpoint: '' }

    const wrapper = await mountSelector({ selectedProviderId: 'local' })

    expect(listModels).not.toHaveBeenCalled()
    expect(wrapper.findComponent(Select).props('placeholder')).toBe('Set an address first')
    expect(wrapper.find('button[aria-label="Refresh models"]').attributes('disabled')).toBeDefined()
  })

  it('loads the models once the provider is given an address, without a refresh', async () => {
    providers.local = { id: 'local', type: 'generic', endpoint: '' }
    listModels.mockResolvedValue([{ id: 'small', name: 'small' }])
    const wrapper = await mountSelector({ selectedProviderId: 'local' })

    providers.local = { ...providers.local, endpoint: 'http://localhost:8080/v1' }
    await flushPromises()

    expect(listModels).toHaveBeenCalledWith('local')
    expect(wrapper.findComponent(Select).props('options')).toEqual([{ id: 'small', name: 'small' }])
  })

  it('loads them again when the key changes', async () => {
    providers.or = { id: 'or', type: 'openrouter' }
    listModels.mockResolvedValue([])
    await mountSelector({ selectedProviderId: 'or' })
    expect(listModels).toHaveBeenCalledTimes(1)

    providers.or = { ...providers.or, apiKey: 'sk-new' }
    await flushPromises()

    expect(listModels).toHaveBeenCalledTimes(2)
  })

  it('says the list failed to load rather than that there are none', async () => {
    providers.local = { id: 'local', type: 'generic', endpoint: 'http://nowhere/v1' }
    listModels.mockRejectedValue(new Error('Failed to fetch'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const wrapper = await mountSelector({ selectedProviderId: 'local' })

    expect(wrapper.findComponent(Select).props('placeholder')).toBe("Couldn't load models")
  })

  it('keeps the latest answer when an older one arrives after it', async () => {
    providers.local = { id: 'local', type: 'generic', endpoint: 'http://old/v1' }
    /** @type {(models: any[]) => void} */
    let answerOld = () => {}
    listModels.mockReturnValueOnce(new Promise(resolve => (answerOld = resolve)))
    listModels.mockResolvedValueOnce([{ id: 'new', name: 'new' }])
    const wrapper = await mountSelector({ selectedProviderId: 'local' })

    providers.local = { ...providers.local, endpoint: 'http://new/v1' }
    await flushPromises()
    answerOld([{ id: 'old', name: 'old' }])
    await flushPromises()

    expect(wrapper.findComponent(Select).props('options')).toEqual([{ id: 'new', name: 'new' }])
    expect(wrapper.findComponent(Select).props('loading')).toBe(false)
  })
})
