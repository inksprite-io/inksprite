import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ProviderConfig from '@/components/writer/settings/ai/ProviderConfig.vue'

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
vi.mock('@/composables/useAIService', () => ({ useAIService: () => ({}) }))
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }))
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

  it('falls back to Untitled Provider when the field is left empty', async () => {
    const wrapper = await mountDialog()
    const input = await typeName(wrapper, '')

    await input.trigger('blur')
    await flushPromises()

    expect(providers.value[0].name).toBe('Untitled Provider')
    expect(input.element.value).toBe('Untitled Provider')
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
