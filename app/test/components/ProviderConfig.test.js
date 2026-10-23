import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Select from 'primevue/select'
import ProviderConfig from '@/components/writer/settings/ai/ProviderConfig.vue'
import { useModelLists } from '@/composables/useModelLists'

const PROVIDER_ID = 'provider_1'

/** The providers as the store holds them: every update swaps in a new object. */
const providers = ref([])
const updateProvider = vi.fn((id, updates) => {
  providers.value = providers.value.map(p => (p.id === id ? { ...p, ...updates } : p))
})

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    providers: computed(() => providers.value),
    updateProvider,
    createProvider: vi.fn(),
    deleteProvider: vi.fn(),
  }),
}))
const listModels = vi.fn()
const validateOpenRouterKey = vi.fn()
vi.mock('@/composables/useAIService', () => ({
  useAIService: () => ({ listModels, validateOpenRouterKey }),
}))
const toastAdd = vi.fn()
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }))
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: vi.fn() }) }))
vi.mock('@/utils/oauth', () => ({ initiateOpenRouterOAuth: vi.fn() }))

/** Mount the dialog open on the writer's provider, with the teleporting Dialog stubbed. */
async function mountDialog() {
  const wrapper = mount(ProviderConfig, {
    props: { visible: true, initialProviderId: PROVIDER_ID },
    global: {
      plugins: [PrimeVue],
      stubs: { Dialog: { template: '<div><slot /></div>' }, ProviderRouting: true },
      directives: { tooltip: {} },
    },
  })
  await flushPromises()
  return wrapper
}

/** Type a whole value into the name field, as keystrokes would leave it. */
async function typeName(wrapper, text) {
  const input = wrapper.find('input[placeholder="Provider name"]')
  await input.setValue(text)
  await flushPromises()
  return input
}

describe('ProviderConfig name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providers.value = [
      { id: PROVIDER_ID, name: 'Local', type: 'generic', endpoint: '', isDefault: false },
    ]
  })

  it('saves the name as it is typed', async () => {
    const wrapper = await mountDialog()

    await typeName(wrapper, 'My Local')

    expect(updateProvider).toHaveBeenLastCalledWith(PROVIDER_ID, { name: 'My Local' })
  })

  it('keeps a trailing space while the writer is still typing', async () => {
    const wrapper = await mountDialog()

    const input = await typeName(wrapper, 'My ')

    expect(input.element.value).toBe('My ')
    expect(providers.value[0].name).toBe('My')
  })

  it('leaves the field empty while the name is being retyped', async () => {
    const wrapper = await mountDialog()

    const input = await typeName(wrapper, '')

    expect(input.element.value).toBe('')
    expect(providers.value[0].name).toBe('Local')
  })

  it('falls back to Untitled provider when the field is left empty', async () => {
    const wrapper = await mountDialog()
    const input = await typeName(wrapper, '')

    await input.trigger('blur')
    await flushPromises()

    expect(providers.value[0].name).toBe('Untitled provider')
    expect(input.element.value).toBe('Untitled provider')
  })

  it('trims the name when the field is left', async () => {
    const wrapper = await mountDialog()
    const input = await typeName(wrapper, ' My ')

    await input.trigger('blur')
    await flushPromises()

    expect(providers.value[0].name).toBe('My')
    expect(input.element.value).toBe('My')
  })
})

