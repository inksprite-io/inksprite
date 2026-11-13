import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AiProviderSelector from '@/components/writer/settings/ai/AiProviderSelector.vue'
import { providerDoes } from '@/ai/providers.js'

const providers = [
  { id: 'p_openrouter', name: 'OpenRouter', type: 'openrouter', apiKey: '' },
  { id: 'p_keyed', name: 'OpenRouter', type: 'openrouter', apiKey: 'sk-1' },
  { id: 'p_local', name: 'Laptop', type: 'llamacpp', endpoint: '' },
  { id: 'p_server', name: 'Server', type: 'generic', endpoint: 'http://localhost:1234/v1' },
  { id: 'p_anthropic', name: 'Anthropic', type: 'anthropic', apiKey: 'sk-ant' },
  {
    id: 'provider_kokoro_default',
    name: 'Kokoro',
    type: 'generic',
    endpoint: 'http://localhost:8880/v1',
  },
  // A built-in left from before, with nothing of the writer's in it.
  { id: 'provider_ollama_default', name: 'Ollama', type: 'generic', hidden: true },
]

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    providers: { value: providers },
    getProvider: id => providers.find(provider => provider.id === id) ?? null,
  }),
}))

/** How each connection answered last. */
const states = {}
vi.mock('@/composables/useConnections.js', () => ({
  STATE_LABELS: { connected: 'Connected', key: 'Key not accepted', unreachable: "Can't reach it" },
  useConnections: () => ({
    connectionsFor: kind => providers.filter(one => !one.hidden && providerDoes(one, kind)),
    stateOf: id => states[id] ?? null,
  }),
}))

vi.mock('@/components/writer/connections/ConnectionDialog.vue', () => ({
  default: {
    name: 'ConnectionDialog',
    props: ['providerId', 'does', 'kindId'],
    emits: ['close'],
    template: '<div />',
  },
}))

const mountSelector = (selectedProviderId, kind) =>
  mount(AiProviderSelector, {
    props: { selectedProviderId, ...(kind ? { kind } : {}) },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

const status = wrapper => wrapper.find('[data-connection-status]')
const dialog = wrapper => wrapper.findComponent({ name: 'ConnectionDialog' })

describe('AiProviderSelector', () => {
  beforeEach(() => {
    for (const id of Object.keys(states)) delete states[id]
  })

  it('says an OpenRouter connection with no key is not connected, and opens it to connect', async () => {
    const wrapper = mountSelector('p_openrouter')

    expect(status(wrapper).attributes('data-gap')).toBe('key')
    expect(status(wrapper).text()).toContain('Not connected')

    await wrapper.find('[data-action="connect-provider"]').trigger('click')
    expect(dialog(wrapper).props('providerId')).toBe('p_openrouter')
  })

  it('says a self-hosted connection with no address is not connected', () => {
    const wrapper = mountSelector('p_local')
    expect(status(wrapper).attributes('data-gap')).toBe('endpoint')
    expect(status(wrapper).text()).toContain('address')
  })

  it('says how a connection with what it needs answered last, and nothing before it is asked', () => {
    states.p_keyed = 'connected'
    states.p_server = 'unreachable'

    expect(status(mountSelector('p_keyed')).text()).toContain('Connected')
    expect(status(mountSelector('p_server')).text()).toContain("Can't reach it")
    expect(status(mountSelector('p_anthropic')).exists()).toBe(false)
  })

  it('shows no status with no connection picked', () => {
    expect(status(mountSelector(null)).exists()).toBe(false)
  })

  it('lists the writer’s connections that can do the job, and the one picked', () => {
    const listed = (kind, picked = null) =>
      mountSelector(picked, kind)
        .findComponent({ name: 'Select' })
        .props('options')
        .map(provider => provider.id)

    expect(listed()).toEqual(['p_openrouter', 'p_keyed', 'p_local', 'p_server', 'p_anthropic'])
    expect(listed('speech')).toEqual([
      'p_openrouter',
      'p_keyed',
      'p_server',
      'provider_kokoro_default',
    ])
    expect(listed('chat', 'provider_ollama_default')[0]).toBe('provider_ollama_default')
  })

  it('adds a connection, Kokoro to start with for speech, and picks the one made', async () => {
    const wrapper = mountSelector('p_keyed', 'speech')

    await wrapper.find('[data-action="add-connection"]').trigger('click')
    expect(dialog(wrapper).props()).toMatchObject({
      providerId: null,
      does: 'speech',
      kindId: 'kokoro',
    })

    dialog(wrapper).vm.$emit('close', 'p_server')
    await wrapper.vm.$nextTick()
    expect(dialog(wrapper).exists()).toBe(false)
    expect(wrapper.emitted('update:selectedProviderId').at(-1)).toEqual(['p_server'])
  })
})
