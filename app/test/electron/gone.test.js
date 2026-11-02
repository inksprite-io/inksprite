// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app, dialog } from 'electron'
import { offerReloadWhenGone } from '../../electron/src/gone.js'

// Taken at import, before any test clears the mocks.
const beforeQuit = app.on.mock.calls.find(([name]) => name === 'before-quit')?.[1]

const RELOAD = 0
const CLOSE = 1

/** A window as Electron makes one, with a way to kill its page. */
const fakeWindow = ({ destroyed = false } = {}) => {
  const handlers = new Map()
  const state = { destroyed }
  return {
    state,
    show: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: () => state.destroyed,
    webContents: {
      on: (name, handler) => handlers.set(name, handler),
      getURL: () => 'app://inksprite/project/story_1',
      reload: vi.fn(),
    },
    die: details => handlers.get('render-process-gone')({}, details),
  }
}

describe('offerReloadWhenGone', () => {
  let logs
  /** @type {ReturnType<typeof vi.spyOn>} */
  let said

  beforeEach(async () => {
    vi.clearAllMocks()
    logs = await mkdtemp(path.join(tmpdir(), 'gone-'))
    app.getPath.mockImplementation(name => (name === 'logs' ? logs : ''))
    dialog.showMessageBox.mockResolvedValue({ response: RELOAD })
    said = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    said.mockRestore()
    await rm(logs, { recursive: true, force: true })
  })

  it('logs what the page died of, and where', async () => {
    const window = fakeWindow()
    offerReloadWhenGone(window)

    await window.die({ reason: 'crashed', exitCode: 5 })

    const log = await readFile(path.join(logs, 'windows.log'), 'utf8')
    expect(log).toMatch(/^\d{4}-.*page gone: crashed, exit code 5, at app:\/\/inksprite\/project/)
    expect(said).toHaveBeenCalledWith(expect.stringContaining('page gone: crashed'))
  })

  it('reloads the window when the writer says to', async () => {
    const window = fakeWindow()
    offerReloadWhenGone(window)

    await window.die({ reason: 'crashed', exitCode: 5 })

    expect(window.show).toHaveBeenCalled()
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        message: 'This window stopped working.',
        buttons: ['Reload', 'Close window'],
      })
    )
    expect(window.webContents.reload).toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
  })

  it('takes the window away when the writer says to, with no page to ask to save', async () => {
    dialog.showMessageBox.mockResolvedValue({ response: CLOSE })
    const window = fakeWindow()
    offerReloadWhenGone(window)

    await window.die({ reason: 'crashed', exitCode: 5 })

    expect(window.destroy).toHaveBeenCalled()
    expect(window.webContents.reload).not.toHaveBeenCalled()
  })

  it.each([
    ['oom', 'It ran out of memory. Anything'],
    ['memory-eviction', 'It ran out of memory. Anything'],
    ['killed', 'The system stopped it. Anything'],
    ['crashed', 'Anything'],
  ])('says what can be said of %s', async (reason, start) => {
    const window = fakeWindow()
    offerReloadWhenGone(window)

    await window.die({ reason, exitCode: 1 })

    const { detail } = dialog.showMessageBox.mock.calls[0][1]
    expect(detail.startsWith(start)).toBe(true)
  })

  it('asks once while it is asking, and logs each', async () => {
    let answer
    dialog.showMessageBox.mockReturnValue(new Promise(resolve => (answer = resolve)))
    const window = fakeWindow()
    offerReloadWhenGone(window)

    const first = window.die({ reason: 'crashed', exitCode: 5 })
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled())
    await window.die({ reason: 'crashed', exitCode: 6 })
    answer({ response: RELOAD })
    await first

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(await readFile(path.join(logs, 'windows.log'), 'utf8')).toContain('exit code 6')
  })

  it('asks again when the page dies again after a reload', async () => {
    const window = fakeWindow()
    offerReloadWhenGone(window)

    await window.die({ reason: 'crashed', exitCode: 5 })
    await window.die({ reason: 'crashed', exitCode: 5 })

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
    expect(window.webContents.reload).toHaveBeenCalledTimes(2)
  })

  it('leaves a window closed while it was asking', async () => {
    const window = fakeWindow()
    dialog.showMessageBox.mockImplementation(async () => {
      window.state.destroyed = true
      return { response: RELOAD }
    })
    offerReloadWhenGone(window)

    await window.die({ reason: 'crashed', exitCode: 5 })

    expect(window.webContents.reload).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
  })

  it('still asks when the log cannot be written', async () => {
    app.getPath.mockImplementation(() => {
      throw new Error('no logs here')
    })
    const window = fakeWindow()
    offerReloadWhenGone(window)

    await window.die({ reason: 'crashed', exitCode: 5 })

    expect(dialog.showMessageBox).toHaveBeenCalled()
    expect(said).toHaveBeenCalledWith(expect.stringContaining("log couldn't be written"))
  })

  it('says nothing of a page that went as it should', async () => {
    const closed = fakeWindow()
    offerReloadWhenGone(closed)
    await closed.die({ reason: 'clean-exit', exitCode: 0 })

    const gone = fakeWindow({ destroyed: true })
    offerReloadWhenGone(gone)
    await gone.die({ reason: 'crashed', exitCode: 5 })

    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  // Last: nothing takes a quit back.
  it('says nothing while the app is quitting', async () => {
    beforeQuit()
    const window = fakeWindow()
    offerReloadWhenGone(window)

    await window.die({ reason: 'killed', exitCode: 9 })

    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })
})