describe('ProviderConfig connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks a server what it serves, and says how many models it found', async () => {
    providers.value = [
      {
        id: PROVIDER_ID,
        name: 'Local',
        type: 'generic',
        endpoint: 'http://localhost:1234/v1',
        isDefault: false,
      },
    ]
    listModels.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const wrapper = await mountDialog()

    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    expect(listModels).toHaveBeenCalledWith(PROVIDER_ID, 'chat')
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', detail: 'Connected. 2 models are available.' })
    )
    expect(useModelLists().listOf(PROVIDER_ID)?.models).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('asks a connection that only speaks what it reads aloud with', async () => {
    providers.value = [
      {
        id: 'provider_kokoro_default',
        name: 'Kokoro',
        type: 'generic',
        endpoint: 'http://localhost:8880/v1',
        isDefault: true,
      },
    ]
    listModels.mockResolvedValue([{ id: 'kokoro' }])
    const wrapper = mount(ProviderConfig, {
      props: { visible: true, initialProviderId: 'provider_kokoro_default' },
      global: {
        plugins: [PrimeVue],
        stubs: { Dialog: { template: '<div><slot /></div>' }, ProviderRouting: true },
        directives: { tooltip: {} },
      },
    })
    await flushPromises()

    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    expect(listModels).toHaveBeenCalledWith('provider_kokoro_default', 'speech')
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', detail: 'Connected. 1 model is available.' })
    )
  })

  it('asks nothing as the address is typed, and lets the old list go', async () => {
    providers.value = [
      {
        id: PROVIDER_ID,
        name: 'Local',
        type: 'generic',
        endpoint: 'http://localhost:1234/v1',
        isDefault: false,
      },
    ]
    listModels.mockResolvedValue([{ id: 'a' }])
    const wrapper = await mountDialog()
    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    const field = wrapper.find('#provider-endpoint')
    for (const typed of ['http://localhost:8', 'http://localhost:8080/v1']) {
      await field.setValue(typed)
      await flushPromises()
    }

    expect(providers.value[0].endpoint).toBe('http://localhost:8080/v1')
    expect(listModels).toHaveBeenCalledTimes(1)
    expect(useModelLists().listOf(PROVIDER_ID)).toBeUndefined()
  })

  it('keeps the list when a field is left unchanged', async () => {
    providers.value = [
      {
        id: PROVIDER_ID,
        name: 'Local',
        type: 'generic',
        endpoint: 'http://localhost:1234/v1',
        apiKey: 'sk-1',
        isDefault: false,
      },
    ]
    listModels.mockResolvedValue([{ id: 'a' }])
    const wrapper = await mountDialog()
    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    await wrapper.find('#provider-key').trigger('blur')

    expect(updateProvider).not.toHaveBeenCalled()
    expect(useModelLists().listOf(PROVIDER_ID)?.models).toEqual([{ id: 'a' }])
  })

  it('tries an OpenRouter key, and offers OAuth beside it', async () => {
    providers.value = [
      { id: PROVIDER_ID, name: 'OpenRouter', type: 'openrouter', apiKey: 'sk-or', isDefault: true },
    ]
    validateOpenRouterKey.mockResolvedValue(true)
    const wrapper = await mountDialog()

    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    expect(validateOpenRouterKey).toHaveBeenCalledWith('sk-or')
    expect(wrapper.find('[data-action="oauth"]').text()).toBe('Sign in with OpenRouter')
  })

  it('wants a key from a hosted service before asking it anything', async () => {
    providers.value = [{ id: PROVIDER_ID, name: 'OpenAI', type: 'openai', isDefault: true }]
    const wrapper = await mountDialog()

    // No address to give: it is known.
    expect(wrapper.find('#provider-endpoint').exists()).toBe(false)
    expect(wrapper.find('label[for="provider-key"]').text()).toBe('API key')

    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    expect(listModels).not.toHaveBeenCalled()
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'Enter an API key for OpenAI.' })
    )
  })

  it('asks a hosted service with a key what it serves', async () => {
    providers.value = [
      { id: PROVIDER_ID, name: 'Google Gemini', type: 'gemini', apiKey: 'k', isDefault: true },
    ]
    listModels.mockResolvedValue([{ id: 'gemini-2.5-pro' }])
    const wrapper = await mountDialog()

    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    expect(listModels).toHaveBeenCalledWith(PROVIDER_ID, 'chat')
    expect(validateOpenRouterKey).not.toHaveBeenCalled()
  })

  it('shows a built-in server its address, to change, and leaves the key optional', async () => {
    providers.value = [
      {
        id: PROVIDER_ID,
        name: 'LM Studio',
        type: 'generic',
        endpoint: 'http://localhost:1234/v1',
        isDefault: true,
      },
    ]
    const wrapper = await mountDialog()

    expect(wrapper.find('#provider-endpoint').element.value).toBe('http://localhost:1234/v1')
    expect(wrapper.find('label[for="provider-key"]').text()).toBe('API key (optional)')
    // Its name and type are fixed.
    expect(wrapper.find('#provider-name').exists()).toBe(false)
  })

  it('offers every type in the menu but the ones not offered yet', async () => {
    providers.value = [
      { id: PROVIDER_ID, name: 'Local', type: 'generic', endpoint: '', isDefault: false },
    ]
    const wrapper = await mountDialog()

    const types = wrapper
      .findAllComponents(Select)
      .find(select => select.attributes('id') === 'providerType')
      .props('options')
      .map(option => option.providerType)

    expect(types).toEqual(['openrouter', 'anthropic', 'openai', 'llamacpp', 'generic'])
  })

  it('offers no OAuth for other providers', async () => {
    providers.value = [
      { id: PROVIDER_ID, name: 'Local', type: 'generic', endpoint: '', isDefault: false },
    ]
    const wrapper = await mountDialog()

    expect(wrapper.find('[data-action="oauth"]').exists()).toBe(false)
  })
})

