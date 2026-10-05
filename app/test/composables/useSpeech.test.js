import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ synthesize: vi.fn(), playClip: vi.fn() }))
vi.mock('@/tts/client.js', async importOriginal => ({
  ...(await importOriginal()),
  synthesize: mocks.synthesize,
}))
vi.mock('@/tts/player.js', () => ({ playClip: mocks.playClip }))

import { useSpeech } from '@/composables/useSpeech.js'

const connection = { endpoint: 'http://localhost:8880/v1', apiKey: '', model: 'kokoro' }
const voice = { id: 'narrator', name: 'Narrator', voice: 'af_heart', speed: 1.1 }

/** Something that ends when told to, or when its signal says stop. */
const pending = () => {
  /** @type {Array<{resolve: (value?: any) => void, reject: (error: Error) => void, signal?: AbortSignal}>} */
  const calls = []
  const start = signal =>
    new Promise((resolve, reject) => {
      calls.push({ resolve, reject, signal })
      signal?.addEventListener('abort', () => resolve())
    })
  return { calls, start }
}

/** Everything already settled has been heard about. */
const settled = () => new Promise(resolve => setTimeout(resolve, 0))

describe('useSpeech', () => {
  const speech = useSpeech()
  /** @type {ReturnType<typeof pending>} */
  let asked
  /** @type {ReturnType<typeof pending>} */
  let played

  beforeEach(() => {
    vi.clearAllMocks()
    asked = pending()
    played = pending()
    mocks.synthesize.mockImplementation((_connection, _request, signal) => asked.start(signal))
    mocks.playClip.mockImplementation((_clip, signal) => played.start(signal))
  })

  afterEach(async () => {
    speech.stop()
    await settled()
  })

  it('is saying nothing to begin with', () => {
    expect(speech.current.value).toBeNull()
    expect(speech.status.value).toBe('idle')
  })

  it('asks for each line in the voice, and speaks it when it arrives', async () => {
    const done = speech.speak('turn:m1', { connection, voice, lines: ['One.', 'Two.'] })
    expect(speech.current.value).toBe('turn:m1')
    expect(speech.status.value).toBe('loading')
    expect(mocks.synthesize).toHaveBeenCalledTimes(1)
    expect(mocks.synthesize.mock.calls[0].slice(0, 2)).toEqual([
      connection,
      { input: 'One.', voice: 'af_heart', speed: 1.1 },
    ])

    asked.calls[0].resolve('clip one')
    await settled()
    expect(speech.status.value).toBe('speaking')
    expect(mocks.playClip.mock.calls[0][0]).toBe('clip one')

    // The next line is asked for while the first is still being spoken.
    expect(mocks.synthesize).toHaveBeenCalledTimes(2)
    expect(mocks.synthesize.mock.calls[1][1].input).toBe('Two.')
    asked.calls[1].resolve('clip two')
    await settled()
    expect(mocks.playClip).toHaveBeenCalledTimes(1)

    played.calls[0].resolve()
    await settled()
    expect(mocks.playClip.mock.calls[1][0]).toBe('clip two')

    played.calls[1].resolve()
    await done
    expect(speech.current.value).toBeNull()
    expect(speech.status.value).toBe('idle')
  })

  it('stops when told to, and says no more about it', async () => {
    const done = speech.speak('turn:m1', { connection, voice, lines: ['One.', 'Two.'] })
    asked.calls[0].resolve('clip one')
    await settled()

    speech.stop()
    await done

    expect(played.calls[0].signal.aborted).toBe(true)
    expect(asked.calls[1].signal.aborted).toBe(true)
    expect(mocks.playClip).toHaveBeenCalledTimes(1)
    expect(speech.current.value).toBeNull()
    expect(speech.status.value).toBe('idle')
  })

  it('stops what was speaking when something else starts', async () => {
    const first = speech.speak('turn:m1', { connection, voice, lines: ['One.'] })
    const second = speech.speak('turn:m2', { connection, voice, lines: ['Two.'] })
    await first

    // The first going quiet does not take the second's place with it.
    expect(speech.current.value).toBe('turn:m2')
    expect(speech.status.value).toBe('loading')

    asked.calls[1].resolve('clip two')
    await settled()
    played.calls[0].resolve()
    await second
    expect(speech.current.value).toBeNull()
  })

  it('fails in the server’s words, and goes quiet', async () => {
    const done = speech.speak('turn:m1', { connection, voice, lines: ['One.', 'Two.'] })
    asked.calls[0].reject(new Error('Voice not found: af_nobody'))

    await expect(done).rejects.toThrow('Voice not found: af_nobody')
    expect(speech.current.value).toBeNull()
    expect(speech.status.value).toBe('idle')
    // Nothing more is asked for once a line has failed.
    expect(mocks.synthesize).toHaveBeenCalledTimes(1)
  })

  it('fails when a line cannot be played', async () => {
    const done = speech.speak('turn:m1', { connection, voice, lines: ['One.'] })
    asked.calls[0].resolve('clip one')
    await settled()
    played.calls[0].reject(new Error('The audio could not be played.'))

    await expect(done).rejects.toThrow('could not be played')
    expect(speech.status.value).toBe('idle')
  })

  it('has nothing to say of nothing', async () => {
    await speech.speak('turn:m1', { connection, voice, lines: [] })
    expect(mocks.synthesize).not.toHaveBeenCalled()
    expect(speech.current.value).toBeNull()
  })
})
