// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  PRICES_PATH,
  makerPrices,
  plainModelId,
  priceListResponse,
  pricingOf,
} from '@/ai/prices.js'
import { GET } from '../../api/prices.js'

const LIST = [
  { id: 'anthropic/claude-sonnet-4.5', pricing: { prompt: '0.000003', completion: '0.000015' } },
  {
    id: 'anthropic/claude-sonnet-4.5:batch',
    pricing: { prompt: '0.0000015', completion: '0.0000075' },
  },
  { id: 'openai/gpt-6.1-sol', pricing: { prompt: '0.000002', completion: '0.000008' } },
  { id: 'openai/gpt-free', pricing: { prompt: '0', completion: '0' } },
  { id: 'openai/gpt-unpriced' },
  { id: 'z-ai/glm', pricing: { prompt: '0.0000004', completion: '0.000002' } },
  null,
]

describe('the makers’ prices, read off OpenRouter’s list', () => {
  it('keeps Anthropic’s and OpenAI’s, by each model’s plain id, and no one else’s', () => {
    expect(makerPrices(LIST)).toEqual({
      anthropic: { 'claude-sonnet-4-5': { prompt: 0.000003, completion: 0.000015 } },
      openai: {
        'gpt-6-1-sol': { prompt: 0.000002, completion: 0.000008 },
        'gpt-free': { prompt: 0, completion: 0 },
      },
    })
    expect(makerPrices([])).toEqual({ anthropic: {}, openai: {} })
  })

  it('reads a price by the token, and none where the list has none or nonsense', () => {
    expect(pricingOf({ prompt: 2, completion: 10 }, 1e6)).toEqual({
      prompt: 0.000002,
      completion: 0.00001,
    })
    expect(pricingOf({ prompt: '0.1' })).toBeUndefined()
    expect(pricingOf({ prompt: 'x', completion: '1' })).toBeUndefined()
    expect(pricingOf({ prompt: '-1', completion: '1' })).toBeUndefined()
    expect(plainModelId('openai/gpt-6.1-sol-2026-09-29')).toBe('gpt-6-1-sol')
  })
})

describe('the site’s answer', () => {
  const answering = (body, ok = true, status = 200) =>
    vi.fn(async () => ({ ok, status, json: async () => body }))

  it('is the prices, kept a day by what stands in front of it, and readable from anywhere', async () => {
    const ask = answering({ data: LIST })
    const response = await priceListResponse(ask)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(makerPrices(LIST))
    expect(response.headers.get('cache-control')).toContain('s-maxage=86400')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    // One request, to OpenRouter's public list, with nothing of anyone's on it.
    expect(ask).toHaveBeenCalledTimes(1)
    const [url, init] = ask.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/models')
    expect(Object.keys(init.headers)).toEqual(['accept'])
  })

  it('is an error nothing keeps when OpenRouter can’t be read', async () => {
    for (const ask of [
      answering({}, false, 503),
      answering({ data: 'not a list' }),
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    ]) {
      const response = await priceListResponse(ask)
      expect(response.status).toBe(502)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: 'The prices could not be read.' })
    }
  })

  it('is what the site’s function answers with, at the path the app asks', async () => {
    vi.stubGlobal('fetch', answering({ data: LIST }))
    const response = await GET()
    vi.unstubAllGlobals()

    expect(PRICES_PATH).toBe('/api/prices')
    expect(await response.json()).toEqual(makerPrices(LIST))
  })
})
