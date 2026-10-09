/* global AbortController, URLSearchParams */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { SIGN_IN_PORT, callbackOrigin, signInInBrowser } from '@/platform/signIn.js'

/** The native side, as the page sees it. */
const desktop = () => {
  const bridge = { signIn: vi.fn().mockResolvedValue(undefined), stopSignIn: vi.fn() }
  globalThis.__INKSPRITE_DESKTOP__ = bridge
  return bridge
}

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
  vi.unstubAllGlobals()
})

describe('callbackOrigin', () => {
  it("is the page's own in a browser", () => {
    vi.stubGlobal('location', { origin: 'https://app.example' })
    expect(callbackOrigin()).toBe('https://app.example')
  })

  it("is the desktop app's listener in its window", () => {
    desktop()
    expect(callbackOrigin()).toBe(`http://localhost:${SIGN_IN_PORT}`)
  })
})

describe('signInInBrowser', () => {
  it('opens the address and hands back the query the browser returns with', async () => {
    const bridge = desktop()

    const signingIn = signInInBrowser(new URL('https://auth.example/authorize?x=1'), '/connect/mcp')
    await vi.waitFor(() => expect(bridge.signIn).toHaveBeenCalled())
    const [id, request, onReturn] = bridge.signIn.mock.calls[0]
    onReturn('code=abc&state=xyz')
    const params = await signingIn

    expect(params).toBeInstanceOf(URLSearchParams)
    expect(params.get('code')).toBe('abc')
    expect(params.get('state')).toBe('xyz')
    expect(id).toEqual(expect.any(Number))
    expect(request).toEqual({
      address: 'https://auth.example/authorize?x=1',
      port: SIGN_IN_PORT,
      path: '/connect/mcp',
    })
  })

  it('gives each sign-in its own id', async () => {
    const bridge = desktop()
    signInInBrowser('https://auth.example/', '/connect/mcp')
    signInInBrowser('https://auth.example/', '/connect/mcp')
    await vi.waitFor(() => expect(bridge.signIn).toHaveBeenCalledTimes(2))
    expect(bridge.signIn.mock.calls[0][0]).not.toBe(bridge.signIn.mock.calls[1][0])
  })

  it('stops listening when its signal is aborted', async () => {
    const bridge = desktop()
    const waiting = new AbortController()

    const signingIn = signInInBrowser('https://auth.example/', '/connect/mcp', {
      signal: waiting.signal,
    })
    await vi.waitFor(() => expect(bridge.signIn).toHaveBeenCalled())
    await Promise.resolve()
    waiting.abort(new Error('Gave up'))

    await expect(signingIn).rejects.toThrow('Gave up')
    expect(bridge.stopSignIn).toHaveBeenCalledWith(bridge.signIn.mock.calls[0][0])
  })

  it('says what the native side said when it could not start', async () => {
    const bridge = desktop()
    bridge.signIn.mockRejectedValue(new Error('Port 41721 is in use'))

    await expect(signInInBrowser('https://auth.example/', '/connect/mcp')).rejects.toThrow(
      'Port 41721 is in use'
    )
  })
})
