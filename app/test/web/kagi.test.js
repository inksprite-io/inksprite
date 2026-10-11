import { describe, it, expect, beforeEach, vi } from 'vitest'

const callServerTool = vi.hoisted(() => vi.fn())
const listServer = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  callServerTool,
  listServer,
}))

const { KAGI_URL, checkKagi, kagiPage, readKagi, searchKagi } = await import('@/web/kagi.js')
const { SEARCH_TEXT_LENGTH } = await import('@/web/answers.js')

/** A CallToolResult with this text. */
const answered = (text, isError = false) => ({ content: [{ type: 'text', text }], isError })

describe('reaching Kagi', () => {
  beforeEach(() => {
    callServerTool.mockReset()
    listServer.mockReset()
  })

  it('searches with the key as a bearer token, and passes the markdown on', async () => {
    callServerTool.mockResolvedValue(answered('1. [Tides](https://example.org/tides)\nHigh water.'))

    const answer = await searchKagi('tides', { key: 'k1' })

    const [server, tool, args] = callServerTool.mock.calls[0]
    expect(server).toEqual({
      id: 'web:kagi',
      url: KAGI_URL,
      headers: { Authorization: 'Bearer k1' },
    })
    expect(tool).toBe('kagi_search_fetch')
    expect(args).toEqual({ query: 'tides', limit: 5 })
    expect(answer).toEqual({ text: '1. [Tides](https://example.org/tides)\nHigh water.' })
  })

  it('clips a long answer', async () => {
    callServerTool.mockResolvedValue(answered('word '.repeat(5000)))

    const answer = /** @type {any} */ (await searchKagi('tides', { key: 'k1' }))

    expect(answer.text.length).toBeLessThanOrEqual(SEARCH_TEXT_LENGTH + 2)
  })

  it('answers no results for an empty answer', async () => {
    callServerTool.mockResolvedValue(answered('  '))

    expect(await searchKagi('tides', { key: 'k1' })).toEqual({ results: [] })
  })

  it('reads a page as markdown, its title the first heading', async () => {
    callServerTool.mockResolvedValue(answered('Intro.\n\n# Harbour notes\n\nThe mole is old.'))

    const page = await readKagi('https://example.org', { key: 'k1' })

    expect(callServerTool.mock.calls[0][1]).toBe('kagi_extract')
    expect(callServerTool.mock.calls[0][2]).toEqual({ url: 'https://example.org' })
    expect(page.title).toBe('Harbour notes')
  })

  it('passes on a refusal Kagi gives', async () => {
    callServerTool.mockResolvedValue(answered('Kagi Search API error (402): out of credit', true))

    await expect(searchKagi('tides', { key: 'k1' })).rejects.toThrow('out of credit')
  })

  it('checks the key by listing its tools', async () => {
    listServer.mockResolvedValue({ tools: [] })

    await checkKagi('k2')

    expect(listServer).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { Authorization: 'Bearer k2' } })
    )
  })

  it('takes a page with no heading as text alone', () => {
    expect(kagiPage('Text only.')).toEqual({ text: 'Text only.' })
  })
})
