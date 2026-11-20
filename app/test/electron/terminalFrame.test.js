// @vitest-environment node
/* global URLSearchParams */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_APPEARANCE,
  appearanceFrom,
  appearanceOf,
  themeFor,
} from '../../electron/terminal/appearance.js'
import { LINE_BREAK, keyAction } from '../../electron/terminal/keys.js'

describe('appearanceFrom', () => {
  it('lays what the page gave over what there was', () => {
    expect(
      appearanceFrom({ dark: true, background: '#1F1F22', foreground: '#ffffff', fontSize: 14 })
    ).toEqual({ dark: true, background: '#1f1f22', foreground: '#ffffff', fontSize: 14 })
    expect(appearanceFrom({ dark: true })).toEqual({ ...DEFAULT_APPEARANCE, dark: true })
  })

  it('takes only colours for colours and sizes for sizes', () => {
    const given = [
      null,
      'dark',
      { dark: 'yes' },
      { background: 'red' },
      { background: '#fff' },
      { background: '#ffffff; background: url(https://example.com/x)' },
      { foreground: 'rgb(0, 0, 0)' },
      { foreground: 12 },
      { fontSize: '14' },
      { fontSize: 200 },
      { fontSize: 2 },
      { fontSize: NaN },
    ]
    for (const one of given) expect(appearanceFrom(one)).toEqual(DEFAULT_APPEARANCE)
  })
})

describe('appearanceOf', () => {
  it('reads what the frame’s address names', () => {
    const params = new URLSearchParams(
      'id=terminal%3A1&dark=1&background=1f1f22&foreground=ffffff&fontSize=12'
    )
    expect(appearanceOf(params)).toEqual({
      dark: true,
      background: '#1f1f22',
      foreground: '#ffffff',
      fontSize: 12,
    })
  })

  it('is as a terminal looks to start with for an address that names nothing, or nonsense', () => {
    expect(appearanceOf(new URLSearchParams('id=terminal%3A1'))).toEqual(DEFAULT_APPEARANCE)
    expect(
      appearanceOf(new URLSearchParams('dark=maybe&background=%22%3E&foreground=zzzzzz&fontSize=x'))
    ).toEqual(DEFAULT_APPEARANCE)
  })
})

describe('themeFor', () => {
  it('wears the page’s colours, with a program’s sixteen to suit the ground', () => {
    const dark = themeFor({
      dark: true,
      background: '#1f1f22',
      foreground: '#ffffff',
      fontSize: 13,
    })
    const light = themeFor({ ...DEFAULT_APPEARANCE })

    expect(dark).toMatchObject({ background: '#1f1f22', foreground: '#ffffff', cursor: '#ffffff' })
    expect(light).toMatchObject({ background: '#ffffff', cursorAccent: '#ffffff' })
    expect(dark.blue).not.toBe(light.blue)
    for (const theme of [dark, light]) {
      for (const colour of Object.values(theme)) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('keyAction', () => {
  /** A key, with the modifiers named held. */
  const key = (name, ...held) => ({
    key: name,
    metaKey: held.includes('meta'),
    ctrlKey: held.includes('ctrl'),
    shiftKey: held.includes('shift'),
    altKey: held.includes('alt'),
  })

  it('types Escape and Enter for Shift-Enter', () => {
    expect(LINE_BREAK).toBe('\x1b\r')
    for (const mac of [true, false]) {
      expect(keyAction(key('Enter', 'shift'), mac)).toBe('lineBreak')
      expect(keyAction(key('Enter'), mac)).toBeNull()
      expect(keyAction(key('Enter', 'shift', 'ctrl'), mac)).toBeNull()
    }
  })

  it('hands the shell everything else typed, Control with it, on every system', () => {
    for (const mac of [true, false]) {
      for (const letter of ['c', 'd', 'f', 'p', 'r', 'w', 'z']) {
        expect(keyAction(key(letter, 'ctrl'), mac)).toBeNull()
      }
      expect(keyAction(key('a'), mac)).toBeNull()
      expect(keyAction(key('b', 'alt'), mac)).toBeNull()
    }
  })

  it('keeps Command for the app on a Mac', () => {
    expect(keyAction(key('c', 'meta'), true)).toBe('browser')
    expect(keyAction(key('v', 'meta'), true)).toBe('browser')
    expect(keyAction(key('a', 'meta'), true)).toBe('selectAll')
    expect(keyAction(key('k', 'meta'), true)).toBe('clear')
    expect(keyAction(key('f', 'meta'), true)).toBe('page')
    expect(keyAction(key('F', 'meta', 'shift'), true)).toBe('page')
    expect(keyAction(key('ƒ', 'meta', 'alt'), true)).toBe('page')
    expect(keyAction(key('V', 'meta', 'shift'), true)).toBe('page')
    // Command on its own, on its way to a shortcut, is nothing yet.
    expect(keyAction(key('Meta', 'meta'), true)).toBeNull()
  })

  it('copies and pastes on Control-Shift off a Mac, as terminals there do', () => {
    expect(keyAction(key('C', 'ctrl', 'shift'), false)).toBe('copy')
    expect(keyAction(key('V', 'ctrl', 'shift'), false)).toBe('paste')
    expect(keyAction(key('c', 'meta'), false)).toBeNull()
    expect(keyAction(key('C', 'ctrl', 'shift'), true)).toBeNull()
  })
})
