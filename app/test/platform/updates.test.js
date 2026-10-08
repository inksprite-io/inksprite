import { describe, it, expect, vi, afterEach } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { downloadUpdate, installUpdate } from '@/platform/updates.js'

afterEach(() => {
  delete globalThis.__TAURI_INTERNALS__
  invoke.mockReset()
})

describe('downloadUpdate', () => {
  it('finds none in a browser, without asking anything', async () => {
    expect(await downloadUpdate()).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('hands back the version the desktop app downloaded', async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValue('0.1.0-dev.5')

    expect(await downloadUpdate()).toBe('0.1.0-dev.5')
    expect(invoke).toHaveBeenCalledWith('download_update')
  })

  it('is null when the desktop app is up to date', async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValue(null)

    expect(await downloadUpdate()).toBeNull()
  })

  it("turns the native side's message into an error", async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    invoke.mockRejectedValue('error sending request')

    await expect(downloadUpdate()).rejects.toThrow(new Error('error sending request'))
  })
})

describe('installUpdate', () => {
  it('asks the desktop app to install and restart', async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    invoke.mockResolvedValue(undefined)

    await installUpdate()
    expect(invoke).toHaveBeenCalledWith('install_update')
  })

  it("turns the native side's message into an error", async () => {
    globalThis.__TAURI_INTERNALS__ = {}
    invoke.mockRejectedValue('No update has been downloaded.')

    await expect(installUpdate()).rejects.toThrow(new Error('No update has been downloaded.'))
  })
})
