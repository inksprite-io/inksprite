/* global Response, AbortController */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { encodeWav, parseWav } from '@/tts/wav.js'

// The browser decodes OpenRouter's MP3; here it is any bytes, made a WAV clip
// that says how many there were.
const mockDecode = vi.hoisted(() => ({ decodeToWav: vi.fn() }))
vi.mock('@/tts/decode.js', () => mockDecode)

const { describeFailure, listVoices, speechConnectionOf, speechUrl, synthesize, voicesUrl } =
  await import('@/tts/client.js')

const connection = { endpoint: 'http://localhost:8880/v1', model: 'kokoro', type: 'generic' }

const MONO = { channels: 1, sampleRate: 24000, bitsPerSample: 16 }

/** A fetch that answers with the given body and status. */
const answer = (body, init = {}) => vi.fn(async () => new Response(body, { status: 200, ...init }))

describe('urls', () => {
  it('hang off the endpoint, with or without a trailing slash', () => {
    expect(speechUrl(connection)).toBe('http://localhost:8880/v1/audio/speech')
    expect(speechUrl({ endpoint: 'http://localhost:8880/v1/' })).toBe(
      'http://localhost:8880/v1/audio/speech'
    )
    expect(voicesUrl({ endpoint: 'https://api.openai.com/v1' })).toBe(
      'https://api.openai.com/v1/audio/voices'
    )
  })
})

describe('synthesize', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchMock

  beforeEach(() => {
    fetchMock = answer(new Uint8Array([1, 2, 3]))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('asks for WAV in the OpenAI shape, leaving out a speed of 1', async () => {
    const audio = await synthesize(connection, { input: 'Hello.', voice: 'af_heart' })

    expect(new Uint8Array(audio)).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8880/v1/audio/speech')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      model: 'kokoro',
      input: 'Hello.',
      voice: 'af_heart',
      response_format: 'wav',
    })
    expect(mockDecode.decodeToWav).not.toHaveBeenCalled()
  })

  it("asks OpenRouter for MP3, routed as the connection's chats are, and decodes it", async () => {
    mockDecode.decodeToWav.mockImplementation(async mp3 => encodeWav(MONO, [new Uint8Array(mp3)]))
    const openRouter = {
      endpoint: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-or',
      model: 'hexgrad/kokoro-82m',
      type: 'openrouter',
      routing: { data_collection: 'deny', zdr: true },
    }

    const audio = await synthesize(openRouter, { input: 'Hi', voice: 'af_heart', speed: 1.1 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/audio/speech')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-or', 'X-Title': 'inksprite' })
    expect(JSON.parse(init.body)).toEqual({
      model: 'hexgrad/kokoro-82m',
      input: 'Hi',
      voice: 'af_heart',
      speed: 1.1,
      response_format: 'mp3',
      provider: { data_collection: 'deny', zdr: true },
    })
    expect(parseWav(audio).data).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('asks for a text longer than the model reads in pieces cut at sentence ends, and joins them', async () => {
    const sizes = [4, 6]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(encodeWav(MONO, [new Uint8Array(sizes.shift() ?? 0)])))
    )
    const audio = await synthesize(
      { ...connection, inputLimit: 20 },
      { input: 'One sentence here. And another one.', voice: 'af_heart' }
    )

    const inputs = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init.body).input)
    expect(inputs).toEqual(['One sentence here.', 'And another one.'])
    expect(parseWav(audio).data.byteLength).toBe(10)
  })

  it('sends the key, the model, and the speed when given', async () => {
    const signal = new AbortController().signal
    await synthesize(
      { endpoint: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'tts-1', type: 'openai' },
      { input: 'Hi', voice: 'alloy', speed: 1.25 },
      signal
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer sk-1')
    expect(init.signal).toBe(signal)
    expect(JSON.parse(init.body)).toMatchObject({ model: 'tts-1', speed: 1.25 })
  })

  it("fails in the server's words", async () => {
    vi.stubGlobal(
      'fetch',
      answer(JSON.stringify({ detail: { message: 'Voice not found: af_nobody' } }), {
        status: 400,
      })
    )
    await expect(synthesize(connection, { input: 'x', voice: 'af_nobody' })).rejects.toThrow(
      'Voice not found: af_nobody'
    )

    vi.stubGlobal(
      'fetch',
      answer(JSON.stringify({ error: { message: 'Bad key' } }), { status: 401 })
    )
    await expect(synthesize(connection, { input: 'x', voice: 'v' })).rejects.toThrow('Bad key')

    vi.stubGlobal('fetch', answer('gateway timeout', { status: 504 }))
    await expect(synthesize(connection, { input: 'x', voice: 'v' })).rejects.toThrow(
      'gateway timeout'
    )

    vi.stubGlobal('fetch', answer('', { status: 500 }))
    await expect(synthesize(connection, { input: 'x', voice: 'v' })).rejects.toThrow('HTTP 500')
  })
})

