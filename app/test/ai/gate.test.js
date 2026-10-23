/* global AbortController, Headers, Response */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('@/platform/fetch.js', () => ({ fetch }))

const {
  LONGEST_WAIT_MS,
  RATE_RETRIES,
  RateLimitedError,
  defaultRoom,
  inTurn,
  isAtHome,
  resetGate,
  retryAfterOf,
  roomFor,
  throughGate,
} = await import('@/ai/gate.js')

/** A promise, with the means to settle it from outside. */
const deferred = () => {
  /** @type {(value?: any) => void} */
  let resolve = () => {}
  /** @type {(error: any) => void} */
  let reject = () => {}
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** Let every promise that can settle, settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** A connection with this many requests at once. */
const taking = (/** @type {number} */ concurrency) =>
  /** @type {any} */ ({ id: `p${concurrency}`, type: 'openrouter', concurrency })

const hosted = /** @type {any} */ ({ id: 'hosted', type: 'openrouter' })

describe('defaultRoom', () => {
  it('asks a hosted service, and vLLM, as much at once as there is', () => {
    for (const type of ['openrouter', 'anthropic', 'openai', 'gemini']) {
      expect(defaultRoom(/** @type {any} */ ({ id: 'x', type }))).toBe(Infinity)
    }
    expect(defaultRoom(/** @type {any} */ ({ id: 'provider_vllm_default', type: 'generic' }))).toBe(
      Infinity
    )
  })

  it('asks a server at home one thing at a time, or one per slot llama.cpp says it has', () => {
    for (const id of [
      'provider_lmstudio_default',
      'provider_ollama_default',
      'provider_koboldcpp_default',
    ]) {
      expect(defaultRoom(/** @type {any} */ ({ id, type: 'generic' }))).toBe(1)
    }
    const llama = /** @type {any} */ ({ id: 'l', type: 'llamacpp' })
    expect(defaultRoom(llama)).toBe(1)
    expect(defaultRoom(llama, 4)).toBe(4)
  })

  it('takes any other server by where it is', () => {
    const at = (/** @type {string} */ endpoint) =>
      defaultRoom(/** @type {any} */ ({ id: 'c', type: 'generic', endpoint }))
    expect(at('http://192.168.1.20:8080/v1')).toBe(1)
    expect(at('https://api.example.com/v1')).toBe(Infinity)
  })
})

describe('isAtHome', () => {
  it('knows this machine, the local network, and names only it knows', () => {
    for (const address of [
      'http://localhost:1234/v1',
      'http://127.0.0.1:8080',
      'http://[::1]:8080',
      'http://10.0.0.5',
      'http://172.20.1.1',
      'http://192.168.0.9',
      'http://100.101.102.103',
      'http://gpu-box:5001',
      'http://studio.local:1234',
      'http://host.docker.internal:1234',
    ]) {
      expect(isAtHome(address), address).toBe(true)
    }
  })

  it('takes everything else for somewhere else', () => {
    for (const address of ['https://api.example.com', 'http://8.8.8.8', 'http://172.32.0.1', '']) {
      expect(isAtHome(address), address).toBe(false)
    }
  })
})

describe('retryAfterOf', () => {
  it('reads seconds, or a date, from headers of either kind', () => {
    expect(retryAfterOf(new Headers({ 'retry-after': '3' }))).toBe(3000)
    expect(retryAfterOf({ 'retry-after': '0.5' })).toBe(500)
    const soon = new Date(Date.now() + 10_000).toUTCString()
    expect(retryAfterOf(new Headers({ 'retry-after': soon }))).toBeGreaterThan(8000)
    expect(retryAfterOf(new Headers())).toBeUndefined()
    expect(retryAfterOf(undefined)).toBeUndefined()
  })
})

describe('roomFor', () => {
  beforeEach(() => {
    resetGate()
    fetch.mockReset()
  })

  it('takes what the writer set over any default', async () => {
    expect(await roomFor(taking(3))).toBe(3)
    expect(await roomFor(/** @type {any} */ ({ id: 'x', type: 'llamacpp', concurrency: 2 }))).toBe(
      2
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks llama.cpp for its slots once, beside its API', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ total_slots: 4 })))
    const llama = /** @type {any} */ ({
      id: 'l',
      type: 'llamacpp',
      endpoint: 'http://localhost:9931/v1',
    })

    expect(await roomFor(llama)).toBe(4)
    expect(await roomFor(llama)).toBe(4)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:9931/props')
  })

  it('takes one at a time from a llama.cpp that will not say', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(
      await roomFor(/** @type {any} */ ({ id: 'l', type: 'llamacpp', endpoint: 'http://gpu:8080' }))
    ).toBe(1)
  })
})

describe('throughGate', () => {
  beforeEach(() => resetGate())
  afterEach(() => vi.useRealTimers())

  it('sends no more at once than the connection takes, the next as one is answered', async () => {
    const first = deferred()
    const second = deferred()
    const started = []
    const one = throughGate(taking(1), {}, () => (started.push(1), first.promise))
    const two = throughGate(taking(1), {}, () => (started.push(2), second.promise))
    await settle()
    expect(started).toEqual([1])

    first.resolve('a')
    expect(await one).toBe('a')
    await settle()
    expect(started).toEqual([1, 2])
    second.resolve('b')
    expect(await two).toBe('b')
  })

  it('sends everything at once to a connection with no limit', async () => {
    let out = 0
    let most = 0
    const sends = Array.from({ length: 6 }, () =>
      throughGate(hosted, {}, async () => {
        out++
        most = Math.max(most, out)
        await settle()
        out--
      })
    )
    await Promise.all(sends)
    expect(most).toBe(6)
  })

  it('lets the writer’s requests go before a job’s', async () => {
    const busy = deferred()
    const order = []
    const first = throughGate(taking(1), {}, () => busy.promise)
    await settle()
    const job = throughGate(taking(1), { urgency: 'later' }, async () => order.push('job'))
    const turn = throughGate(taking(1), { urgency: 'now' }, async () => order.push('turn'))

    busy.resolve()
    await Promise.all([first, job, turn])
    expect(order).toEqual(['turn', 'job'])
  })

  it('stops waiting when stopped, and gives no place away', async () => {
    const busy = deferred()
    const first = throughGate(taking(1), {}, () => busy.promise)
    await settle()
    const stop = new AbortController()
    const send = vi.fn()
    const waiting = throughGate(taking(1), { signal: stop.signal }, send)

    stop.abort(new Error('stopped'))
    await expect(waiting).rejects.toThrow('stopped')
    busy.resolve()
    await first
    expect(send).not.toHaveBeenCalled()

    expect(await throughGate(taking(1), {}, async () => 'next')).toBe('next')
  })

  it('asks again after the wait the service asked for', async () => {
    vi.useFakeTimers()
    const send = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitedError('Rate limited.', 3000))
      .mockResolvedValueOnce('answered')

    const asked = throughGate(hosted, {}, send)
    await vi.advanceTimersByTimeAsync(2900)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)

    expect(await asked).toBe('answered')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('waits longer each time a service says no without saying how long, and gives up', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockRejectedValue(new RateLimitedError('Rate limited.'))
    const asked = throughGate(hosted, {}, send).catch(error => error)

    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16000)
    const failure = await asked

    expect(failure).toBeInstanceOf(RateLimitedError)
    expect(send).toHaveBeenCalledTimes(RATE_RETRIES + 1)
  })

  it('does not wait out a service that says to come back much later', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new RateLimitedError('Out for the day.', LONGEST_WAIT_MS + 1))

    await expect(throughGate(hosted, {}, send)).rejects.toThrow('Out for the day.')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('passes on any other failure as it is', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Bad key'))

    await expect(throughGate(hosted, {}, send)).rejects.toThrow('Bad key')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('asks half as much at once after a refusal, and more again as answers come', async () => {
    vi.useFakeTimers()
    const held = Array.from({ length: 4 }, () => deferred())
    let refused = false
    let out = 0
    let most = 0
    /** @param {number} at */
    const send = at => async () => {
      if (at === 3 && !refused) {
        refused = true
        throw new RateLimitedError('Rate limited.', 1000)
      }
      out++
      most = Math.max(most, out)
      await held[at].promise
      out--
      return at
    }
    const asked = [0, 1, 2, 3].map(at => throughGate(hosted, {}, send(at)))
    await vi.advanceTimersByTimeAsync(0)
    // Three are out; the fourth was refused with four out, so two at once now.
    expect(out).toBe(3)

    await vi.advanceTimersByTimeAsync(1000)
    expect(out).toBe(3)
    held[0].resolve()
    held[1].resolve()
    await vi.advanceTimersByTimeAsync(0)
    // Two answered: the fourth goes in under the eased limit.
    expect(out).toBe(2)
    held[2].resolve()
    held[3].resolve()
    expect(await Promise.all(asked)).toEqual([0, 1, 2, 3])
    expect(most).toBe(3)
  })
})

describe('inTurn', () => {
  it('runs at most so many at a time, in the order they came', async () => {
    const inLine = inTurn(1)
    const first = deferred()
    const order = []
    const a = inLine(async () => {
      order.push('a starts')
      await first.promise
      order.push('a ends')
    })
    const b = inLine(async () => order.push('b starts'))
    await settle()
    expect(order).toEqual(['a starts'])

    first.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a starts', 'a ends', 'b starts'])
  })

  it('runs everything at once with no limit', async () => {
    const inLine = inTurn(Infinity)
    const held = deferred()
    let started = 0
    const runs = [1, 2, 3].map(() => inLine(async () => (started++, held.promise)))
    await settle()
    expect(started).toBe(3)
    held.resolve()
    await Promise.all(runs)
  })
})
