/* global URLSearchParams */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const config = vi.hoisted(() => ({
  getProvider: vi.fn(),
  updateProvider: vi.fn(),
}))
const connections = vi.hoisted(() => ({ addConnection: vi.fn() }))
const oauth = vi.hoisted(() => ({
  authorizationUrl: vi.fn(),
  exchangeCode: vi.fn(),
  retrieveOAuthParams: vi.fn(),
}))
const browser = vi.hoisted(() => ({ signInInBrowser: vi.fn() }))

vi.mock('@/composables/useAIConfig', () => ({ useAIConfig: () => config }))
vi.mock('@/composables/useConnections.js', () => ({ useConnections: () => connections }))
vi.mock('@/stores/aiProvidersStore', () => ({
  useAIProvidersStore: () => ({ ensureInitialized: async () => {} }),
}))
vi.mock('@/utils/oauth', () => oauth)
vi.mock('@/platform/signIn.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  signInInBrowser: browser.signInInBrowser,
}))

import { useSignIn, signInPath } from '@/composables/useSignIn.js'
import { signInOf } from '@/ai/providers.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('location', { origin: 'https://app.example' })
  oauth.retrieveOAuthParams.mockReturnValue({ verifier: 'v', state: 's' })
  oauth.exchangeCode.mockResolvedValue('sk-new')
  oauth.authorizationUrl.mockResolvedValue('https://service.example/auth?x')
  connections.addConnection.mockImplementation(type => ({ id: `provider_${type}_made` }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete globalThis.__INKSPRITE_DESKTOP__
})

/** @param {Promise<any>} promise */
const settled = async promise => {
  await vi.runAllTimersAsync()
  return promise
}

describe('finish', () => {
  it('trades the code at the service’s own exchange for a key', async () => {
    await settled(useSignIn('nanogpt').finish(new URLSearchParams('code=c&state=s')))

    expect(oauth.exchangeCode).toHaveBeenCalledWith(signInOf('nanogpt'), 'c', 'v')
  })

  it('keeps the key on the connection signed in from', async () => {
    oauth.retrieveOAuthParams.mockReturnValue({ verifier: 'v', state: 's', providerId: 'p_mine' })
    config.getProvider.mockImplementation(id => (id === 'p_mine' ? { id } : null))

    const id = await settled(useSignIn('openrouter').finish(new URLSearchParams('code=c&state=s')))

    expect(id).toBe('p_mine')
    // Signed in on, it is the writer's, whatever it was before.
    expect(config.updateProvider).toHaveBeenCalledWith('p_mine', {
      apiKey: 'sk-new',
      rememberKey: true,
      added: true,
    })
    expect(connections.addConnection).not.toHaveBeenCalled()
  })

  it('makes a connection of the service where none was signed in from, or it has gone', async () => {
    oauth.retrieveOAuthParams.mockReturnValue({ verifier: 'v', state: 's', providerId: 'p_gone' })
    config.getProvider.mockReturnValue(null)

    const id = await settled(useSignIn('nanogpt').finish(new URLSearchParams('code=c&state=s')))

    expect(connections.addConnection).toHaveBeenCalledWith('nanogpt', { apiKey: 'sk-new' })
    expect(id).toBe('provider_nanogpt_made')
  })

  it('refuses a state it did not send', async () => {
    await expect(
      useSignIn('openrouter').finish(new URLSearchParams('code=c&state=other'))
    ).rejects.toThrow('not started here')
    expect(oauth.exchangeCode).not.toHaveBeenCalled()
  })

  it('says which service sent no code', async () => {
    await expect(useSignIn('nanogpt').finish(new URLSearchParams('state=s'))).rejects.toThrow(
      'NanoGPT sent no code to sign in with.'
    )
  })
})

describe('start', () => {
  it('opens a tab in a browser, coming back to this origin, for the connection shown', async () => {
    const open = vi.fn()
    vi.stubGlobal('window', { location: { origin: 'https://app.example' }, open })

    await useSignIn('nanogpt').start({ providerId: 'p_mine' })

    expect(oauth.authorizationUrl).toHaveBeenCalledWith(
      signInOf('nanogpt'),
      'https://app.example/connect/nanogpt',
      'p_mine'
    )
    expect(open).toHaveBeenCalledWith('https://service.example/auth?x', '_blank')
    expect(browser.signInInBrowser).not.toHaveBeenCalled()
  })

  it('in the desktop window, waits in the system browser, finishes, and says so', async () => {
    globalThis.__INKSPRITE_DESKTOP__ = {}
    const postMessage = vi.fn()
    vi.stubGlobal('window', { location: { origin: 'app://inksprite' }, postMessage })
    config.getProvider.mockReturnValue(null)
    browser.signInInBrowser.mockResolvedValue(new URLSearchParams('code=c&state=s'))

    await settled(useSignIn('openrouter').start())

    expect(oauth.authorizationUrl).toHaveBeenCalledWith(
      signInOf('openrouter'),
      'http://localhost:41721/connect/openrouter',
      undefined
    )
    expect(browser.signInInBrowser).toHaveBeenCalledWith(
      'https://service.example/auth?x',
      '/connect/openrouter',
      expect.objectContaining({ signal: expect.anything() })
    )
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'oauth-success', provider: 'openrouter', providerId: 'provider_openrouter_made' },
      'app://inksprite'
    )
  })
})

describe('signInPath', () => {
  it('comes back to a path of the service’s own', () => {
    expect(signInPath('openrouter')).toBe('/connect/openrouter')
    expect(signInPath('nanogpt')).toBe('/connect/nanogpt')
  })
})
