// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const updates = vi.hoisted(() => ({ installingUpdate: vi.fn(() => false) }))
vi.mock('../../electron/src/updates.js', () => updates)

/** Electron's stand-ins, the ones closing.js has. */
let app, ipcMain

/** closing.js afresh, since it keeps whether the app is quitting. */
const load = async () => {
  ;({ app, ipcMain } = await import('electron'))
  return import('../../electron/src/closing.js')
}

/** A window and its page, which hears what it is sent. */
const makeWindow = ({ crashed = false } = {}) => {
  /** @type {Record<string, Function>} */
  const listeners = {}
  const contents = {
    send: vi.fn(),
    isDestroyed: () => false,
    isCrashed: () => crashed,
  }
  const window = {
    webContents: contents,
    on: (name, listener) => (listeners[name] = listener),
    isDestroyed: () => false,
    /** Close it as the writer would, and say whether it went. */
    close: vi.fn(() => {
      const event = { preventDefault: vi.fn() }
      listeners.close(event)
      return !event.preventDefault.mock.calls.length
    }),
  }
  return window
}

/** The page answers that it has saved. */
const pageSaved = window => {
  for (const [channel, listener] of ipcMain.on.mock.calls) {
    if (channel === 'window:saved') listener({ sender: window.webContents })
  }
}

/** The app starts to quit, as Command-Q would. */
const startQuit = () => {
  for (const [name, listener] of app.on.mock.calls) if (name === 'before-quit') listener()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  updates.installingUpdate.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('saveBeforeClosing', () => {
  it('asks the page to save, and closes once it has', async () => {
    const { saveBeforeClosing } = await load()
    const window = makeWindow()
    saveBeforeClosing(window)

    expect(window.close()).toBe(false)
    expect(window.webContents.send).toHaveBeenCalledWith('window:save')
    expect(window.close).toHaveBeenCalledTimes(1)

    pageSaved(window)
    await vi.runAllTimersAsync()
    expect(window.close).toHaveBeenCalledTimes(2)
    expect(window.close.mock.results[1].value).toBe(true)
    expect(app.quit).not.toHaveBeenCalled()
    expect(ipcMain.removeListener).toHaveBeenCalled()
  })

  it('asks once, however many times the window is closed meanwhile', async () => {
    const { saveBeforeClosing } = await load()
    const window = makeWindow()
    saveBeforeClosing(window)

    window.close()
    window.close()
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('quits again once the page has saved, when the app was quitting', async () => {
    const { saveBeforeClosing } = await load()
    const window = makeWindow()
    saveBeforeClosing(window)

    startQuit()
    expect(window.close()).toBe(false)
    pageSaved(window)
    await vi.runAllTimersAsync()
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(window.close).toHaveBeenCalledTimes(1)
  })

  it('closes all the same when the page never answers', async () => {
    const { SAVE_WAIT_MS, saveBeforeClosing } = await load()
    const window = makeWindow()
    saveBeforeClosing(window)

    window.close()
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS - 1)
    expect(window.close).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(window.close).toHaveBeenCalledTimes(2)
    expect(window.close.mock.results[1].value).toBe(true)
  })

  it('does not wait on another window’s page', async () => {
    const { saveBeforeClosing } = await load()
    const window = makeWindow()
    saveBeforeClosing(window)

    window.close()
    pageSaved(makeWindow())
    await vi.advanceTimersByTimeAsync(0)
    expect(window.close).toHaveBeenCalledTimes(1)
  })

  it('does not ask a page that has crashed', async () => {
    const { saveBeforeClosing } = await load()
    const window = makeWindow({ crashed: true })
    saveBeforeClosing(window)

    window.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(window.close).toHaveBeenCalledTimes(2)
  })

  it('lets an update close the window without asking', async () => {
    const { saveBeforeClosing } = await load()
    const window = makeWindow()
    saveBeforeClosing(window)
    updates.installingUpdate.mockReturnValue(true)

    expect(window.close()).toBe(true)
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
