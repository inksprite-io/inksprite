// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Window } from 'happy-dom'
import { DEFAULT_APPEARANCE, themeFor } from '../../electron/terminal/appearance.js'
import { LINE_BREAK } from '../../electron/terminal/keys.js'
import { WAIT_MS } from '../../electron/terminal/sight.js'

/**
 * The emulator, stood in for. The desktop app serves the real one to the
 * frame at `./xterm/`, and there are no such files beside the script. So the
 * three are mocked below under the names the script asks for them by, not by
 * their paths from here: a module that can't be found is matched to its
 * stand-in by the name it is asked for. That only holds in the node
 * environment, which is why this file makes its own window: in a page's
 * environment an import that can't be found is refused before any stand-in
 * is looked for.
 */
const xterm = vi.hoisted(() => {
  const made = {
    /** The emulator the script made. @type {any} */
    terminal: null,
    /** The size the frame has room for, or null while it is hidden. @type {{cols: number, rows: number}|null} */
    room: null,
    /** What a link found in the text does under the pointer, as one a program made does. @type {any} */
    found: null,
  }

  class Terminal {
    constructor(options) {
      this.options = options
      this.cols = 80
      this.rows = 24
      /** What is selected in it. */
      this.selection = ''
      /** What was done to its screen, in order. */
      this.did = []
      /** Says the last thing written has been drawn. @type {(() => void)|undefined} */
      this.drawn = undefined
      /** Where it takes what is typed, there once it is drawn. @type {any} */
      this.textarea = undefined
      this.loadAddon = vi.fn()
      this.open = vi.fn(host => {
        this.textarea = host.ownerDocument.createElement('textarea')
        host.appendChild(this.textarea)
      })
      this.focus = vi.fn()
      this.blur = vi.fn()
      this.paste = vi.fn()
      this.clear = vi.fn()
      this.selectAll = vi.fn()
      made.terminal = this
    }
    reset() {
      this.did.push(['reset'])
    }
    resize(cols, rows) {
      Object.assign(this, { cols, rows })
      this.did.push(['resize', cols, rows])
    }
    write(data, drawn) {
      this.did.push(['write', data])
      this.drawn = drawn
    }
    hasSelection() {
      return this.selection !== ''
    }
    getSelection() {
      return this.selection
    }
    /** What is typed in it goes to `type`, and a key is first put to `key`. */
    onData(listener) {
      this.type = listener
    }
    onBinary(listener) {
      this.typeBinary = listener
    }
    attachCustomKeyEventHandler(handler) {
      this.key = handler
    }
  }

  class FitAddon {
    proposeDimensions() {
      return made.room ?? undefined
    }
  }

  class WebLinksAddon {
    constructor(activate, over) {
      made.found = { activate, ...over }
    }
  }

  return { made, Terminal, FitAddon, WebLinksAddon }
})

vi.mock('./xterm/xterm.mjs', () => ({ Terminal: xterm.Terminal }))
vi.mock('./xterm/addon-fit.mjs', () => ({ FitAddon: xterm.FitAddon }))
vi.mock('./xterm/addon-web-links.mjs', () => ({ WebLinksAddon: xterm.WebLinksAddon }))

/** Where the app's page is, which the frame is set in. */
const PAGE = 'app://inksprite'

/** The frame's window. @type {any} */
let window
/** The app's page around it: what the frame posts to. */
let page
/** The way to the shell, which the desktop app hands the frame. */
let shell
let clipboard
/** Says the frame's place in the panel has changed size. @type {() => void} */
let resized
/**
 * Says how much of the frame is in the window, of 1, as the browser does a
 * moment after it is so.
 * @type {(share: number) => void}
 */
let inWindow

beforeEach(() => {
  vi.resetModules()
  window = new Window()
  window.document.body.innerHTML = '<div id="terminal"></div><div id="address" hidden></div>'
  // The keys are elsewhere, until a test gives them to the frame.
  vi.spyOn(window.document, 'hasFocus').mockReturnValue(false)
  page = { postMessage: vi.fn() }
  window.parent = page
  shell = { attach: vi.fn(), send: vi.fn() }
  clipboard = { writeText: vi.fn(), readText: vi.fn(async () => '') }
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback) {
        resized = callback
      }
      observe() {}
    }
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback) {
        inWindow = share => callback([{ intersectionRatio: share }])
      }
      observe() {}
    }
  )
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await window.happyDOM.close()
})

