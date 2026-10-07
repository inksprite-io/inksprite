/* global Response, AbortController */
import { describe, it, expect, vi, afterEach } from 'vitest'

const plugin = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => plugin)

import { isDesktop } from '@/platform/desktop.js'
import { fetch } from '@/platform/fetch.js'

afterEach(() => {
  delete globalThis.__TAURI_INTERNALS__
  vi.unstubAllGlobals()
  plugin.fetch.mockReset()
})

describe('isDesktop', () => {
  it('is false in a browser', () => {
    expect(isDesktop()).toBe(false)
  })

  it('is true in the desktop window', () => {
    globalThis.__TAURI_INTERNALS__ = {}
    expect(isDesktop()).toBe(true)
  })
})

describe('fetch', () => {
  it("is the page's own in a browser", async () => {
    const response = new Response('ok')
    const pageFetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', pageFetch)
    const init = { method: 'POST', body: '{}' }

    expect(await fetch('https://models.example/v1/chat/completions', init)).toBe(response)
    expect(pageFetch).toHaveBeenCalledWith('https://models.example/v1/chat/completions', init)
    expect(plugin.fetch).not.toHaveBeenCalled()
  })

  it('goes out from the native side in the desktop window, signal and all', async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    const response = new Response('ok')
    plugin.fetch.mockResolvedValue(response)
    const pageFetch = vi.fn()
    vi.stubGlobal('fetch', pageFetch)
    const { signal } = new AbortController()

    expect(await fetch('http://192.168.1.20:8080/v1/models', { signal })).toBe(response)
    expect(plugin.fetch).toHaveBeenCalledWith('http://192.168.1.20:8080/v1/models', { signal })
    expect(pageFetch).not.toHaveBeenCalled()
  })
})
