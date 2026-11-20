// @vitest-environment node
/* global AbortController */
import { describe, it, expect, vi } from 'vitest'
import { windowAsker } from '../../electron/src/appCalls.js'

const CONNECTION = {
  id: 'app_1',
  name: 'Claude Code',
  token: 'secret',
  projects: ['story_a'],
  readOnly: false,
  created: 1,
}

const MESSAGE = { jsonrpc: '2.0', id: 7, method: 'tools/list' }

/**
 * A window's page: what it was sent, and the listeners for its closing.
 * @param {number} id
 */
const page = id => {
  /** @type {Record<string, (...args: any[]) => void>} */
  const heard = {}
  const hear = vi.fn((event, listener) => (heard[event] = listener))
  return {
    id,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: hear,
    on: hear,
    off: vi.fn(),
    close: () => heard.destroyed?.(),
    crash: () => heard['render-process-gone']?.(),
    /** Its window goes to another document, or to another place in this one. */
    navigate: (event = { isMainFrame: true, isSameDocument: false }) =>
      heard['did-start-navigation']?.(event),
  }
}

/** The number a page was last asked under. */
const asked = at => at.send.mock.calls.findLast(([channel]) => channel === 'apps:call')[1]

/** Let what is waiting on a promise go on. */
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('windowAsker', () => {
  it('asks the window in front, without the token, and hands back its answer', async () => {
    const front = page(1)
    const asker = windowAsker(() => [front, page(2)])

    const answer = asker.ask(
      CONNECTION,
      MESSAGE,
      new AbortController().signal,
      'http://127.0.0.1:4657'
    )
    await tick()
    const [channel, request, connection, message] = front.send.mock.calls[0]
    expect(channel).toBe('apps:call')
    // With where its app reaches this computer, for a link it is to fetch.
    expect(connection).toEqual({
      id: 'app_1',
      name: 'Claude Code',
      projects: ['story_a'],
      readOnly: false,
      address: 'http://127.0.0.1:4657',
    })
    expect(message).toEqual(MESSAGE)

    asker.answered(1, request, { response: { jsonrpc: '2.0', id: 7, result: {} } })
    expect(await answer).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
  })

  it('asks the next window when one passes, and takes no answer from the wrong page', async () => {
    const front = page(1)
    const behind = page(2)
    const asker = windowAsker(() => [front, behind])

    const answer = asker.ask(CONNECTION, MESSAGE, new AbortController().signal)
    await tick()
    // Another page claiming the front one's number is not listened to.
    asker.answered(2, asked(front), { response: { wrong: true } })
    expect(behind.send).not.toHaveBeenCalled()

    asker.answered(1, asked(front), { pass: 'elsewhere' })
    await tick()
    asker.answered(2, asked(behind), { response: { jsonrpc: '2.0', id: 7, result: { ok: 1 } } })

    expect(await answer).toEqual({ jsonrpc: '2.0', id: 7, result: { ok: 1 } })
  })

  it('says there is no window when there is none', async () => {
    const asker = windowAsker(() => [])
    await expect(asker.ask(CONNECTION, MESSAGE, new AbortController().signal)).rejects.toThrow(
      'inksprite has no window open.'
    )
  })

  it('says the project could not be opened when every window passes on it', async () => {
    const one = page(1)
    const two = page(2)
    const asker = windowAsker(() => [one, two])

    const answer = asker.ask(CONNECTION, MESSAGE, new AbortController().signal)
    answer.catch(() => {})
    await tick()
    asker.answered(1, asked(one), { pass: 'behind' })
    await tick()
    asker.answered(2, asked(two), { pass: 'unready' })

    await expect(answer).rejects.toThrow('couldn’t be opened')
  })

  it('says inksprite is not ready when no page is, or what a page says is no answer', async () => {
    const one = page(1)
    const closed = page(2)
    closed.isDestroyed.mockReturnValue(true)
    const asker = windowAsker(() => [one, closed])

    const answer = asker.ask(CONNECTION, MESSAGE, new AbortController().signal)
    answer.catch(() => {})
    await tick()
    asker.answered(1, asked(one), 'nonsense')

    await expect(answer).rejects.toThrow('isn’t ready')
    expect(closed.send).not.toHaveBeenCalled()
  })

  it('goes on to the next window when the one asked closes', async () => {
    const one = page(1)
    const two = page(2)
    const asker = windowAsker(() => [one, two])

    const answer = asker.ask(CONNECTION, MESSAGE, new AbortController().signal)
    await tick()
    one.close()
    await tick()
    asker.answered(2, asked(two), { response: { jsonrpc: '2.0', id: 7, result: {} } })

    expect(await answer).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
    expect(one.off).toHaveBeenCalledWith('destroyed', expect.any(Function))
  })

  it('goes on to the next window when the one asked is reloaded, or its process ends', async () => {
    for (const leave of [at => at.navigate(), at => at.crash()]) {
      const [front, behind] = [page(1), page(2)]
      const asker = windowAsker(() => [front, behind])

      const answer = asker.ask(CONNECTION, MESSAGE, new AbortController().signal)
      await tick()
      leave(front)
      await tick()
      asker.answered(2, asked(behind), { response: { result: 'behind' } })

      await expect(answer).resolves.toEqual({ result: 'behind' })
    }
  })

  it('goes on waiting through a link followed within the page, and a frame’s own loading', async () => {
    const front = page(1)
    const asker = windowAsker(() => [front, page(2)])

    const answer = asker.ask(CONNECTION, MESSAGE, new AbortController().signal)
    await tick()
    front.navigate({ isMainFrame: true, isSameDocument: true })
    front.navigate({ isMainFrame: false, isSameDocument: false })
    await tick()
    asker.answered(1, asked(front), { response: { result: 'front' } })

    await expect(answer).resolves.toEqual({ result: 'front' })
  })

  it('waits on a page only so long, tells it to stop, and asks no other window', async () => {
    vi.useFakeTimers()
    try {
      const [front, behind] = [page(1), page(2)]
      const asker = windowAsker(() => [front, behind], { patience: 5000 })

      const answer = asker.ask(CONNECTION, MESSAGE, new AbortController().signal)
      const told = expect(answer).rejects.toThrow(/took too long.*may have been done/)
      await vi.advanceTimersByTimeAsync(4999)
      expect(front.send).not.toHaveBeenCalledWith('apps:cancel', expect.anything())
      await vi.advanceTimersByTimeAsync(1)

      await told
      expect(front.send).toHaveBeenCalledWith('apps:cancel', asked(front))
      // The one asked may have done it: nothing is asked of another.
      expect(behind.send).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes a page’s word only for an answer or a pass', async () => {
    const front = page(1)
    const asker = windowAsker(() => [front])

    const answer = asker.ask(CONNECTION, MESSAGE, new AbortController().signal)
    await tick()
    asker.answered(1, asked(front), { late: true })

    await expect(answer).rejects.toThrow('inksprite isn’t ready')
  })

  it('tells the page to stop when the app gives up, and asks no other', async () => {
    const one = page(1)
    const two = page(2)
    const asker = windowAsker(() => [one, two])
    const controller = new AbortController()

    const answer = asker.ask(CONNECTION, MESSAGE, controller.signal)
    answer.catch(() => {})
    await tick()
    const request = asked(one)
    controller.abort()

    await expect(answer).rejects.toThrow('given up on')
    expect(one.send).toHaveBeenCalledWith('apps:cancel', request)
    expect(two.send).not.toHaveBeenCalled()
  })
})
