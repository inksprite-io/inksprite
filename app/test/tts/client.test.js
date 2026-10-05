/* global Response, AbortController */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_MODEL,
  describeFailure,
  listVoices,
  speechUrl,
  synthesize,
  voicesUrl,
} from '@/tts/client.js'

const connection = { endpoint: 'http://localhost:8880/v1', apiKey: '', model: '' }

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

  it('asks for WAV in the OpenAI shape', async () => {
    const audio = await synthesize(connection, { input: 'Hello.', voice: 'af_heart' })

    expect(new Uint8Array(audio)).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8880/v1/audio/speech')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      model: DEFAULT_MODEL,
      input: 'Hello.',
      voice: 'af_heart',
      speed: 1,
      response_format: 'wav',
    })
  })

  it('sends the key, the model, and the speed when given', async () => {
    const signal = new AbortController().signal
    await synthesize(
      { endpoint: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'tts-1' },
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

describe('describeFailure', () => {
  it('names the server when it could not be reached', () => {
    expect(describeFailure(new TypeError('Failed to fetch'), connection)).toBe(
      'Could not reach the speech server at http://localhost:8880/v1.'
    )
  })

  it('passes on what a server said', () => {
    expect(describeFailure(new Error('Voice not found'), connection)).toBe('Voice not found')
    expect(describeFailure('odd', connection)).toBe('odd')
  })
})
