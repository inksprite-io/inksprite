// @vitest-environment node
/* global Response, AbortController, TextEncoder */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { isDesktop } from '@/platform/desktop.js'
import { fetch } from '@/platform/fetch.js'

/**
 * The native side, as the page sees it: `fetch` answers with `head` and then
 * sends the body as `parts`, after the head, as the main process does.
 */
const desktop = ({ head = { status: 200, statusText: 'OK', headers: [] }, parts = [] } = {}) => {
  const bridge = {
    /** @type {((part: object) => void)|null} */
    onBody: null,
    fetch: vi.fn(async (id, request, onBody) => {
      bridge.onBody = onBody
      setTimeout(() => parts.forEach(part => onBody(part)))
      return head
    }),
    abortFetch: vi.fn(),
  }
  globalThis.__INKSPRITE_DESKTOP__ = bridge
  return bridge
}

const bytes = text => new TextEncoder().encode(text)

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
  vi.unstubAllGlobals()
})

describe('isDesktop', () => {
  it('is false in a browser', () => {
    expect(isDesktop()).toBe(false)
  })

  it('is true in the desktop window', () => {
    desktop()
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
  })

  it('goes out from the native side in the desktop window, the request read out', async () => {
    const bridge = desktop({ parts: [{ done: true }] })
    const pageFetch = vi.fn()
    vi.stubGlobal('fetch', pageFetch)

    await fetch('http://192.168.1.20:8080/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer key', 'Content-Type': 'application/json' },
      body: '{"stream":true}',
    })

    expect(pageFetch).not.toHaveBeenCalled()
    const [id, request] = bridge.fetch.mock.calls[0]
    expect(id).toEqual(expect.any(Number))
    expect(request).toMatchObject({
      url: 'http://192.168.1.20:8080/v1/chat/completions',
      method: 'POST',
      redirect: 'follow',
    })
    expect(request.headers).toEqual(
      expect.arrayContaining([
        ['authorization', 'Bearer key'],
        ['content-type', 'application/json'],
      ])
    )
    expect(new TextDecoder().decode(request.body)).toBe('{"stream":true}')
  })

  it('sends no body for a GET', async () => {
    const bridge = desktop({ parts: [{ done: true }] })
    await fetch('https://models.example/v1/models')
    expect(bridge.fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', body: null })
  })

  it('answers with the status and headers, and the body as it comes', async () => {
    desktop({
      head: { status: 201, statusText: 'Created', headers: [['content-type', 'text/plain']] },
      parts: [{ chunk: bytes('data: 1\n\n') }, { chunk: bytes('data: 2\n\n') }, { done: true }],
    })

    const response = await fetch('https://models.example/v1/chat/completions')

    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created')
    expect(response.ok).toBe(true)
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(await response.text()).toBe('data: 1\n\ndata: 2\n\n')
  })

  it('has no body for a status that has none', async () => {
    desktop({
      head: { status: 204, statusText: 'No Content', headers: [] },
      parts: [{ done: true }],
    })
    const response = await fetch('https://models.example/v1/thing', { method: 'DELETE' })
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })

  it('fails with a TypeError when the request gets no answer, as a browser does', async () => {
    const bridge = desktop()
    bridge.fetch.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))

    const failure = fetch('http://localhost:1234/v1/models')
    await expect(failure).rejects.toThrow(TypeError)
    await expect(failure).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
  })

  it('fails with a TypeError when the body breaks off', async () => {
    desktop({ parts: [{ chunk: bytes('part') }, { error: 'net::ERR_CONNECTION_RESET' }] })
    const response = await fetch('https://models.example/v1/chat/completions')
    await expect(response.text()).rejects.toThrow(TypeError)
  })

  it("never asks when its signal is already aborted, and fails with the signal's reason", async () => {
    const bridge = desktop()
    const stopped = new AbortController()
    stopped.abort(new Error('Stopped'))

    await expect(fetch('https://models.example/', { signal: stopped.signal })).rejects.toThrow(
      'Stopped'
    )
    expect(bridge.fetch).not.toHaveBeenCalled()
  })

  it('stops the request on the native side when its signal is aborted on the way', async () => {
    const bridge = desktop()
    const stopping = new AbortController()
    bridge.fetch.mockImplementation(async () => {
      stopping.abort()
      throw new Error('This operation was aborted')
    })

    await expect(fetch('https://models.example/', { signal: stopping.signal })).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' })
    )
    expect(bridge.abortFetch).toHaveBeenCalledWith(bridge.fetch.mock.calls[0][0])
  })

  it('stops a body being read when its signal is aborted, with the AbortError a browser gives', async () => {
    const bridge = desktop({ parts: [{ chunk: bytes('data: 1\n\n') }] })
    const stopping = new AbortController()
    const response = await fetch('https://models.example/', { signal: stopping.signal })
    const reader = response.body.getReader()
    await reader.read()

    stopping.abort()
    bridge.onBody({ error: 'This operation was aborted' })

    await expect(reader.read()).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }))
    expect(bridge.abortFetch).toHaveBeenCalled()
  })

  it("fails a whole-body read with the signal's reason when stopped, not a TypeError", async () => {
    const bridge = desktop({ parts: [{ chunk: bytes('{"a":') }] })
    const stopping = new AbortController()
    const response = await fetch('https://models.example/', { signal: stopping.signal })
    const reading = response.json()

    stopping.abort()
    bridge.onBody({ error: 'This operation was aborted' })

    await expect(reading).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }))
  })

  it('stops the request when the page stops reading the body', async () => {
    const bridge = desktop({ parts: [{ chunk: bytes('data: 1\n\n') }] })
    const response = await fetch('https://models.example/')
    await response.body.cancel()
    expect(bridge.abortFetch).toHaveBeenCalledWith(bridge.fetch.mock.calls[0][0])
  })
})
