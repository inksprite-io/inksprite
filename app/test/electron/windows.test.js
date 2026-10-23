// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow, shell } from 'electron'
import { bringForward, pagePath, placeBeside, windowOpener } from '../../electron/src/windows.js'

/** A window as Electron makes one, with what the opener calls on it. */
const fakeWindow = ({ bounds = { x: 100, y: 80, width: 1200, height: 800 }, ...state } = {}) => {
  const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() }
  return {
    webContents: contents,
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    getBounds: () => bounds,
    isFullScreen: () => Boolean(state.fullScreen),
    isMaximized: () => Boolean(state.maximized),
    isMinimized: () => Boolean(state.minimized),
    isDestroyed: () => Boolean(state.destroyed),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pagePath', () => {
  it('takes a path of the app', () => {
    expect(pagePath('/')).toBe('/')
    expect(pagePath('/project/story_1')).toBe('/project/story_1')
  })

  it('refuses anything that would lead to another site', () => {
    for (const path of [
      'https://elsewhere.example/',
      '//elsewhere.example/',
      '/\\elsewhere',
      '',
      7,
    ]) {
      expect(() => pagePath(path)).toThrow('Not a path in the app')
    }
  })
})

describe('placeBeside', () => {
  it('opens a window a little down and to the right of the one in front, at its size', () => {
    expect(placeBeside(fakeWindow())).toEqual({ x: 124, y: 104, width: 1200, height: 800 })
  })

  it('opens one at the usual size with no window in front, or one filling the screen', () => {
    const usual = { width: 1400, height: 900 }
    expect(placeBeside(null)).toEqual(usual)
    expect(placeBeside(fakeWindow({ fullScreen: true }))).toEqual(usual)
    expect(placeBeside(fakeWindow({ maximized: true }))).toEqual(usual)
    expect(placeBeside(fakeWindow({ minimized: true }))).toEqual(usual)
  })
})

describe('windowOpener', () => {
  const open = windowOpener('app://inksprite/')

  /** The window the next `new BrowserWindow` makes. */
  const nextWindow = () => {
    const window = fakeWindow()
    BrowserWindow.mockImplementationOnce(function () {
      return window
    })
    return window
  }

  it('opens a window on a path of the page, beside the one in front', () => {
    BrowserWindow.getFocusedWindow.mockReturnValue(fakeWindow())
    const window = nextWindow()

    expect(open('/project/story_1')).toBe(window)
    expect(window.loadURL).toHaveBeenCalledWith('app://inksprite/project/story_1')
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ x: 124, y: 104, show: false, title: 'inksprite' })
    )
  })

  it('opens on the page itself when no path is given', () => {
    BrowserWindow.getFocusedWindow.mockReturnValue(null)
    const window = nextWindow()

    open()
    expect(window.loadURL).toHaveBeenCalledWith('app://inksprite/')
  })

  it('opens no window on an address elsewhere', () => {
    expect(() => open('https://elsewhere.example/')).toThrow('Not a path in the app')
    expect(BrowserWindow).not.toHaveBeenCalled()
  })

  it('sends a link followed in the window to the system browser', () => {
    const window = nextWindow()
    open()
    const [, willNavigate] = window.webContents.on.mock.calls.find(
      ([name]) => name === 'will-navigate'
    )
    const event = { preventDefault: vi.fn() }

    willNavigate(event, 'app://inksprite/project/story_2')
    expect(event.preventDefault).not.toHaveBeenCalled()

    willNavigate(event, 'https://example.com/')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/')
  })
})

describe('bringForward', () => {
  it('brings a window to the front, out of the Dock if it is there', () => {
    const window = fakeWindow({ minimized: true })
    bringForward(window)
    expect(window.restore).toHaveBeenCalled()
    expect(window.focus).toHaveBeenCalled()
  })

  it('leaves a window that is gone', () => {
    const window = fakeWindow({ destroyed: true })
    bringForward(window)
    bringForward(null)
    expect(window.focus).not.toHaveBeenCalled()
  })
})
