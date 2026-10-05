import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AiProviderSelector from '@/components/writer/settings/ai/AiProviderSelector.vue'

const providers = [
  { id: 'p_openrouter', name: 'OpenRouter', type: 'openrouter', apiKey: '' },
  { id: 'p_keyed', name: 'OpenRouter', type: 'openrouter', apiKey: 'sk-1' },
  { id: 'p_local', name: 'Laptop', type: 'llamacpp', endpoint: '' },
  { id: 'p_server', name: 'Server', type: 'generic', endpoint: 'http://localhost:1234/v1' },
]

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    providers: { value: providers },
    getProvider: id => providers.find(provider => provider.id === id) ?? null,
  }),
}))

vi.mock('@/components/writer/settings/ai/ProviderConfig.vue', () => ({
  default: { name: 'ProviderConfig', props: ['visible'], template: '<div :data-open="visible" />' },
}))

const mountSelector = selectedProviderId =>
  mount(AiProviderSelector, {
    props: { selectedProviderId },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

const status = wrapper => wrapper.find('[data-connection-status]')

describe('AiProviderSelector', () => {
  it('says an OpenRouter connection with no key is not connected, and offers to connect', async () => {
    const wrapper = mountSelector('p_openrouter')

    expect(status(wrapper).attributes('data-gap')).toBe('key')
    expect(status(wrapper).text()).toContain('Not connected')
    expect(status(wrapper).text()).toContain('API key')

    await wrapper.find('[data-action="connect-provider"]').trigger('click')
    expect(wrapper.findComponent({ name: 'ProviderConfig' }).props('visible')).toBe(true)
  })

  it('says a self-hosted connection with no address is not connected', () => {
    const wrapper = mountSelector('p_local')
    expect(status(wrapper).attributes('data-gap')).toBe('endpoint')
    expect(status(wrapper).text()).toContain('address')
  })

  it('says a connection with what it needs is ready, with nothing to connect', () => {
    for (const id of ['p_keyed', 'p_server']) {
      const wrapper = mountSelector(id)
      expect(status(wrapper).attributes('data-gap')).toBe('none')
      expect(status(wrapper).text()).toContain('Ready')
      expect(wrapper.find('[data-action="connect-provider"]').exists()).toBe(false)
    }
  })

  it('shows no status with no connection picked', () => {
    expect(status(mountSelector(null)).exists()).toBe(false)
  })
})