describe('ProviderConfig requests at once', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** @param {Record<string, any>} provider */
  const showing = async provider => {
    providers.value = [{ id: PROVIDER_ID, name: 'Server', isDefault: false, ...provider }]
    return mountDialog()
  }

  it('says what a connection is asked at once when the field is empty', async () => {
    const atHome = await showing({ type: 'generic', endpoint: 'http://localhost:1234/v1' })
    expect(atHome.find('[data-field="concurrency"]').attributes('placeholder')).toBe('1')

    const hosted = await showing({ type: 'openrouter' })
    expect(hosted.find('[data-field="concurrency"]').attributes('placeholder')).toBe('No limit')

    const llama = await showing({ type: 'llamacpp', endpoint: 'http://localhost:9931/v1' })
    expect(llama.find('[data-field="concurrency"]').attributes('placeholder')).toBe('One per slot')
  })

  it('keeps a whole number, and nothing for the default', async () => {
    const wrapper = await showing({ type: 'openrouter' })
    const field = wrapper.find('[data-field="concurrency"]')

    await field.setValue('6')
    await field.trigger('blur')
    expect(updateProvider).toHaveBeenLastCalledWith(PROVIDER_ID, { concurrency: 6 })

    await field.setValue('')
    await field.trigger('blur')
    expect(updateProvider).toHaveBeenLastCalledWith(PROVIDER_ID, { concurrency: undefined })
  })

  it('puts back what was there for anything that is not a whole number from one up', async () => {
    const wrapper = await showing({ type: 'openrouter', concurrency: 3 })
    const field = wrapper.find('[data-field="concurrency"]')
    expect(/** @type {HTMLInputElement} */ (field.element).value).toBe('3')

    for (const typed of ['0', '2.5', 'many']) {
      await field.setValue(typed)
      await field.trigger('blur')
      expect(/** @type {HTMLInputElement} */ (field.element).value).toBe('3')
    }
    expect(updateProvider).not.toHaveBeenCalled()
  })

  it('is not there for a connection that only speaks', async () => {
    providers.value = [
      {
        id: 'provider_kokoro_default',
        name: 'Kokoro',
        type: 'generic',
        endpoint: 'http://localhost:8880/v1',
        isDefault: true,
      },
    ]
    const wrapper = mount(ProviderConfig, {
      props: { visible: true, initialProviderId: 'provider_kokoro_default' },
      global: {
        plugins: [PrimeVue],
        stubs: { Dialog: { template: '<div><slot /></div>' }, ProviderRouting: true },
        directives: { tooltip: {} },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-field="concurrency"]').exists()).toBe(false)
  })
})