/**
 * Load the frame's page: its script runs as it is imported, against the
 * window it is in.
 *
 * @param {Object} [given]
 * @param {string} [given.search] - What the frame's address names
 * @param {boolean} [given.mac] - Whether it is on a Mac
 * @param {{cols: number, rows: number}|null} [given.room] - The size there
 *   is room for; null for a frame that is hidden
 * @param {boolean} [given.handed] - Whether it is handed the way to its shell
 * @param {boolean} [given.shown] - Whether the browser has said all of the
 *   frame is in the window, so that the terminal is shown if it has room.
 *   Until it says, the terminal is not.
 * @returns {Promise<any>} The emulator it made
 */
const load = async ({
  search = '?id=terminal%3A1',
  mac = false,
  room = { cols: 80, rows: 24 },
  handed = true,
  shown = true,
} = {}) => {
  xterm.made.room = room
  if (handed) window.__INKSPRITE_TERMINAL__ = shell
  vi.stubGlobal('location', { search, ancestorOrigins: [PAGE] })
  vi.stubGlobal('navigator', { platform: mac ? 'MacIntel' : 'Linux x86_64', clipboard })
  await import('../../electron/terminal/frame.js')
  if (shown) inWindow(1)
  return xterm.made.terminal
}

/**
 * The frame's place changes size, and is left to settle.
 * @param {{cols: number, rows: number}|null} room
 */
const resize = room => {
  xterm.made.room = room
  resized()
  vi.runOnlyPendingTimers()
}

/** What the shell's side says to the frame that asked for it. */
const fromShell = message => shell.attach.mock.calls[0][1](message)

/**
 * A key pressed in the terminal, which the emulator first asks about.
 *
 * @param {any} terminal
 * @param {string} key
 * @param {object} [held] - The modifiers held, and anything else of the event
 * @returns {{event: any, typed: boolean}} The event, and whether the
 *   emulator goes on to type the key for the shell
 */
const press = (terminal, key, held = {}) => {
  const event = {
    type: 'keydown',
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...held,
  }
  return { event, typed: terminal.key(event) }
}

/** Something said to the frame's window: by the page around it, unless by another. */
const tell = (data, source = page) =>
  window.dispatchEvent(new window.MessageEvent('message', { data, source }))

/** The page gives the frame the keys, as when the terminal's tab is brought forward. */
const giveKeys = () => window.dispatchEvent(new window.Event('focus'))

/**
 * A paste the browser makes in the terminal, where the emulator takes what
 * is typed: the Edit menu's, a right click's, a middle click's.
 *
 * @param {any} terminal
 * @param {string} text - What the clipboard holds
 * @returns {{event: any, emulator: import('vitest').Mock}} The event as it
 *   was left, and what the emulator's own listener heard of it
 */
const pasteIn = (terminal, text) => {
  const emulator = vi.fn()
  terminal.textarea.addEventListener('paste', emulator)
  const event = new window.Event('paste', { bubbles: true, cancelable: true })
  event.clipboardData = { getData: type => (type === 'text/plain' ? text : '') }
  terminal.textarea.dispatchEvent(event)
  return { event, emulator }
}

/**
 * Text with what a paste may not carry (the mark that ends a paste, a bell,
 * a delete) among what it may (a tab and the ends of lines), and the same
 * text cleaned.
 */
const DIRTY = 'one\x1b[201~two\tthree\r\nfour\x07\x7f\n'
const CLEANED = 'one[201~two\tthree\r\nfour\n'

/** The frame's two colours, as its stylesheet is given them. */
const colours = () => {
  const { style } = window.document.documentElement
  return { ground: style.getPropertyValue('--ground'), text: style.getPropertyValue('--text') }
}

/** The line at the frame's foot, which says where a link leads. */
const foot = () => window.document.getElementById('address')

