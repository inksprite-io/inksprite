import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadUpdate, installUpdate } from '@/platform/updates.js'

/** The native side, as the page sees it. */
const desktop = () => {
  const bridge = { downloadUpdate: vi.fn(), installUpdate: vi.fn() }
  globalThis.__INKSPRITE_DESKTOP__ = bridge
  return bridge
}

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('downloadUpdate', () => {
  it('finds none in a browser', async () => {
    expect(await downloadUpdate()).toBeNull()
  })

  it('hands back the version the desktop app downloaded', async () => {
    const bridge = desktop()
    bridge.downloadUpdate.mockResolvedValue('0.1.0-dev.5')

    expect(await downloadUpdate()).toBe('0.1.0-dev.5')
  })

  it('is null when the desktop app is up to date', async () => {
    desktop().downloadUpdate.mockResolvedValue(null)
    expect(await downloadUpdate()).toBeNull()
  })

  it('fails as the native side did', async () => {
    desktop().downloadUpdate.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))
    await expect(downloadUpdate()).rejects.toThrow('net::ERR_INTERNET_DISCONNECTED')
  })
})

describe('installUpdate', () => {
  it('asks the desktop app to install and restart', async () => {
    const bridge = desktop()
    bridge.installUpdate.mockResolvedValue(undefined)

    await installUpdate()
    expect(bridge.installUpdate).toHaveBeenCalled()
  })

  it('fails as the native side did', async () => {
    desktop().installUpdate.mockRejectedValue(new Error('No update has been downloaded.'))
    await expect(installUpdate()).rejects.toThrow('No update has been downloaded.')
  })
})
