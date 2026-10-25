// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PythonSessions } from '../../electron/src/sandbox.js'

/**
 * A stand-in for a session's Python: its runs finish when the test says, and
 * it says whether it was closed.
 */
class FakeSandbox {
  running = false
  closed = false
  /** @type {(() => void)[]} */
  finishers = []

  run() {
    this.running = true
    return new Promise(resolve => {
      this.finishers.push(() => {
        this.running = false
        resolve({ stdout: '', stderr: '', value: null, error: null, restarted: false })
      })
    })
  }

  finish() {
    this.finishers.shift()?.()
  }

  close() {
    this.closed = true
    this.running = false
  }
}

/** @type {FakeSandbox[]} */
let made
let sessions

beforeEach(() => {
  vi.useFakeTimers()
  made = []
  sessions = new PythonSessions(() => {
    const sandbox = new FakeSandbox()
    made.push(sandbox)
    return /** @type {any} */ (sandbox)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PythonSessions', () => {
  it('keeps one Python for each session, between its runs', async () => {
    const first = sessions.run('a', 'x = 1')
    made[0].finish()
    await first
    const second = sessions.run('a', 'x')
    made[0].finish()
    await second

    sessions.run('b', 'y = 1')
    expect(made).toHaveLength(2)
  })

  it('closes a Python not run in for an hour', async () => {
    const run = sessions.run('a', 'x = 1')
    made[0].finish()
    await run

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000)
    expect(made[0].closed).toBe(false)
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(made[0].closed).toBe(true)
    expect(sessions.keys).toEqual([])
  })

  it('never closes a Python for being idle while it runs', async () => {
    sessions.run('a', 'while True: pass')
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(made[0].closed).toBe(false)
  })

  it('closes the one run in longest ago past four, unless it is running', async () => {
    for (const key of ['a', 'b', 'c', 'd']) {
      const run = sessions.run(key, '1')
      made.at(-1).finish()
      await run
    }
    sessions.run('a', '2')
    made[0].finish()

    sessions.run('e', '3')
    expect(made[1].closed).toBe(true)
    expect(sessions.keys).toEqual(['c', 'd', 'a', 'e'])

    sessions.run('f', '4')
    expect(made[2].closed).toBe(true)
    expect(made[4].closed).toBe(false)
    expect(sessions.keys).toEqual(['d', 'a', 'e', 'f'])
  })

  it('closes none that is running, and keeps more than four', () => {
    for (const key of ['a', 'b', 'c', 'd', 'e']) sessions.run(key, 'while True: pass')
    expect(made.some(sandbox => sandbox.closed)).toBe(false)
    expect(sessions.keys).toHaveLength(5)
  })

  it('says a session closed since its last run started again', async () => {
    const first = sessions.run('a', 'x = 1')
    made[0].finish()
    expect((await first).restarted).toBe(false)
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    const second = sessions.run('a', 'x')
    made[1].finish()
    expect((await second).restarted).toBe(true)
    const third = sessions.run('a', 'x')
    made[1].finish()
    expect((await third).restarted).toBe(false)
  })

  it('stops a run under way, and leaves a Python waiting for its next run alone', async () => {
    const run = sessions.run('a', 'x = 1')
    made[0].finish()
    await run
    sessions.stop('a')
    expect(made[0].closed).toBe(false)

    sessions.run('a', 'while True: pass')
    sessions.stop('a')
    expect(made[0].closed).toBe(true)
    expect(sessions.keys).toEqual([])
  })
})
