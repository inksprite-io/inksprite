import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import NarrationSection from '@/components/writer/settings/NarrationSection.vue'
import { useApplicationState } from '@/composables/useApplicationState'

const mockClient = vi.hoisted(() => ({ listVoices: vi.fn() }))
vi.mock('@/tts/client.js', async importOriginal => ({
  ...(await importOriginal()),
  listVoices: mockClient.listVoices,
}))

const toast = { error: vi.fn(), success: vi.fn() }
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

const mountSection = () =>
  mount(NarrationSection, { global: { plugins: [PrimeVue], directives: { tooltip: {} } } })

describe('NarrationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    useApplicationState().resetState()
  })

  it("starts on Kokoro's usual address", () => {
    const wrapper = mountSection()
    expect(wrapper.find('[data-tts-endpoint]').element.value).toBe('http://localhost:8880/v1')
    expect(wrapper.find('[data-tts-model]').element.value).toBe('kokoro')
    expect(wrapper.find('[data-tts-key]').element.value).toBe('')
  })

  it('keeps what is typed', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-tts-endpoint]').setValue(' https://api.openai.com/v1 ')
    await wrapper.find('[data-tts-key]').setValue('sk-1')
    await wrapper.find('[data-tts-model]').setValue('tts-1')

    expect(useApplicationState().narration.value).toEqual({
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-1',
      model: 'tts-1',
    })
  })

  it('tests the connection by asking for the voices', async () => {
    mockClient.listVoices.mockResolvedValue(['af_heart', 'af_nicole'])
    const wrapper = mountSection()
    await wrapper.find('[data-action="test-connection"]').trigger('click')
    await Promise.resolve()

    expect(mockClient.listVoices).toHaveBeenCalledWith({
      endpoint: 'http://localhost:8880/v1',
      apiKey: '',
      model: 'kokoro',
    })
    expect(toast.success).toHaveBeenCalledWith('Connected. 2 voices available.')
  })

  it('says when the server could not be reached', async () => {
    mockClient.listVoices.mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = mountSection()
    await wrapper.find('[data-action="test-connection"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(toast.error).toHaveBeenCalledWith(
      'Connection failed. Could not reach the speech server at http://localhost:8880/v1.'
    )
  })
})
