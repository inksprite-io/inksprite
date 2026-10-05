import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed, ref } from 'vue'
import PrimeVue from 'primevue/config'
import ReadAloudButton from '@/components/writer/narration/ReadAloudButton.vue'

const connection = { endpoint: 'http://localhost:8880/v1', apiKey: '', model: 'kokoro' }
const narration = { connection: computed(() => connection), readAloud: vi.fn(async () => {}) }
vi.mock('@/composables/useNarration', () => ({ useNarration: () => narration }))

const speech = { current: ref(null), status: ref('idle'), stop: vi.fn() }
vi.mock('@/composables/useSpeech.js', () => ({ useSpeech: () => speech }))

const toast = { error: vi.fn() }
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

const mountButton = props =>
  mount(ReadAloudButton, {
    props: { storyId: 'story_1', speechKey: 'turn:m1', text: 'Hello there.', ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

describe('ReadAloudButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    speech.current.value = null
    speech.status.value = 'idle'
    narration.readAloud.mockImplementation(async () => {})
  })

  it('reads its text aloud, in the voice it is given', async () => {
    const wrapper = mountButton({ voiceId: 'voice_riley' })
    const button = wrapper.find('[data-action="read-aloud"]')
    expect(button.attributes('aria-label')).toBe('Read aloud')
    expect(button.attributes('aria-pressed')).toBe('false')

    await button.trigger('click')
    expect(narration.readAloud).toHaveBeenCalledWith('turn:m1', 'Hello there.', 'voice_riley')
  })

  it('leaves the voice to the project when it is given none', async () => {
    const wrapper = mountButton()
    await wrapper.find('[data-action="read-aloud"]').trigger('click')
    expect(narration.readAloud).toHaveBeenCalledWith('turn:m1', 'Hello there.', null)
  })

  it('shows that it is the one speaking, and stops when asked', async () => {
    const wrapper = mountButton()
    speech.current.value = 'turn:m1'
    speech.status.value = 'loading'
    await wrapper.vm.$nextTick()

    const button = wrapper.find('[data-action="read-aloud"]')
    expect(button.attributes('aria-label')).toBe('Stop reading')
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(button.find('.pi-spinner').exists()).toBe(true)

    speech.status.value = 'speaking'
    await wrapper.vm.$nextTick()
    expect(button.find('.pi-stop-circle').exists()).toBe(true)

    await button.trigger('click')
    expect(speech.stop).toHaveBeenCalled()
    expect(narration.readAloud).not.toHaveBeenCalled()
  })

  it('is not the one speaking when something else is', async () => {
    const wrapper = mountButton()
    speech.current.value = 'turn:m2'
    await wrapper.vm.$nextTick()

    const button = wrapper.find('[data-action="read-aloud"]')
    expect(button.attributes('aria-label')).toBe('Read aloud')
    await button.trigger('click')
    expect(narration.readAloud).toHaveBeenCalled()
    expect(speech.stop).not.toHaveBeenCalled()
  })

  it('says why when it cannot be read', async () => {
    narration.readAloud.mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = mountButton()
    await wrapper.find('[data-action="read-aloud"]').trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith(
      'Could not reach the speech server at http://localhost:8880/v1.'
    )
  })
})
