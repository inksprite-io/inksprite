import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { clearTerminals, onTerminalEnded, useTerminals } from '@/composables/useTerminals.js'

/** The native side's terminals, and the way to say what becomes of one. */
let native
/** @type {(id: string, event: object) => void} */
let say

beforeEach(() => {
  clearTerminals()
  native = {
    create: vi.fn().mockResolvedValue('terminal:new'),
    list: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn(listener => {
      say = listener
    }),
  }
  globalThis.__INKSPRITE_DESKTOP__ = { terminals: native }
})

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('useTerminals', () => {
  it('asks which terminals the window has, once', async () => {
    native.list.mockResolvedValue([
      { id: 'terminal:1', title: 'zsh' },
      { id: 'terminal:2', title: '' },
    ])
    const terminals = useTerminals()
    expect(terminals.ready.value).toBe(false)
    await flushPromises()

    expect(terminals.ready.value).toBe(true)
    expect(terminals.ids()).toEqual(['terminal:1', 'terminal:2'])
    expect(terminals.get('terminal:1')).toEqual({ id: 'terminal:1', title: 'zsh' })
    useTerminals()
    expect(native.list).toHaveBeenCalledTimes(1)
  })

  it('has none, and is ready, where there are no terminals', () => {
    delete globalThis.__INKSPRITE_DESKTOP__
    const terminals = useTerminals()
    expect(terminals.ready.value).toBe(true)
    expect(terminals.ids()).toEqual([])
  })

  it('is ready with none when they couldn’t be listed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    native.list.mockRejectedValue(new Error('no'))
    const terminals = useTerminals()
    await flushPromises()
    expect(terminals.ready.value).toBe(true)
    expect(terminals.ids()).toEqual([])
    error.mockRestore()
  })

  it('makes a terminal', async () => {
    const terminals = useTerminals()
    expect(await terminals.create()).toBe('terminal:new')
    expect(terminals.has('terminal:new')).toBe(true)
    expect(terminals.get('terminal:new')).toEqual({ id: 'terminal:new', title: '' })
  })

  it('ends one of its own, and no other', async () => {
    const terminals = useTerminals()
    await terminals.create()
    terminals.close('terminal:other')
    expect(native.close).not.toHaveBeenCalled()

    terminals.close('terminal:new')
    expect(native.close).toHaveBeenCalledWith('terminal:new')
    expect(terminals.has('terminal:new')).toBe(false)
  })

  it('takes the name the program in it gives it', async () => {
    const terminals = useTerminals()
    await terminals.create()
    say('terminal:new', { type: 'title', title: 'vim notes.md' })
    expect(terminals.get('terminal:new').title).toBe('vim notes.md')
  })

  it('remembers one that rang until it is seen', async () => {
    const terminals = useTerminals()
    await terminals.create()
    expect(terminals.rang('terminal:new')).toBe(false)

    say('terminal:new', { type: 'bell' })
    expect(terminals.rang('terminal:new')).toBe(true)
    terminals.seen('terminal:new')
    expect(terminals.rang('terminal:new')).toBe(false)
  })

  it('tells who listens that a shell ended, while the terminal is still there, then forgets it', async () => {
    const terminals = useTerminals()
    await terminals.create()
    say('terminal:new', { type: 'bell' })
    const ended = vi.fn(id => expect(terminals.has(id)).toBe(true))
    const stop = onTerminalEnded(ended)

    say('terminal:new', { type: 'exit' })
    expect(ended).toHaveBeenCalledWith('terminal:new', false)
    expect(terminals.has('terminal:new')).toBe(false)
    expect(terminals.rang('terminal:new')).toBe(false)
    expect(native.close).not.toHaveBeenCalled()

    expect(stop()).toBeUndefined()
  })

  it('says which never started', async () => {
    const terminals = useTerminals()
    await terminals.create()
    const ended = vi.fn()
    onTerminalEnded(ended)
    say('terminal:new', { type: 'exit', failed: true })
    expect(ended).toHaveBeenCalledWith('terminal:new', true)
  })

  it('hears nothing of a terminal that isn’t the window’s', () => {
    const terminals = useTerminals()
    const ended = vi.fn()
    onTerminalEnded(ended)
    say('terminal:gone', { type: 'bell' })
    say('terminal:gone', { type: 'exit' })
    expect(terminals.rang('terminal:gone')).toBe(false)
    expect(ended).not.toHaveBeenCalled()
  })
})
