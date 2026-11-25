// @vitest-environment node
/* global Request, Response */
import { describe, it, expect, vi } from 'vitest'
import { handle as app } from '../worker.js'
import { handle as docs } from '../../docs/worker.js'

/** The built files, answering every path with what names it. */
const files = () => ({
  fetch: vi.fn(async request => new Response(`file ${new URL(request.url).pathname}`)),
})

/** A cache that keeps what it's given. */
const cache = () => {
  const kept = new Map()
  return {
    kept,
    match: vi.fn(async key => kept.get(key.url)?.clone()),
    put: vi.fn(async (key, response) => void kept.set(key.url, response)),
  }
}

/** OpenRouter's list, with a model of each maker's. */
const openRouter = vi.fn(async () =>
  Response.json({
    data: [
      { id: 'anthropic/claude-x-1', pricing: { prompt: '0.000003', completion: '0.000015' } },
      { id: 'openai/gpt-x', pricing: { prompt: '0.000001', completion: '0.000002' } },
    ],
  })
)

describe("the app's Worker", () => {
  it("answers an address in the app with the app's page, which no site may frame", async () => {
    const assets = files()
    const response = await app(new Request('https://app.inksprite.io/project/abc?x=1'), {
      assets,
      cache: cache(),
      waitUntil: () => {},
    })
    expect(await response.text()).toBe('file /')
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
  })

  it('finds no missing file under /assets/, rather than answering with the page', async () => {
    const assets = files()
    const response = await app(new Request('https://app.inksprite.io/assets/gone-1234.js'), {
      assets,
      cache: cache(),
      waitUntil: () => {},
    })
    expect(response.status).toBe(404)
    expect(assets.fetch).not.toHaveBeenCalled()
  })

  it('answers the price list, and keeps it for the next asker', async () => {
    const kept = cache()
    /** @type {Promise<any>[]} */
    const waiting = []
    const around = {
      assets: files(),
      cache: kept,
      waitUntil: p => waiting.push(p),
      ask: openRouter,
    }
    const first = await app(new Request('https://app.inksprite.io/api/prices?x=1'), around)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      anthropic: { 'claude-x-1': { prompt: 0.000003, completion: 0.000015 } },
      openai: { 'gpt-x': { prompt: 0.000001, completion: 0.000002 } },
    })
    await Promise.all(waiting)
    const second = await app(new Request('https://app.inksprite.io/api/prices'), around)
    expect(await second.json()).toHaveProperty('anthropic')
    expect(openRouter).toHaveBeenCalledTimes(1)
  })

  it("keeps nothing when OpenRouter can't be read", async () => {
    const kept = cache()
    const response = await app(new Request('https://app.inksprite.io/api/prices'), {
      assets: files(),
      cache: kept,
      waitUntil: () => {},
      ask: async () => new Response('down', { status: 503 }),
    })
    expect(response.status).toBe(502)
    expect(kept.put).not.toHaveBeenCalled()
  })

  it('refuses anything but reading the list, and finds no other API', async () => {
    const around = { assets: files(), cache: cache(), waitUntil: () => {} }
    const post = await app(
      new Request('https://app.inksprite.io/api/prices', { method: 'POST' }),
      around
    )
    expect(post.status).toBe(405)
    expect((await app(new Request('https://app.inksprite.io/api/other'), around)).status).toBe(404)
  })
})

describe("the docs site's Worker", () => {
  it("sends inksprite.io's front page to the app, for now", async () => {
    const response = await docs(new Request('https://inksprite.io/'), files())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://app.inksprite.io/')
  })

  it("leaves the docs' own front page to the built site", async () => {
    const response = await docs(new Request('https://docs.inksprite.io/'), files())
    expect(await response.text()).toBe('file /')
  })

  it('serves the install script as plain text, read again on every visit', async () => {
    const response = await docs(new Request('https://inksprite.io/install'), files())
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toBe('file /install')
  })

  it('passes a missing script on as it is', async () => {
    const missing = { fetch: async () => new Response('Not found', { status: 404 }) }
    const response = await docs(new Request('https://inksprite.io/install'), missing)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).not.toBe('text/plain; charset=utf-8')
  })
})
