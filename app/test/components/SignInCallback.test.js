import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SignInCallback from '@/components/oauth/SignInCallback.vue'

/** Finishing a sign-in: the service's type, then what the writer came back with. */
const finish = vi.hoisted(() => vi.fn())
/** Telling the app's other windows, which the tab that started the sign-in is among. */
const tell = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useSignIn.js', () => ({
  useSignIn: type => ({ finish: params => finish(type, params) }),
  tellSignedIn: (...args) => tell(...args),
}))

/** @param {string} service */
const mountCallback = service => mount(SignInCallback, { props: { service } })

describe('SignInCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'close').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState({}, '', '/connect/nanogpt?code=abc&state=xyz')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says it is connecting to NanoGPT while the code is traded for a key', async () => {
    finish.mockReturnValue(new Promise(() => {}))

    const wrapper = mountCallback('nanogpt')
    await flushPromises()

    expect(wrapper.find('h2').text()).toBe('Connecting to NanoGPT…')
    const [type, params] = finish.mock.calls[0]
    expect(type).toBe('nanogpt')
    expect(params.get('code')).toBe('abc')
    expect(params.get('state')).toBe('xyz')
    expect(tell).not.toHaveBeenCalled()
    expect(window.close).not.toHaveBeenCalled()
  })

  it('names the service it is given', async () => {
    finish.mockReturnValue(new Promise(() => {}))
    expect(mountCallback('openrouter').find('h2').text()).toBe('Connecting to OpenRouter…')
  })

  it('tells the tab that started it which connection has the key, and closes', async () => {
    finish.mockResolvedValue('provider_nano')

    const wrapper = mountCallback('nanogpt')
    await flushPromises()

    expect(tell).toHaveBeenCalledWith('nanogpt', 'provider_nano')
    expect(window.close).toHaveBeenCalled()
    // For a tab the browser won't let close itself.
    expect(wrapper.find('h2').text()).toBe('Connected')
    expect(wrapper.text()).toContain('You can close this tab.')
  })

  it('shows the service’s own refusal, and stays open to be read', async () => {
    finish.mockRejectedValue(new Error('NanoGPT sent no code to sign in with.'))

    const wrapper = mountCallback('nanogpt')
    await flushPromises()

    expect(wrapper.find('h2').text()).toBe('Couldn’t connect')
    expect(wrapper.find('.error-message').text()).toBe('NanoGPT sent no code to sign in with.')
    expect(wrapper.text()).toContain('You can close this tab and try again.')
    expect(tell).not.toHaveBeenCalled()
    expect(window.close).not.toHaveBeenCalled()
  })

  it('says something went wrong where the failure says nothing', async () => {
    finish.mockRejectedValue(new Error(''))

    const wrapper = mountCallback('nanogpt')
    await flushPromises()

    expect(wrapper.find('.error-message').text()).toBe('Something went wrong.')
  })
})
