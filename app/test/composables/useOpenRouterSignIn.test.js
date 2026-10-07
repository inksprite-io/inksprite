/* global URLSearchParams */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const service = vi.hoisted(() => ({ exchangeOAuthCode: vi.fn() }))
const config = vi.hoisted(() => ({
  getProvider: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
}))
const oauth = vi.hoisted(() => ({
  initiateOpenRouterOAuth: vi.fn(),
  openRouterAuthorizationUrl: vi.fn(),
  retrieveOAuthParams: vi.fn(),
}))
const browser = vi.hoisted(() => ({ signInInBrowser: vi.fn() }))

vi.mock('@/composables/useAIService', () => ({ useAIService: () => service }))
vi.mock('@/composables/useAIConfig', () => ({ useAIConfig: () => config }))
vi.mock('@/utils/oauth', () => oauth)
vi.mock('@/platform/signIn.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  signInInBrowser: browser.signInInBrowser,
}))

import { useOpenRouterSignIn } from '@/composables/useOpenRouterSignIn.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('location', { origin: 'https://app.example' })
  oauth.retrieveOAuthParams.mockReturnValue({ verifier: 'v', state: 's' })
  service.exchangeOAuthCode.mockResolvedValue('sk-or-new')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete globalThis.__TAURI_INTERNALS__
})

/** @param {Promise<any>} promise */
const settled = async promise => {
  await vi.runAllTimersAsync()
  return promise
}

describe('finish', () => {
  it('trades the code for a key and keeps it on the OpenRouter provider', async () => {
    config.getProvider.mockReturnValue(null)

    const id = await settled(useOpenRouterSignIn().finish(new URLSearchParams('code=c&state=s')))

    expect(id).toBe('provider_openrouter_default')
    expect(service.exchangeOAuthCode).toHaveBeenCalledWith('c', 'v')
    expect(config.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider_openrouter_default', apiKey: 'sk-or-new' })
    )
  })

  it('updates the provider when there is one already', async () => {
    config.getProvider.mockReturnValue({ id: 'provider_openrouter_default' })

    await settled(useOpenRouterSignIn().finish(new URLSearchParams('code=c&state=s')))

    expect(config.updateProvider).toHaveBeenCalledWith('provider_openrouter_default', {
      apiKey: 'sk-or-new',
      rememberKey: true,
    })
  })

  it('refuses a state it did not send', async () => {
    await expect(
      useOpenRouterSignIn().finish(new URLSearchParams('code=c&state=other'))
    ).rejects.toThrow('Invalid state')
    expect(service.exchangeOAuthCode).not.toHaveBeenCalled()
  })
})

describe('start', () => {
  it('opens a tab in a browser, coming back to this origin', async () => {
    await useOpenRouterSignIn().start()

    expect(oauth.initiateOpenRouterOAuth).toHaveBeenCalledWith(
      'https://app.example/connect/openrouter'
    )
    expect(browser.signInInBrowser).not.toHaveBeenCalled()
  })

  it('in the desktop window, waits in the system browser, finishes, and says so', async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    const postMessage = vi.fn()
    vi.stubGlobal('window', { location: { origin: 'tauri://localhost' }, postMessage })
    config.getProvider.mockReturnValue(null)
    oauth.openRouterAuthorizationUrl.mockResolvedValue('https://openrouter.ai/auth?x')
    browser.signInInBrowser.mockResolvedValue(new URLSearchParams('code=c&state=s'))

    await settled(useOpenRouterSignIn().start())

    expect(oauth.openRouterAuthorizationUrl).toHaveBeenCalledWith(
      'http://localhost:41721/connect/openrouter'
    )
    expect(browser.signInInBrowser).toHaveBeenCalledWith(
      'https://openrouter.ai/auth?x',
      '/connect/openrouter',
      expect.objectContaining({ signal: expect.anything() })
    )
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'oauth-success', provider: 'openrouter', providerId: 'provider_openrouter_default' },
      'tauri://localhost'
    )
  })
})
