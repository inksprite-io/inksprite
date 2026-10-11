/* global AbortController, DOMException */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const callServerTool = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  callServerTool,
}))

const { executeReadWebPage, executeWebSearch } = await import('@/ai/tools/web.js')
const { setWebSearch } = await import('@/web/config.js')
const { forgetPages } = await import('@/web/pages.js')
const { READ_BUDGET } = await import('@/ai/tools/slices.js')

/** A CallToolResult with this text. */
const answered = (text, isError = false) => ({ content: [{ type: 'text', text }], isError })

/** Web search set up with Exa, and no key. */
const withExa = () => setWebSearch({ id: 'web', service: 'exa', keys: {}, profiles: [] })

describe('web_search', () => {
  beforeEach(() => {
    callServerTool.mockReset()
    withExa()
  })

  afterEach(() => setWebSearch(null))

  it('answers the results, with what was searched for', async () => {
    callServerTool.mockResolvedValue(
      answered('Title: Tides\nURL: https://example.org/tides\nHighlights:\nHigh water at noon.')
    )

    expect(await executeWebSearch({ query: ' tides ' })).toEqual({
      query: 'tides',
      results: [{ title: 'Tides', url: 'https://example.org/tides', text: 'High water at noon.' }],
    })
  })

  it('says when nothing was found', async () => {
    callServerTool.mockResolvedValue(answered('No search results found.'))

    expect(await executeWebSearch({ query: 'tides' })).toMatchObject({
      results: [],
      note: expect.stringMatching(/other words/),
    })
  })

  it('says so when no service is set up', async () => {
    setWebSearch(null)

    expect(await executeWebSearch({ query: 'tides' })).toEqual({
      error: expect.stringMatching(/Settings › Connections › Web search/),
    })
    expect(callServerTool).not.toHaveBeenCalled()
  })

  it('asks for a query', async () => {
    expect(await executeWebSearch({ query: '  ' })).toEqual({
      error: expect.stringMatching(/query/),
    })
  })

  it('says a run-out free limit in the writer’s words', async () => {
    callServerTool.mockRejectedValue(Object.assign(new Error('Too Many Requests'), { code: 429 }))

    expect(await executeWebSearch({ query: 'tides' })).toEqual({
      error: expect.stringMatching(/free searches have run out.*Exa key/),
    })
  })

  it('says a refused key in the writer’s words', async () => {
    setWebSearch({ id: 'web', service: 'kagi', keys: { kagi: 'bad' }, profiles: [] })
    callServerTool.mockRejectedValue(Object.assign(new Error('Unauthorized'), { code: 401 }))

    expect(await executeWebSearch({ query: 'tides' })).toEqual({
      error: 'Kagi refused the key. Check it in Settings › Connections › Web search.',
    })
  })

  it('lets a stopped call stop, rather than calling it a refusal', async () => {
    const stopped = new AbortController()
    stopped.abort()
    callServerTool.mockRejectedValue(new DOMException('stopped', 'AbortError'))

    await expect(executeWebSearch({ query: 'tides' }, { signal: stopped.signal })).rejects.toThrow(
      'stopped'
    )
  })
})

describe('read_web_page', () => {
  beforeEach(() => {
    callServerTool.mockReset()
    forgetPages()
    withExa()
  })

  afterEach(() => setWebSearch(null))

  it('answers a short page whole, and says it is the end', async () => {
    callServerTool.mockResolvedValue(
      answered('# Notes\nURL: https://example.org/n\n\nThe mole is old.')
    )

    expect(await executeReadWebPage({ url: 'https://example.org/n' })).toEqual({
      url: 'https://example.org/n',
      title: 'Notes',
      from: 0,
      to: 16,
      length: 16,
      next: null,
      note: 'This is the end of the page.',
      content: 'The mole is old.',
    })
  })

  it('says when the page was published, when the service knows', async () => {
    callServerTool.mockResolvedValue(
      answered('# Notes\nURL: https://example.org/d\nPublished: 2026-06-14\n\nThe mole is old.')
    )

    expect(await executeReadWebPage({ url: 'https://example.org/d' })).toMatchObject({
      title: 'Notes',
      published: '2026-06-14',
      content: 'The mole is old.',
    })
  })

  it('reads a long page a slice at a time, asking the service once', async () => {
    const paragraph = `${'word '.repeat(199)}word.\n\n`
    const text = paragraph.repeat(Math.ceil((READ_BUDGET * 2) / paragraph.length))
    callServerTool.mockResolvedValue(answered(`# Long\nURL: https://example.org/l\n\n${text}`))

    const first = /** @type {any} */ (await executeReadWebPage({ url: 'https://example.org/l' }))
    const second = /** @type {any} */ (
      await executeReadWebPage({ url: 'https://example.org/l', from: first.next })
    )

    expect(first.next).toBeGreaterThan(0)
    expect(first.content.length).toBeLessThanOrEqual(READ_BUDGET)
    expect(second.from).toBe(first.next)
    expect(callServerTool).toHaveBeenCalledTimes(1)
  })

  it('asks for a full address', async () => {
    expect(await executeReadWebPage({ url: 'example.org' })).toEqual({
      error: expect.stringMatching(/https:\/\//),
    })
    expect(await executeReadWebPage({ url: 'file:///etc/passwd' })).toEqual({
      error: expect.stringMatching(/https:\/\//),
    })
  })

  it('says when the service found nothing to read', async () => {
    callServerTool.mockResolvedValue(answered('# Empty\nURL: https://example.org/e\n\n'))

    expect(await executeReadWebPage({ url: 'https://example.org/e' })).toEqual({
      error: 'Exa found nothing to read at https://example.org/e.',
    })
  })
})
