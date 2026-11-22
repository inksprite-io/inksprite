import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  TERMINAL_ORIGIN,
  appShortcutFrom,
  closeTerminal,
  createTerminal,
  hasTerminal,
  isTerminalId,
  listTerminals,
  onTerminalEvent,
  terminalFrameUrl,
  terminalKey,
  terminalSeen,
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

describe('the terminals', () => {
  it('are made in a project, listed, marked seen and ended on the native side', async () => {
    const listed = [{ id: 'terminal:1', project: 'story_1', title: 'zsh', rang: true }]
    const terminals = {
      create: vi.fn().mockResolvedValue('terminal:1'),
      list: vi.fn().mockResolvedValue(listed),
      close: vi.fn().mockResolvedValue(undefined),
      seen: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(),
    }
    globalThis.__INKSPRITE_DESKTOP__ = { terminals }

    expect(await createTerminal('story_1')).toBe('terminal:1')
    expect(terminals.create).toHaveBeenCalledWith('story_1')
    expect(await listTerminals()).toEqual(listed)
    await terminalSeen('terminal:1')
    expect(terminals.seen).toHaveBeenCalledWith('terminal:1')
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
    expect(() => createTerminal('story_1')).toThrow('Terminals are only in the desktop app.')
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

describe('terminalKey', () => {
  /** A key, with Control held unless said otherwise. */
  const press = (key, code, held = {}) => ({
    key,
    code,
    metaKey: false,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    ...held,
  })

  it('shows a terminal on Control-`, and makes one with Shift', () => {
    expect(terminalKey(press('`', 'Backquote'))).toBe('showTerminal')
    expect(terminalKey(press('~', 'Backquote', { shiftKey: true }))).toBe('newTerminal')
  })

  it('goes by the key left of 1, or by ` where the keyboard has it elsewhere', () => {
    expect(terminalKey(press('^', 'Backquote'))).toBe('showTerminal')
    expect(terminalKey(press('`', 'Equal'))).toBe('showTerminal')
    expect(terminalKey(press('~', 'Digit4', { shiftKey: true }))).toBe('newTerminal')
  })

  it('is nothing without Control, or with Command or Option besides', () => {
    expect(terminalKey(press('`', 'Backquote', { ctrlKey: false }))).toBeNull()
    // Command-` goes from window to window on a Mac.
    expect(terminalKey(press('`', 'Backquote', { ctrlKey: false, metaKey: true }))).toBeNull()
    expect(terminalKey(press('`', 'Backquote', { metaKey: true }))).toBeNull()
    expect(terminalKey(press('`', 'Backquote', { altKey: true }))).toBeNull()
    expect(terminalKey(press('t', 'KeyT'))).toBeNull()
  })

  it('makes a terminal on Command-L on a Mac, and Control-Shift-L off one', () => {
    const commandL = press('l', 'KeyL', { ctrlKey: false, metaKey: true })
    const controlShiftL = press('L', 'KeyL', { shiftKey: true })
    expect(terminalKey(commandL, true)).toBe('newTerminal')
    expect(terminalKey(controlShiftL, false)).toBe('newTerminal')
    // Each is nothing on the other's system, and Control-L clears a shell's screen.
    expect(terminalKey(commandL, false)).toBeNull()
    expect(terminalKey(controlShiftL, true)).toBeNull()
    expect(terminalKey(press('l', 'KeyL'), false)).toBeNull()
    expect(terminalKey(press('l', 'KeyL'), true)).toBeNull()
    expect(terminalKey({ ...commandL, shiftKey: true }, true)).toBeNull()
  })
})

describe('appShortcutFrom', () => {
  it('is the shortcut a frame said was pressed, with Command held', () => {
    expect(
      appShortcutFrom({ type: 'key', key: 'f', code: 'KeyF', metaKey: true, shiftKey: true })
    ).toEqual({
      key: 'f',
      code: 'KeyF',
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    })
  })

  it('is nothing without Command: the rest of what is typed is the shell’s', () => {
    expect(appShortcutFrom({ key: 'f', code: 'KeyF', ctrlKey: true })).toBeNull()
    expect(appShortcutFrom({ key: 'f', code: 'KeyF', metaKey: 'yes' })).toBeNull()
    expect(appShortcutFrom({ key: '`', code: 'Backquote' })).toBeNull()
  })

  it('is the terminal’s own key, Control-`, on every system', () => {
    expect(
      appShortcutFrom({ type: 'key', key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true })
    ).toEqual({
      key: '~',
      code: 'Backquote',
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
    })
    expect(appShortcutFrom({ key: '`', code: 'Backquote', ctrlKey: 'yes' })).toBeNull()
  })

  it('is nothing for what isn’t a key', () => {
    for (const said of [
      null,
      'f',
      { metaKey: true },
      { metaKey: true, key: 1, code: 'KeyF' },
      { metaKey: true, key: 'f' },
      { metaKey: true, key: 'f'.repeat(50), code: 'KeyF' },
    ]) {
      expect(appShortcutFrom(said)).toBeNull()
    }
  })
})
