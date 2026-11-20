import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  TERMINAL_ORIGIN,
  closeTerminal,
  createTerminal,
  hasTerminal,
  isTerminalId,
  listTerminals,
  onTerminalEvent,
  terminalFrameUrl,
} from '@/platform/terminal.js'

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('hasTerminal', () => {
  it('is the desktop app’s alone, and one new enough to have terminals', () => {
    expect(hasTerminal()).toBe(false)
    globalThis.__INKSPRITE_DESKTOP__ = {}
    expect(hasTerminal()).toBe(false)
    globalThis.__INKSPRITE_DESKTOP__ = { terminals: {} }
    expect(hasTerminal()).toBe(true)
  })
})

describe('isTerminalId', () => {
  it('tells a terminal’s id from a chat’s', () => {
    expect(isTerminalId('terminal:0b1f')).toBe(true)
    expect(isTerminalId('chat_terminal:1')).toBe(false)
    expect(isTerminalId('')).toBe(false)
    expect(isTerminalId(null)).toBe(false)
    expect(isTerminalId(undefined)).toBe(false)
  })
})

describe('the window’s terminals', () => {
  it('are made, listed and ended on the native side', async () => {
    const terminals = {
      create: vi.fn().mockResolvedValue('terminal:1'),
      list: vi.fn().mockResolvedValue([{ id: 'terminal:1', title: 'zsh' }]),
      close: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(),
    }
    globalThis.__INKSPRITE_DESKTOP__ = { terminals }

    expect(await createTerminal()).toBe('terminal:1')
    expect(await listTerminals()).toEqual([{ id: 'terminal:1', title: 'zsh' }])
    await closeTerminal('terminal:1')
    expect(terminals.close).toHaveBeenCalledWith('terminal:1')
  })

  it('are heard of by a listener that hands nothing back across the bridge', () => {
    const terminals = { onEvent: vi.fn() }
    globalThis.__INKSPRITE_DESKTOP__ = { terminals }
    const listener = vi.fn(() => new Map())

    onTerminalEvent(listener)
    const [handed] = terminals.onEvent.mock.calls[0]
    expect(handed('terminal:1', { type: 'bell' })).toBeUndefined()
    expect(listener).toHaveBeenCalledWith('terminal:1', { type: 'bell' })
  })

  it('are only in the desktop app', () => {
    expect(() => createTerminal()).toThrow('Terminals are only in the desktop app.')
  })
})

describe('terminalFrameUrl', () => {
  it('names the terminal and how it looks, on the frame’s own origin', () => {
    const url = new URL(
      terminalFrameUrl('terminal:0b1f', {
        dark: true,
        background: '#1f1f22',
        foreground: '#ffffff',
        fontSize: 13,
      })
    )
    expect(`${url.protocol}//${url.host}`).toBe(TERMINAL_ORIGIN)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      id: 'terminal:0b1f',
      dark: '1',
      background: '1f1f22',
      foreground: 'ffffff',
      fontSize: '13',
    })
  })
})
