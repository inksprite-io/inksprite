/* global Response */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('@/platform/fetch.js', () => ({ fetch }))

const { BRAVE_URL, braveResults, searchBrave } = await import('@/web/brave.js')
const { describeRefusal, PASSAGE_LENGTH } = await import('@/web/answers.js')

/** LLM Context's answer, in its shape: made-up pages. */
const answer = {
  grounding: {
    generic: [
      {
        url: 'https://tides.example.org/north',
        title: 'Tide tables',
        snippets: ['High water at the outer mole.', '{"table":"times"}'],
      },
      { url: 'https://example.net/almanac', title: '', snippets: ['Spring tides.'] },
    ],
    map: [],
  },
  sources: {
    'https://tides.example.org/north': {
      title: 'Tide tables',
      hostname: 'tides.example.org',
      age: ['Tuesday, September 30, 2026', '2026-09-30', '10 days ago', '2026-09-30T00:00:00'],
    },
    'https://example.net/almanac': { title: 'Almanac', hostname: 'example.net', age: [] },
  },
}

describe('braveResults', () => {
  it('takes each page’s passages and its date', () => {
    expect(braveResults(answer)).toEqual({
      results: [
        {
          title: 'Tide tables',
          url: 'https://tides.example.org/north',
          published: '2026-09-30',
          text: 'High water at the outer mole.\n\n{"table":"times"}',
        },
        {
          title: 'Almanac',
          url: 'https://example.net/almanac',
          text: 'Spring tides.',
        },
      ],
    })
  })

  it('clips a page’s passages, and answers nothing for nothing', () => {
    const long = {
      grounding: { generic: [{ url: 'https://x.example', snippets: ['w '.repeat(3000)] }] },
    }

    expect(/** @type {any} */ (braveResults(long)).results[0].text.length).toBeLessThanOrEqual(
      PASSAGE_LENGTH + 2
    )
    expect(braveResults({})).toEqual({ results: [] })
  })
})

describe('searchBrave', () => {
  beforeEach(() => fetch.mockReset())

  it('asks LLM Context for five addresses, with the key', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify(answer), { status: 200 }))

    const found = await searchBrave('spring tides', { key: 'bk' })

    const [url, init] = fetch.mock.calls[0]
    expect(`${url.origin}${url.pathname}`).toBe(BRAVE_URL)
    expect(url.searchParams.get('q')).toBe('spring tides')
    expect(url.searchParams.get('maximum_number_of_urls')).toBe('5')
    expect(init.headers['X-Subscription-Token']).toBe('bk')
    expect(/** @type {any} */ (found).results).toHaveLength(2)
  })

  it('carries the status of a refusal, for it to be said in the writer’s words', async () => {
    fetch.mockResolvedValue(new Response('{}', { status: 401 }))

    const error = await searchBrave('tides', { key: 'bad' }).catch(failure => failure)

    expect(describeRefusal('Brave', error)).toBe(
      'Brave refused the key. Check it in Settings › Connections › Web search.'
    )
  })
})
