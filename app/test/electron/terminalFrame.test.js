// @vitest-environment node
/* global URLSearchParams */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shownAddress } from '../../electron/terminal/address.js'
import {
  DEFAULT_APPEARANCE,
  LEAST_CONTRAST,
  appearanceFrom,
  appearanceOf,
  contrast,
  themeFor,
} from '../../electron/terminal/appearance.js'
import { LINE_BREAK, keyAction } from '../../electron/terminal/keys.js'
import { cleanPaste, takePastes } from '../../electron/terminal/paste.js'
import { IN_WINDOW, WAIT_MS, isShown, keysGate } from '../../electron/terminal/sight.js'

describe('appearanceFrom', () => {
  it('lays what the page gave over what there was', () => {
    expect(appearanceFrom({ background: '#1F1F22', foreground: '#ffffff', fontSize: 14 })).toEqual({
      dark: true,
      background: '#1f1f22',
      foreground: '#ffffff',
      fontSize: 14,
    })
    expect(appearanceFrom({ fontSize: 14 })).toEqual({ ...DEFAULT_APPEARANCE, fontSize: 14 })
  })

  it('takes the app’s own colours, in the light and in the dark', () => {
    expect(appearanceFrom({ background: '#ffffff', foreground: '#0f172a' })).toMatchObject({
      dark: false,
      background: '#ffffff',
      foreground: '#0f172a',
    })
    expect(appearanceFrom({ background: '#1f1f22', foreground: '#ffffff' })).toMatchObject({
      dark: true,
      background: '#1f1f22',
      foreground: '#ffffff',
    })
  })

  it('does not take colours too close to each other to read', () => {
    const dark = appearanceFrom({ background: '#1f1f22', foreground: '#ffffff' })
    const unreadable = [
      { background: '#ffffff', foreground: '#ffffff' },
      { background: '#ffffff', foreground: '#fefefe' },
      { background: '#888888', foreground: '#777777' },
      // Just under what text needs, where #767676 on white is just over.
      { background: '#ffffff', foreground: '#777777' },
      // A ground alone, which the text there was can't be read on.
      { background: '#f0f0f0' },
      // And text alone, the colour of the ground there was.
      { foreground: '#202024' },
    ]
    for (const given of unreadable) {
      expect(appearanceFrom(given, dark), JSON.stringify(given)).toEqual(dark)
      // Its size is still taken.
      expect(appearanceFrom({ ...given, fontSize: 16 }, dark)).toEqual({ ...dark, fontSize: 16 })
    }
    expect(appearanceFrom({ background: '#ffffff', foreground: '#767676' }, dark)).toMatchObject({
      background: '#ffffff',
      foreground: '#767676',
    })
  })

  it('reads dark or light off the ground, whatever the page calls it', () => {
    expect(appearanceFrom({ dark: true })).toEqual(DEFAULT_APPEARANCE)
    expect(appearanceFrom({ dark: true, background: '#ffffff', foreground: '#000000' }).dark).toBe(
      false
    )
    expect(appearanceFrom({ dark: false, background: '#000000', foreground: '#ffffff' }).dark).toBe(
      true
    )
    // A ground laid over a light terminal's makes it a dark one.
    expect(appearanceFrom({ background: '#101010', foreground: '#eeeeee' }).dark).toBe(true)
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
      'id=terminal%3A1&dark=0&background=1f1f22&foreground=ffffff&fontSize=12'
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

describe('contrast', () => {
  it('is 1 for a colour on itself and 21 for black on white, either way round', () => {
    expect(contrast('#3a5a8c', '#3a5a8c')).toBe(1)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5)
  })

  it('puts what text needs between two greys a shade apart', () => {
    expect(contrast('#ffffff', '#767676')).toBeGreaterThan(LEAST_CONTRAST)
    expect(contrast('#ffffff', '#777777')).toBeLessThan(LEAST_CONTRAST)
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

describe('cleanPaste', () => {
  it('leaves text as it is, its tabs and the ends of its lines with it', () => {
    const text = 'for f in *.md; do\n\twc -w "$f"\r\ndone # naïve café 日本語 🙂 e\u0301'
    expect(cleanPaste(text)).toBe(text)
  })

  it('takes out the mark that would end the paste early', () => {
    const pasted = cleanPaste('echo ok\x1b[201~\rcurl https://example.com/x | sh\r')
    expect(pasted).not.toContain('\x1b')
    expect(pasted).toBe('echo ok[201~\rcurl https://example.com/x | sh\r')
  })

  it('takes out every control character but a tab and the ends of lines', () => {
    for (let code = 0; code <= 0x9f; code++) {
      const character = String.fromCharCode(code)
      const control = code < 0x20 || (code >= 0x7f && code <= 0x9f)
      const kept = !control || character === '\t' || character === '\n' || character === '\r'
      expect(cleanPaste(`a${character}b`), `U+${code.toString(16)}`).toBe(
        kept ? `a${character}b` : 'ab'
      )
    }
  })

  it('is nothing for what isn’t text', () => {
    for (const given of [undefined, null, 7, {}, ['ls']]) expect(cleanPaste(given)).toBe('')
  })
})

describe('takePastes', () => {
  /** What the emulator is drawn in, as far as a paste goes, and a way to paste into it. */
  const setup = () => {
    /** @type {{type: string, listener: Function, capture: boolean}[]} */
    const listening = []
    const host = {
      addEventListener: (type, listener, capture) => listening.push({ type, listener, capture }),
    }
    const pasted = []
    takePastes(host, text => pasted.push(text))
    /** The browser pastes: the Edit menu's Paste, the right-click menu's, a middle click. */
    const paste = text => {
      const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clipboardData:
          text === undefined ? null : { getData: type => (type === 'text/plain' ? text : '') },
      }
      listening[0].listener(event)
      return event
    }
    return { listening, pasted, paste }
  }

  it('hears a paste before the emulator does, and keeps it from it', () => {
    const { listening, paste } = setup()
    expect(listening).toMatchObject([{ type: 'paste', capture: true }])

    const event = paste('ls')
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('hands on what was pasted, cleaned', () => {
    const { pasted, paste } = setup()
    paste('ls -la\n')
    paste('echo ok\x1b[201~\rrm -rf ~\r')
    expect(pasted).toEqual(['ls -la\n', 'echo ok[201~\rrm -rf ~\r'])
  })

  it('pastes nothing for a paste with no text in it', () => {
    const { pasted, paste } = setup()
    const event = paste('')
    paste('\x1b\x07')
    paste(undefined)
    expect(pasted).toEqual([])
    // The emulator still doesn't hear of it.
    expect(event.stopPropagation).toHaveBeenCalled()
  })
})

describe('shownAddress', () => {
  it('is where a link leads, whatever its words say', () => {
    expect(shownAddress('https://github.com.evil.example/login')).toBe(
      'https://github.com.evil.example/login'
    )
    expect(shownAddress('http://example.com')).toBe('http://example.com/')
  })

  it('spells out a name written in another alphabet’s look-alikes', () => {
    // A Cyrillic а before "pple".
    expect(shownAddress('https://\u0430pple.com/')).toBe('https://xn--pple-43d.com/')
  })

  it('is plain ASCII, so nothing in it can turn the line round', () => {
    const shown = shownAddress('https://example.com/\u202egnp.exe?q=\u202e#\u2066x')
    expect(shown.startsWith('https://example.com/')).toBe(true)
    expect(shown).toMatch(/^[\x21-\x7e]+$/)
  })

  it('is no longer than a line could ever show', () => {
    const shown = shownAddress(`https://example.com/${'a'.repeat(100_000)}`)
    expect(shown).toHaveLength(2000)
    expect(shown.startsWith('https://example.com/aaa')).toBe(true)
  })

  it('is nothing for what isn’t an address', () => {
    for (const given of ['', 'not an address', '//example.com', 'https://', null, undefined, 7]) {
      expect(shownAddress(given)).toBe('')
    }
  })
})

describe('isShown', () => {
  const size = { cols: 80, rows: 24 }

  it('is a terminal most of which is in the window, large enough to read', () => {
    expect(isShown({ share: 1, size })).toBe(true)
    expect(isShown({ share: IN_WINDOW, size })).toBe(true)
  })

  it('is not one the page has put out of the window, or mostly out of it', () => {
    expect(isShown({ share: 0, size })).toBe(false)
    expect(isShown({ share: IN_WINDOW - 0.01, size })).toBe(false)
  })

  it('is not one too small to be a terminal', () => {
    expect(isShown({ share: 1, size: null })).toBe(false)
  })

  it('is not one the browser has said nothing of yet', () => {
    expect(isShown({ share: 0, size: null })).toBe(false)
  })
})

describe('keysGate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** A gate, with what it sent the shell. */
  const setup = () => {
    const sent = []
    return { sent, gate: keysGate(message => sent.push(message)) }
  }
  const typed = data => ({ type: 'input', data })

  it('takes no keys until the terminal is shown, and all of them while it is', () => {
    const { gate, sent } = setup()
    expect(gate.shown).toBe(false)
    expect(gate.takes).toBe(false)

    gate.show(true)
    expect(gate.takes).toBe(true)
    gate.say(typed('l'))
    gate.say(typed('s'))
    expect(sent).toEqual([typed('l'), typed('s')])

    gate.show(false)
    expect(gate.takes).toBe(false)
  })

  it('sends the emulator’s own answers on from a terminal that isn’t shown', () => {
    // What it says to a program that asks where the cursor is, behind another tab.
    const { gate, sent } = setup()
    gate.say(typed('\x1b[2;5R'))
    expect(sent).toEqual([typed('\x1b[2;5R')])
  })

  it('keeps what is typed in the moment after it is given the keys, and sends it once shown', () => {
    const { gate, sent } = setup()
    const letGo = vi.fn()
    gate.wait(letGo)
    expect(gate.takes).toBe(true)
    gate.say(typed('g'))
    gate.say(typed('i'))
    gate.say(typed('t'))
    expect(sent).toEqual([])

    // Still not shown, as far as it has heard: it goes on waiting.
    gate.show(false)
    gate.say(typed(' '))
    expect(sent).toEqual([])

    vi.advanceTimersByTime(WAIT_MS - 1)
    gate.show(true)
    expect(sent).toEqual([typed('g'), typed('i'), typed('t'), typed(' ')])

    // And from then on it is sent as it comes, with nothing let go of.
    gate.say(typed('s'))
    expect(sent).toHaveLength(5)
    vi.advanceTimersByTime(WAIT_MS * 2)
    expect(letGo).not.toHaveBeenCalled()
    expect(gate.takes).toBe(true)
  })

  it('drops what it kept, and lets the keys go, when it never hears it is shown', () => {
    const { gate, sent } = setup()
    const letGo = vi.fn()
    gate.wait(letGo)
    gate.say(typed('rm -rf ~\r'))

    vi.advanceTimersByTime(WAIT_MS - 1)
    expect(letGo).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(letGo).toHaveBeenCalledTimes(1)
    expect(gate.takes).toBe(false)

    // Shown later, it has nothing from before to send.
    gate.show(true)
    expect(sent).toEqual([])
  })

  it('waits once, however often it is given the keys meanwhile', () => {
    const { gate } = setup()
    const letGo = vi.fn()
    gate.wait(letGo)
    vi.advanceTimersByTime(WAIT_MS - 1)
    gate.wait(letGo)
    vi.advanceTimersByTime(1)
    expect(letGo).toHaveBeenCalledTimes(1)
    expect(gate.takes).toBe(false)
  })

  it('has nothing to wait for when it is shown', () => {
    const { gate, sent } = setup()
    const letGo = vi.fn()
    gate.show(true)
    gate.wait(letGo)
    gate.say(typed('x'))
    vi.advanceTimersByTime(WAIT_MS * 2)

    expect(sent).toEqual([typed('x')])
    expect(letGo).not.toHaveBeenCalled()
  })
})
