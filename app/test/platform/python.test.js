/* global AbortController */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { hasPython, runPython } from '@/platform/python.js'

const ran = { stdout: '42', stderr: '', value: null, error: null, restarted: false }

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('hasPython', () => {
  it('is the desktop app’s alone, and one new enough to have it', () => {
    expect(hasPython()).toBe(false)
    globalThis.__INKSPRITE_DESKTOP__ = {}
    expect(hasPython()).toBe(false)
    globalThis.__INKSPRITE_DESKTOP__ = { python: { run: vi.fn(), stop: vi.fn() } }
    expect(hasPython()).toBe(true)
  })
})

describe('runPython', () => {
  it('runs code in the session it names', async () => {
    const python = { run: vi.fn().mockResolvedValue(ran), stop: vi.fn() }
    globalThis.__INKSPRITE_DESKTOP__ = { python }

    expect(await runPython('chat-1', 'print(42)')).toBe(ran)
    expect(python.run).toHaveBeenCalledWith(
      'chat-1',
      'print(42)',
      { timeoutMs: null, project: null, filename: null },
      undefined
    )

    const project = [{ path: 'Notes', id: 'doc_1', text: 'kept' }]
    const fetchFile = vi.fn()
    await runPython('chat-1', 'print(42)', {
      timeoutMs: 600000,
      project,
      filename: '/project/a.py',
      fetchFile,
    })
    expect(python.run).toHaveBeenLastCalledWith(
      'chat-1',
      'print(42)',
      { timeoutMs: 600000, project, filename: '/project/a.py' },
      fetchFile
    )
  })

  it('stops the session’s run when the call is stopped, and not after it is done', async () => {
    let finish
    const python = {
      run: vi.fn(() => new Promise(resolve => (finish = resolve))),
      stop: vi.fn(),
    }
    globalThis.__INKSPRITE_DESKTOP__ = { python }
    const controller = new AbortController()

    const running = runPython('chat-1', 'while True: pass', { signal: controller.signal })
    controller.abort()
    expect(python.stop).toHaveBeenCalledWith('chat-1')
    finish(ran)
    await running

    const done = new AbortController()
    python.run.mockResolvedValue(ran)
    await runPython('chat-1', '1', { signal: done.signal })
    done.abort()
    expect(python.stop).toHaveBeenCalledTimes(1)
  })

  it('refuses in a browser', async () => {
    await expect(runPython('chat-1', '1')).rejects.toThrow('only in the desktop app')
  })
})