describe('listVoices', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the names, sorted', async () => {
    vi.stubGlobal('fetch', answer(JSON.stringify({ voices: ['af_nicole', 'af_heart', 'am_adam'] })))
    expect(await listVoices(connection)).toEqual(['af_heart', 'af_nicole', 'am_adam'])
  })

  it('reads the ids of voices listed as objects, as Kokoro-FastAPI lists them', async () => {
    const voices = [
      { id: 'bm_george', name: 'bm_george', overall_grade: 'C' },
      { id: 'af_heart', name: 'af_heart', overall_grade: 'A' },
      { name: 'no id' },
    ]
    vi.stubGlobal('fetch', answer(JSON.stringify({ voices, default_voice: 'af_heart' })))
    expect(await listVoices(connection)).toEqual(['af_heart', 'bm_george'])
  })

  it('offers none from a server that has no such list', async () => {
    vi.stubGlobal('fetch', answer('Not found', { status: 404 }))
    expect(await listVoices(connection)).toEqual([])
  })

  it('fails when the server is there and refuses', async () => {
    vi.stubGlobal('fetch', answer('nope', { status: 403 }))
    await expect(listVoices(connection)).rejects.toThrow('nope')
  })

  it('sends the key', async () => {
    const fetchMock = answer(JSON.stringify({ voices: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await listVoices({ ...connection, apiKey: 'k' })
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer k' })
  })
})

describe('speechConnectionOf', () => {
  it("is the connection's address and key, and the model", () => {
    expect(
      speechConnectionOf(
        { id: 'p', type: 'generic', endpoint: 'http://localhost:8880/v1', apiKey: 'k' },
        'kokoro'
      )
    ).toEqual({
      endpoint: 'http://localhost:8880/v1',
      apiKey: 'k',
      model: 'kokoro',
      type: 'generic',
    })
  })

  it("takes a hosted service's address, OpenRouter's routing, and the model's limit", () => {
    const openRouter = { id: 'p', type: 'openrouter', apiKey: 'sk-or' }
    expect(
      speechConnectionOf(openRouter, 'hexgrad/kokoro-82m', { id: 'x', name: 'x', inputLimit: 4096 })
    ).toEqual({
      endpoint: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-or',
      model: 'hexgrad/kokoro-82m',
      type: 'openrouter',
      // A connection never set up denies data collection and asks for zero
      // retention; the precisions it allows are for language models.
      routing: { ignore: ['morph'], data_collection: 'deny', zdr: true },
      inputLimit: 4096,
    })
  })
})

describe('describeFailure', () => {
  it('names the server when it could not be reached', () => {
    expect(describeFailure(new TypeError('Failed to fetch'), connection)).toBe(
      'Could not reach the speech server at http://localhost:8880/v1.'
    )
  })

  it('says so when there is no server to name', () => {
    expect(describeFailure(new TypeError('Failed to fetch'), null)).toBe(
      'Could not reach the speech server.'
    )
  })

  it('passes on what a server said', () => {
    expect(describeFailure(new Error('Voice not found'), connection)).toBe('Voice not found')
    expect(describeFailure('odd', connection)).toBe('odd')
  })
})
