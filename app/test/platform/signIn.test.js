/* global AbortController, URLSearchParams */
import { describe, it, expect, vi, afterEach } from 'vitest'

/** The native side, as the page sees it: commands, and the channel back. */
const tauri = vi.hoisted(() => {
  const state = { channel: null, invoke: null, Channel: null }
  state.invoke = vi.fn()
  state.Channel = class {
    constructor(onmessage) {
      this.onmessage = onmessage
      state.channel = this
    }
  }
  return state
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, Channel: tauri.Channel }))

import { SIGN_IN_PORT, callbackOrigin, signInInBrowser } from '@/platform/signIn.js'

afterEach(() => {
  delete globalThis.__TAURI_INTERNALS__
  vi.unstubAllGlobals()
  tauri.invoke.mockReset()
})

describe('callbackOrigin', () => {
  it("is the page's own in a browser", () => {
    vi.stubGlobal('location', { origin: 'https://app.example' })
    expect(callbackOrigin()).toBe('https://app.example')
  })

  it("is the desktop app's listener in its window", () => {
    globalThis.__TAURI_INTERNALS__ = {}
    expect(callbackOrigin()).toBe(`http://localhost:${SIGN_IN_PORT}`)
  })
})

describe('signInInBrowser', () => {
  it('opens the address and hands back the query the browser returns with', async () => {
    tauri.invoke.mockResolvedValue(7)

    const signingIn = signInInBrowser(new URL('https://auth.example/authorize?x=1'), '/connect/mcp')
    await vi.waitFor(() => expect(tauri.channel).not.toBeNull())
    tauri.channel.onmessage('code=abc&state=xyz')
    const params = await signingIn

    expect(params).toBeInstanceOf(URLSearchParams)
    expect(params.get('code')).toBe('abc')
    expect(params.get('state')).toBe('xyz')
    expect(tauri.invoke).toHaveBeenCalledWith('sign_in_in_browser', {
      address: 'https://auth.example/authorize?x=1',
      port: SIGN_IN_PORT,
      path: '/connect/mcp',
      onReturn: tauri.channel,
    })
  })

  it('stops listening when its signal is aborted', async () => {
    tauri.invoke.mockResolvedValueOnce(7).mockResolvedValue(undefined)
    const waiting = new AbortController()

    const signingIn = signInInBrowser('https://auth.example/', '/connect/mcp', {
      signal: waiting.signal,
    })
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    waiting.abort(new Error('Gave up'))

    await expect(signingIn).rejects.toThrow('Gave up')
    expect(tauri.invoke).toHaveBeenLastCalledWith('stop_sign_in', { id: 7 })
  })

  it('says what the native side said when it could not start', async () => {
    tauri.invoke.mockRejectedValue('Port 41721 is in use')

    await expect(signInInBrowser('https://auth.example/', '/connect/mcp')).rejects.toThrow(
      'Port 41721 is in use'
    )
  })
})
