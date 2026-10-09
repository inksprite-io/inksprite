// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Electron's stand-ins, the ones updates.js has. */
let app, autoUpdater

/** updates.js afresh, since it keeps what it downloaded, as a packaged app. */
const load = async () => {
  ;({ app, autoUpdater } = await import('electron'))
  app.isPackaged = true
  return import('../../electron/src/updates.js')
}

beforeEach(() => {
  vi.resetModules()
})

describe('downloadUpdate', () => {
  it('never looks in an app run from its folder', async () => {
    const { downloadUpdate } = await load()
    app.isPackaged = false
    expect(await downloadUpdate()).toBeNull()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('downloads a newer version and hands back its version, once', async () => {
    const { downloadUpdate } = await load()
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.1.0-dev.7' },
    })

    expect(await downloadUpdate()).toBe('0.1.0-dev.7')
    expect(await downloadUpdate()).toBe('0.1.0-dev.7')
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('looks once for two asks at the same time', async () => {
    const { downloadUpdate } = await load()
    autoUpdater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false })

    expect(await Promise.all([downloadUpdate(), downloadUpdate()])).toEqual([null, null])
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('downloads nothing when the app is up to date, and looks again next time', async () => {
    const { downloadUpdate } = await load()
    autoUpdater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false })

    expect(await downloadUpdate()).toBeNull()
    expect(await downloadUpdate()).toBeNull()
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})

describe('installUpdate', () => {
  it('installs nothing before a download', async () => {
    const { installUpdate } = await load()
    expect(() => installUpdate()).toThrow('No update has been downloaded.')
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('installs the download silently and starts the app again', async () => {
    const { downloadUpdate, installUpdate } = await load()
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.1.0-dev.7' },
    })
    await downloadUpdate()

    installUpdate()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})