describe('a terminal’s frame', () => {
  describe('asking for its shell', () => {
    it('asks for the terminal its address names, at the size it has room for', async () => {
      const terminal = await load({ room: { cols: 96, rows: 30 } })

      expect(shell.attach).toHaveBeenCalledTimes(1)
      expect(shell.attach.mock.calls[0][0]).toEqual({ id: 'terminal:1', cols: 96, rows: 30 })
      expect([terminal.cols, terminal.rows]).toEqual([96, 30])
    })

    it('waits to ask until it has a size, which a frame behind another tab has not', async () => {
      await load({ room: null, shown: false })
      expect(shell.attach).not.toHaveBeenCalled()

      // Still hidden, and then all but: too narrow to be showing.
      resize(null)
      resize({ cols: 4, rows: 24 })
      expect(shell.attach).not.toHaveBeenCalled()

      resize({ cols: 96, rows: 30 })
      expect(shell.attach).toHaveBeenCalledTimes(1)
      expect(shell.attach.mock.calls[0][0]).toEqual({ id: 'terminal:1', cols: 96, rows: 30 })
    })

    it('asks once, and from then on tells the shell the size it settles at', async () => {
      const terminal = await load()

      // A panel's edge dragged: many sizes, and the shell told the last.
      xterm.made.room = { cols: 100, rows: 30 }
      resized()
      xterm.made.room = { cols: 120, rows: 40 }
      resized()
      expect(shell.send).not.toHaveBeenCalled()
      vi.runOnlyPendingTimers()

      expect(shell.attach).toHaveBeenCalledTimes(1)
      expect(shell.send.mock.calls).toEqual([[{ type: 'resize', cols: 120, rows: 40 }]])
      expect([terminal.cols, terminal.rows]).toEqual([120, 40])
    })

    it('tells the shell no size while it is hidden', async () => {
      await load()
      resize(null)
      expect(shell.send).not.toHaveBeenCalled()
    })

    it('asks for nothing where its address names no terminal', async () => {
      await load({ search: '' })
      resize({ cols: 96, rows: 30 })
      expect(shell.attach).not.toHaveBeenCalled()
    })

    it('stands idle where it is handed no way to a shell', async () => {
      const terminal = await load({ handed: false })

      expect(() => {
        resize({ cols: 96, rows: 30 })
        terminal.type('ls\r')
        press(terminal, 'Enter', { shiftKey: true })
      }).not.toThrow()
    })
  })

  describe('what its shell sends', () => {
    it('draws what is printed, and says how much once it is drawn', async () => {
      const terminal = await load()
      terminal.did.length = 0

      fromShell({ type: 'data', data: 'hello' })
      expect(terminal.did).toEqual([['write', 'hello']])
      expect(shell.send).not.toHaveBeenCalled()

      terminal.drawn()
      expect(shell.send.mock.calls).toEqual([[{ type: 'drawn', count: 5 }]])
    })

    it('writes the screen at the size it was kept at, and then fits it to the frame', async () => {
      const terminal = await load({ room: { cols: 96, rows: 30 } })
      terminal.did.length = 0

      fromShell({ type: 'screen', cols: 120, rows: 40, data: 'as it stood' })
      expect(terminal.did).toEqual([['reset'], ['resize', 120, 40], ['write', 'as it stood']])
      expect(shell.send).not.toHaveBeenCalled()

      terminal.drawn()
      expect(terminal.did.at(-1)).toEqual(['resize', 96, 30])
      expect(shell.send.mock.calls).toEqual([[{ type: 'resize', cols: 96, rows: 30 }]])
    })

    it('takes no more typing once its shell has ended', async () => {
      const terminal = await load()
      fromShell({ type: 'exit' })
      expect(terminal.options.disableStdin).toBe(true)
    })
  })

  describe('typing in it', () => {
    it('sends on what is typed', async () => {
      const terminal = await load()

      terminal.type('ls\r')
      terminal.typeBinary('\x1b[M ab')

      expect(shell.send.mock.calls).toEqual([
        [{ type: 'input', data: 'ls\r' }],
        [{ type: 'binary', data: '\x1b[M ab' }],
      ])
    })

    it('leaves a key to the shell, Control with it', async () => {
      const terminal = await load()

      expect(press(terminal, 'a').typed).toBe(true)
      expect(press(terminal, 'c', { ctrlKey: true }).typed).toBe(true)
      expect(press(terminal, 'Enter', { code: 'Enter' }).typed).toBe(true)
      expect(page.postMessage).not.toHaveBeenCalled()
    })

    it('sends Shift-Enter as a line break, once', async () => {
      const terminal = await load()

      const down = press(terminal, 'Enter', { code: 'Enter', shiftKey: true })
      expect(down.typed).toBe(false)
      expect(down.event.preventDefault).toHaveBeenCalled()
      expect(shell.send.mock.calls).toEqual([[{ type: 'input', data: LINE_BREAK }]])

      // The key coming up types nothing more, and no Enter after it.
      const up = press(terminal, 'Enter', { code: 'Enter', shiftKey: true, type: 'keyup' })
      expect(up.typed).toBe(false)
      expect(shell.send).toHaveBeenCalledTimes(1)
    })

    it('hands the page a key that is the app’s, on a Mac', async () => {
      const terminal = await load({ mac: true })

      expect(press(terminal, 't', { metaKey: true, shiftKey: true }).typed).toBe(false)
      expect(page.postMessage.mock.calls).toEqual([
        [
          {
            type: 'key',
            key: 't',
            code: 'KeyT',
            metaKey: true,
            ctrlKey: false,
            shiftKey: true,
            altKey: false,
          },
          PAGE,
        ],
      ])
      expect(shell.send).not.toHaveBeenCalled()

      // Once, as it goes down.
      press(terminal, 't', { metaKey: true, shiftKey: true, type: 'keyup' })
      expect(page.postMessage).toHaveBeenCalledTimes(1)
    })

    it('hands the page Control-`, and keeps it from the menu, on every system', async () => {
      for (const mac of [true, false]) {
        const terminal = await load({ mac })
        for (const shiftKey of [false, true]) {
          const { event, typed } = press(terminal, shiftKey ? '~' : '`', {
            code: 'Backquote',
            ctrlKey: true,
            shiftKey,
          })
          expect(typed).toBe(false)
          expect(event.preventDefault).toHaveBeenCalled()
        }
        expect(page.postMessage.mock.calls.map(([said]) => [said.key, said.ctrlKey])).toEqual([
          ['`', true],
          ['~', true],
        ])
        expect(shell.send).not.toHaveBeenCalled()
        page.postMessage.mockClear()
      }
    })

    it('leaves copying and pasting to the Edit menu, on a Mac', async () => {
      const terminal = await load({ mac: true })

      for (const key of ['c', 'v', 'x']) {
        const { event, typed } = press(terminal, key, { metaKey: true })
        expect(typed).toBe(false)
        expect(event.preventDefault).not.toHaveBeenCalled()
      }
      expect(page.postMessage).not.toHaveBeenCalled()
      expect(shell.send).not.toHaveBeenCalled()
      expect(clipboard.readText).not.toHaveBeenCalled()
    })

    it('selects everything on Command-A and clears on Command-K, on a Mac', async () => {
      const terminal = await load({ mac: true })

      expect(press(terminal, 'a', { metaKey: true }).typed).toBe(false)
      expect(terminal.selectAll).toHaveBeenCalledTimes(1)

      expect(press(terminal, 'k', { metaKey: true }).typed).toBe(false)
      expect(terminal.clear).toHaveBeenCalledTimes(1)
      // The shell's side keeps a copy of the screen, and clears that too.
      expect(shell.send.mock.calls).toEqual([[{ type: 'clear' }]])
      expect(page.postMessage).not.toHaveBeenCalled()
    })

    it('copies what is selected on Control-Shift-C, off a Mac', async () => {
      const terminal = await load()

      press(terminal, 'C', { ctrlKey: true, shiftKey: true })
      expect(clipboard.writeText).not.toHaveBeenCalled()

      terminal.selection = 'a line of output'
      const { event, typed } = press(terminal, 'C', { ctrlKey: true, shiftKey: true })
      expect(typed).toBe(false)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(clipboard.writeText).toHaveBeenCalledWith('a line of output')
      expect(shell.send).not.toHaveBeenCalled()
    })

    it('pastes on Control-Shift-V, off a Mac', async () => {
      const terminal = await load()
      clipboard.readText.mockResolvedValue('make test')

      expect(press(terminal, 'V', { ctrlKey: true, shiftKey: true }).typed).toBe(false)
      await vi.advanceTimersByTimeAsync(0)

      expect(terminal.paste).toHaveBeenCalledWith('make test')
    })

    it('pastes nothing from a clipboard it may not read', async () => {
      const terminal = await load()
      clipboard.readText.mockRejectedValue(new Error('not allowed'))

      press(terminal, 'V', { ctrlKey: true, shiftKey: true })
      await vi.advanceTimersByTimeAsync(0)

      expect(terminal.paste).not.toHaveBeenCalled()
    })

    it('cleans what it pastes on Control-Shift-V of what would end the paste early', async () => {
      const terminal = await load()
      clipboard.readText.mockResolvedValue(DIRTY)

      press(terminal, 'V', { ctrlKey: true, shiftKey: true })
      await vi.advanceTimersByTimeAsync(0)

      expect(terminal.paste.mock.calls).toEqual([[CLEANED]])
    })

    it('pastes what the browser pastes cleaned too, and keeps the paste from the emulator', async () => {
      const terminal = await load({ mac: true })

      const { event, emulator } = pasteIn(terminal, DIRTY)

      expect(terminal.paste.mock.calls).toEqual([[CLEANED]])
      // The emulator would paste it again, as it came.
      expect(emulator).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(true)
    })
  })

  describe('while it isn’t shown', () => {
    it('takes no key until the browser says at least half of it is in the window', async () => {
      const terminal = await load({ shown: false })
      expect(press(terminal, 'a').typed).toBe(false)

      inWindow(0.4)
      expect(press(terminal, 'a').typed).toBe(false)
      expect(press(terminal, 'Enter', { code: 'Enter', shiftKey: true }).typed).toBe(false)
      expect(shell.send).not.toHaveBeenCalled()

      inWindow(0.5)
      expect(press(terminal, 'a').typed).toBe(true)
      press(terminal, 'Enter', { code: 'Enter', shiftKey: true })
      expect(shell.send.mock.calls).toEqual([[{ type: 'input', data: LINE_BREAK }]])
    })

    it('takes no key in a frame too small to read, however much of it is in the window', async () => {
      const terminal = await load({ room: null })
      expect(press(terminal, 'a').typed).toBe(false)

      resize({ cols: 4, rows: 24 })
      expect(press(terminal, 'a').typed).toBe(false)

      resize({ cols: 80, rows: 24 })
      expect(press(terminal, 'a').typed).toBe(true)
    })

    it('looks at whether it is shown as its place changes size, and again once the size has settled', async () => {
      const terminal = await load()

      // Shrunk to nothing, it lets the keys go at once.
      xterm.made.room = null
      resized()
      expect(press(terminal, 'a').typed).toBe(false)
      vi.runOnlyPendingTimers()

      // Given room again, the emulator may know the size of its letters only
      // once the size has settled.
      resized()
      xterm.made.room = { cols: 80, rows: 24 }
      expect(press(terminal, 'a').typed).toBe(false)
      vi.runOnlyPendingTimers()
      expect(press(terminal, 'a').typed).toBe(true)
    })

    it('hands the page none of the app’s keys, and clears nothing, on a Mac', async () => {
      const terminal = await load({ mac: true, shown: false })

      press(terminal, 't', { metaKey: true })
      press(terminal, 'k', { metaKey: true })

      expect(page.postMessage).not.toHaveBeenCalled()
      expect(terminal.clear).not.toHaveBeenCalled()
      expect(shell.send).not.toHaveBeenCalled()
    })

    it('reads nothing from the clipboard to paste', async () => {
      const terminal = await load({ shown: false })
      clipboard.readText.mockResolvedValue('make test')

      press(terminal, 'V', { ctrlKey: true, shiftKey: true })
      await vi.advanceTimersByTimeAsync(0)

      expect(clipboard.readText).not.toHaveBeenCalled()
      expect(terminal.paste).not.toHaveBeenCalled()
    })

    it('pastes nothing the browser pastes, and keeps the paste from the emulator all the same', async () => {
      const terminal = await load({ shown: false })

      const { event, emulator } = pasteIn(terminal, 'make test')

      expect(terminal.paste).not.toHaveBeenCalled()
      expect(emulator).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(true)
    })

    it('pastes nothing read from the clipboard once it has stopped being shown', async () => {
      const terminal = await load()
      clipboard.readText.mockResolvedValue('make test')

      press(terminal, 'V', { ctrlKey: true, shiftKey: true })
      inWindow(0)
      await vi.advanceTimersByTimeAsync(0)

      expect(clipboard.readText).toHaveBeenCalledTimes(1)
      expect(terminal.paste).not.toHaveBeenCalled()
    })

    it('lets the keys go when it stops being shown, and takes them back when it is shown again', async () => {
      window.document.hasFocus.mockReturnValue(true)
      const terminal = await load()
      expect(terminal.blur).not.toHaveBeenCalled()

      inWindow(0.2)
      expect(terminal.blur).toHaveBeenCalledTimes(1)
      expect(press(terminal, 'a').typed).toBe(false)

      terminal.focus.mockClear()
      inWindow(1)
      expect(terminal.focus).toHaveBeenCalledTimes(1)
      expect(press(terminal, 'a').typed).toBe(true)
    })

    it('lets go of the keys the emulator takes for itself when it is clicked', async () => {
      const terminal = await load({ shown: false })

      terminal.textarea.dispatchEvent(new window.Event('focus'))
      expect(terminal.blur).toHaveBeenCalledTimes(1)

      // Shown, they are its own to take.
      inWindow(1)
      terminal.textarea.dispatchEvent(new window.Event('focus'))
      expect(terminal.blur).toHaveBeenCalledTimes(1)
    })

    it('still sends on what the emulator answers a program that asks it something', async () => {
      const terminal = await load({ shown: false })

      terminal.type('\x1b[2;5R')

      expect(shell.send.mock.calls).toEqual([[{ type: 'input', data: '\x1b[2;5R' }]])
    })
  })

  describe('just given the keys', () => {
    it('takes them at once, before the browser has said whether it is shown', async () => {
      const terminal = await load({ shown: false })

      giveKeys()

      expect(terminal.focus).toHaveBeenCalledTimes(1)
      expect(press(terminal, 'a').typed).toBe(true)
    })

    it('clears nothing until it is shown, on a Mac', async () => {
      const terminal = await load({ mac: true, shown: false })

      giveKeys()
      press(terminal, 'k', { metaKey: true })

      expect(terminal.clear).not.toHaveBeenCalled()
      expect(shell.send).not.toHaveBeenCalled()
    })

    it('keeps what is typed until it is shown, and sends it then, in order', async () => {
      const terminal = await load({ shown: false })

      giveKeys()
      terminal.type('ls')
      press(terminal, 'Enter', { code: 'Enter', shiftKey: true })
      terminal.type('pwd\r')
      expect(shell.send).not.toHaveBeenCalled()

      inWindow(1)
      expect(shell.send.mock.calls).toEqual([
        [{ type: 'input', data: 'ls' }],
        [{ type: 'input', data: LINE_BREAK }],
        [{ type: 'input', data: 'pwd\r' }],
      ])

      // And what is typed from then on goes straight on.
      terminal.type('date\r')
      expect(shell.send).toHaveBeenLastCalledWith({ type: 'input', data: 'date\r' })
    })

    it('takes a paste in that moment too, for the emulator to type', async () => {
      const terminal = await load({ shown: false })

      giveKeys()
      pasteIn(terminal, 'make test')

      expect(terminal.paste.mock.calls).toEqual([['make test']])
    })

    it('drops what was typed, and lets the keys go, if it is never shown', async () => {
      const terminal = await load({ shown: false })

      giveKeys()
      terminal.type('ls\r')

      vi.advanceTimersByTime(WAIT_MS - 1)
      expect(press(terminal, 'a').typed).toBe(true)
      expect(terminal.blur).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(terminal.blur).toHaveBeenCalledTimes(1)
      expect(press(terminal, 'a').typed).toBe(false)

      // Shown later, it has nothing of that left to send.
      inWindow(1)
      expect(shell.send).not.toHaveBeenCalled()
    })

    it('looks again at whether it is shown, and waits for nothing where it is', async () => {
      // In the window, and without room until the emulator knew the size of
      // its letters, which nothing said when it did.
      const terminal = await load({ room: null })
      xterm.made.room = { cols: 80, rows: 24 }

      giveKeys()
      terminal.type('ls\r')

      expect(shell.send.mock.calls).toEqual([[{ type: 'input', data: 'ls\r' }]])
      vi.advanceTimersByTime(WAIT_MS)
      expect(terminal.blur).not.toHaveBeenCalled()
    })
  })

  describe('a link in it', () => {
    const url = 'https://example.com/guide'
    /** The same address as a program might print it. */
    const printed = 'https://EXAMPLE.com/guide'

    it('opens on a click with Command held, on a Mac', async () => {
      const terminal = await load({ mac: true })
      const open = terminal.options.linkHandler.activate

      // A plain click is for selecting, and Control is the shell's.
      open({ metaKey: false, ctrlKey: false }, url)
      open({ metaKey: false, ctrlKey: true }, url)
      expect(shell.send).not.toHaveBeenCalled()

      open({ metaKey: true, ctrlKey: false }, url)
      expect(shell.send.mock.calls).toEqual([[{ type: 'open', url }]])
    })

    it('opens on a click with Control held, off a Mac', async () => {
      const terminal = await load()
      const open = terminal.options.linkHandler.activate

      open({ metaKey: true, ctrlKey: false }, url)
      expect(shell.send).not.toHaveBeenCalled()

      open({ metaKey: false, ctrlKey: true }, url)
      expect(shell.send.mock.calls).toEqual([[{ type: 'open', url }]])
    })

    it('opens the same way where it is only found in the text', async () => {
      await load()

      xterm.made.found.activate({ metaKey: false, ctrlKey: false }, url)
      expect(shell.send).not.toHaveBeenCalled()

      xterm.made.found.activate({ metaKey: false, ctrlKey: true }, url)
      expect(shell.send.mock.calls).toEqual([[{ type: 'open', url }]])
    })

    it('says where it leads at the foot of the frame while the pointer is on it', async () => {
      const terminal = await load()
      const { hover, leave } = terminal.options.linkHandler
      expect(foot().hidden).toBe(true)

      hover({}, printed)
      expect(foot().hidden).toBe(false)
      expect(foot().textContent).toBe(url)

      leave({}, printed)
      expect(foot().hidden).toBe(true)
      expect(foot().textContent).toBe('')
    })

    it('says so the same way where it is only found in the text', async () => {
      await load()
      const { hover, leave } = xterm.made.found

      hover({}, printed)
      expect(foot().hidden).toBe(false)
      expect(foot().textContent).toBe(url)

      leave({}, printed)
      expect(foot().hidden).toBe(true)
      expect(foot().textContent).toBe('')
    })

    it('says nothing for one that leads nowhere', async () => {
      const terminal = await load()
      const { hover } = terminal.options.linkHandler

      hover({}, 'the guide')
      expect(foot().hidden).toBe(true)
      expect(foot().textContent).toBe('')

      // Nor does it leave the last link's address standing.
      hover({}, printed)
      hover({}, 'the guide')
      expect(foot().hidden).toBe(true)
      expect(foot().textContent).toBe('')
    })
  })

  describe('and the page around it', () => {
    const dark = { dark: true, background: '#1f1f22', foreground: '#fafafa', fontSize: 14 }

    it('looks as its address says from its first paint', async () => {
      const terminal = await load({
        search: '?id=terminal%3A1&dark=1&background=1f1f22&foreground=fafafa&fontSize=14',
      })

      expect(terminal.options.fontSize).toBe(14)
      expect(terminal.options.theme).toMatchObject({ background: '#1f1f22', foreground: '#fafafa' })
      expect(colours()).toEqual({ ground: '#1f1f22', text: '#fafafa' })
      expect(terminal.open).toHaveBeenCalledWith(window.document.getElementById('terminal'))
    })

    it('looks as the page says when the app’s theme changes, and fits itself again', async () => {
      const terminal = await load()

      tell({ type: 'appearance', appearance: dark })

      expect(terminal.options.fontSize).toBe(14)
      expect(terminal.options.theme).toMatchObject({ background: '#1f1f22', foreground: '#fafafa' })
      expect(colours()).toEqual({ ground: '#1f1f22', text: '#fafafa' })
      // Text of another size leaves room for another number of lines.
      expect(shell.send.mock.calls).toEqual([[{ type: 'resize', cols: 80, rows: 24 }]])
    })

    it('takes how to look from the page it is set in, and from nothing else', async () => {
      const terminal = await load()
      const before = { ...terminal.options.theme }

      tell({ type: 'appearance', appearance: dark }, { postMessage: vi.fn() })

      expect(terminal.options.theme).toEqual(before)
      expect(shell.send).not.toHaveBeenCalled()
    })

    it('takes no pair of colours from the page too faint to read, though it takes the size sent with them', async () => {
      const terminal = await load()
      const before = { theme: { ...terminal.options.theme }, colours: colours() }

      tell({
        type: 'appearance',
        appearance: { background: '#ffffff', foreground: '#f4f4f4', fontSize: 14 },
      })

      expect(terminal.options.theme).toEqual(before.theme)
      expect(colours()).toEqual(before.colours)
      expect(terminal.options.fontSize).toBe(14)
    })

    it('takes no such pair from its address either', async () => {
      const terminal = await load({
        search: '?id=terminal%3A1&background=202020&foreground=262626',
      })
      const { background, foreground } = DEFAULT_APPEARANCE

      expect(terminal.options.theme).toMatchObject({ background, foreground })
      expect(colours()).toEqual({ ground: background, text: foreground })
    })

    it('is dark or light by its ground, whatever the page calls it', async () => {
      const terminal = await load()
      const night = { background: '#1f1f22', foreground: '#fafafa' }
      const day = { background: '#ffffff', foreground: '#1f2328' }

      tell({ type: 'appearance', appearance: { ...night, dark: false } })
      expect(terminal.options.theme).toEqual(themeFor({ ...night, dark: true, fontSize: 13 }))

      tell({ type: 'appearance', appearance: { ...day, dark: true } })
      expect(terminal.options.theme).toEqual(themeFor({ ...day, dark: false, fontSize: 13 }))
    })

    it('is dark or light by the ground its address names, whatever the address calls it', async () => {
      const terminal = await load({
        search: '?id=terminal%3A1&dark=0&background=1f1f22&foreground=fafafa',
      })

      expect(terminal.options.theme).toEqual(
        themeFor({ dark: true, background: '#1f1f22', foreground: '#fafafa', fontSize: 13 })
      )
    })

    it('types nothing the page says', async () => {
      const terminal = await load()
      terminal.did.length = 0

      tell({ type: 'input', data: 'ls\r' })
      tell({ type: 'data', data: 'ls\r' })
      tell({ type: 'paste', text: 'ls\r' })

      expect(shell.send).not.toHaveBeenCalled()
      expect(terminal.paste).not.toHaveBeenCalled()
      expect(terminal.did).toEqual([])
    })

    it('tells the page it was clicked, so that a menu open there closes', async () => {
      await load()

      window.document
        .getElementById('terminal')
        .dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))

      expect(page.postMessage.mock.calls).toEqual([[{ type: 'pointer' }, PAGE]])
    })

    it('puts the keys in the terminal when its frame is given them', async () => {
      const terminal = await load()
      expect(terminal.focus).not.toHaveBeenCalled()

      giveKeys()

      expect(terminal.focus).toHaveBeenCalledTimes(1)
    })

    it('takes the keys its frame already has once it is shown, and not before', async () => {
      window.document.hasFocus.mockReturnValue(true)
      const terminal = await load({ shown: false })
      expect(terminal.focus).not.toHaveBeenCalled()

      inWindow(1)

      expect(terminal.focus).toHaveBeenCalledTimes(1)
    })
  })
})
