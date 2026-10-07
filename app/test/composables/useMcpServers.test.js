/* global URLSearchParams */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/stores/db', () => ({
  default: { mcpServers: { toArray: vi.fn(async () => []) } },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const auth = vi.hoisted(() => {
  globalThis.BroadcastChannel = class {
    postMessage() {}
    close() {}
  }
  return { startSignIn: vi.fn(), finishSignIn: vi.fn() }
})
vi.mock('@/mcp/auth.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  startSignIn: auth.startSignIn,
  finishSignIn: auth.finishSignIn,
}))

const browser = vi.hoisted(() => ({ signInInBrowser: vi.fn() }))
vi.mock('@/platform/signIn.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  signInInBrowser: browser.signInInBrowser,
}))

import { useMcpServers } from '@/composables/useMcpServers.js'

const SERVER = 'https://mcp.example/mcp'
const AUTHORIZE = new URL('https://auth.example/authorize?client_id=x')

describe('signIn, in the desktop window', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    globalThis.__TAURI_INTERNALS__ = {}
    auth.startSignIn.mockImplementation(async (url, onRedirect) => {
      onRedirect(AUTHORIZE)
      return 'REDIRECT'
    })
  })

  afterEach(() => {
    delete globalThis.__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  it('signs in through the system browser, with no tab, and finishes in the window', async () => {
    const open = vi.spyOn(window, 'open')
    const params = new URLSearchParams('code=c&state=s')
    browser.signInInBrowser.mockResolvedValue(params)
    auth.finishSignIn.mockResolvedValue({ url: SERVER })

    const outcome = await useMcpServers().signIn(SERVER)

    expect(outcome).toEqual({ signedIn: true })
    expect(open).not.toHaveBeenCalled()
    expect(browser.signInInBrowser).toHaveBeenCalledWith(
      AUTHORIZE,
      '/connect/mcp',
      expect.objectContaining({ signal: expect.anything() })
    )
    expect(auth.finishSignIn).toHaveBeenCalledWith(params)
  })

  it('says why, when the sign-in could not finish', async () => {
    browser.signInInBrowser.mockResolvedValue(new URLSearchParams('error=access_denied'))
    auth.finishSignIn.mockRejectedValue(new Error('Sign-in was cancelled.'))

    const outcome = await useMcpServers().signIn(SERVER)

    expect(outcome).toEqual({ error: 'Sign-in was cancelled.' })
  })
})
