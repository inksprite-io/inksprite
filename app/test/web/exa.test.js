import { describe, it, expect, beforeEach, vi } from 'vitest'

const callServerTool = vi.hoisted(() => vi.fn())
const listServer = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  callServerTool,
  listServer,
}))

const { EXA_LIMITED, EXA_URL, checkExa, exaPage, exaResults, readExa, searchExa } = await import(
  '@/web/exa.js'
)
const { ServiceError, PASSAGE_LENGTH } = await import('@/web/answers.js')

/** Exa's answer to a search, as its server writes one: made-up pages. */
const searchText = [
  'Title: Tide tables for the northern harbours\nURL: https://tides.example.org/north\nPublished: 2026-09-30T00:00:00.000Z\nAuthor: N/A\nHighlights:\nHigh water at the outer mole comes forty minutes after the inner basin.',
  'Title: N/A\nURL: https://example.net/almanac\nPublished: N/A\nAuthor: Harbour Office\nText: Spring tides follow the new and the full moon.',
].join('\n\n---\n\n')

/** A CallToolResult with this text. */
const answered = (text, isError = false) => ({ content: [{ type: 'text', text }], isError })

describe('exaResults', () => {
  it('takes Exa’s blocks apart into results', () => {
    expect(exaResults(searchText)).toEqual({
      results: [
        {
          title: 'Tide tables for the northern harbours',
          url: 'https://tides.example.org/north',
          published: '2026-09-30T00:00:00.000Z',
          text: 'High water at the outer mole comes forty minutes after the inner basin.',
        },
        {
          title: 'https://example.net/almanac',
          url: 'https://example.net/almanac',
          text: 'Spring tides follow the new and the full moon.',
        },
      ],
    })
  })

  it('clips a long passage', () => {
    const long = `Title: Long\nURL: https://example.org/long\nHighlights:\n${'word '.repeat(1000)}`
    const [result] = /** @type {any} */ (exaResults(long)).results

    expect(result.text.length).toBeLessThanOrEqual(PASSAGE_LENGTH + 2)
    expect(result.text.endsWith('…')).toBe(true)
  })

  it('answers no results when Exa found none', () => {
    expect(exaResults('No search results found. Please try a different query.')).toEqual({
      results: [],
    })
  })

  it('passes on as text an answer in a shape it does not know', () => {
    expect(exaResults('Something else entirely.')).toEqual({ text: 'Something else entirely.' })
  })
})

describe('exaPage', () => {
  it('takes the title and leaves out the address line', () => {
    expect(exaPage('# Harbour notes\nURL: https://example.org/notes\n\nThe mole is old.')).toEqual({
      title: 'Harbour notes',
      text: 'The mole is old.',
    })
  })

  it('takes the date off its own line, when Exa knows one', () => {
    expect(
      exaPage('# Harbour notes\nURL: https://example.org/notes\nPublished: 2026-06-14\n\nOld.')
    ).toEqual({ title: 'Harbour notes', published: '2026-06-14', text: 'Old.' })
  })

  it('reads a page with no heading as text', () => {
    expect(exaPage('Just text.')).toEqual({ text: 'Just text.' })
  })
})

describe('reaching Exa', () => {
  beforeEach(() => {
    callServerTool.mockReset()
    listServer.mockReset()
  })

  it('searches with no key, five results, and no objective', async () => {
    callServerTool.mockResolvedValue(answered(searchText))

    const answer = await searchExa('tides', { timeout: 1000 })

    const [server, tool, args, options] = callServerTool.mock.calls[0]
    expect(server).toEqual({ id: 'web:exa', url: EXA_URL })
    expect(tool).toBe('web_search_exa')
    expect(args).toEqual({ query: 'tides', numResults: 5 })
    expect(options.timeout).toBe(1000)
    expect(/** @type {any} */ (answer).results).toHaveLength(2)
  })

  it('sends a key as x-api-key', async () => {
    callServerTool.mockResolvedValue(answered(searchText))

    await searchExa('tides', { key: 'k1' })

    expect(callServerTool.mock.calls[0][0].headers).toEqual({ 'x-api-key': 'k1' })
  })

  it('reads a page whole, to be read on from without asking again', async () => {
    callServerTool.mockResolvedValue(answered('# Notes\nURL: https://example.org\n\nText.'))

    expect(await readExa('https://example.org', {})).toEqual({ title: 'Notes', text: 'Text.' })
    const [, tool, args] = callServerTool.mock.calls[0]
    expect(tool).toBe('web_fetch_exa')
    expect(args.urls).toEqual(['https://example.org'])
    expect(args.maxCharacters).toBeGreaterThan(40000)
  })

  it('says the free limit ran out when Exa answers so', async () => {
    callServerTool.mockResolvedValue(answered('Error (429): rate limit exceeded', true))

    await expect(searchExa('tides', {})).rejects.toEqual(new ServiceError(EXA_LIMITED))
  })

  it('says there is no page when Exa finds none at the address', async () => {
    const url = 'https://example.org/gone'
    callServerTool.mockResolvedValue(
      answered(`Error fetching URL(s): ${url}: CRAWL_NOT_FOUND`, true)
    )

    await expect(readExa(url, {})).rejects.toEqual(
      new ServiceError('There is no page at https://example.org/gone.')
    )
  })

  it('passes on any other refusal Exa gives', async () => {
    callServerTool.mockResolvedValue(answered('Something broke', true))

    await expect(searchExa('tides', {})).rejects.toThrow('Exa failed: Something broke')
  })

  it('checks by listing its tools, with the key', async () => {
    listServer.mockResolvedValue({ tools: [] })

    await checkExa('k2')

    expect(listServer).toHaveBeenCalledWith(
      expect.objectContaining({ url: EXA_URL, headers: { 'x-api-key': 'k2' } })
    )
  })
})
