// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  // A build with no keys, which checks no signature, but where a test gives
  // it one: what the app is built with is not what these are about.
  vi.doMock('../../electron/src/updateKeys.js', () => ({ UPDATE_KEYS: [], UPDATE_CHECK: 'warn' }))
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

  it('says the app is quitting for the update only once it is', async () => {
    const { downloadUpdate, installUpdate, installingUpdate } = await load()
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.1.0-dev.7' },
    })
    await downloadUpdate()

    expect(installingUpdate()).toBe(false)
    installUpdate()
    expect(installingUpdate()).toBe(true)
  })
})

describe('an update on Windows or Linux, in a build with keys', () => {
  const version = '0.1.0-dev.30'
  const name = 'inksprite-0.1.0-dev.30-linux-x86_64.AppImage'
  const keys = generateKeyPairSync('ed25519')
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' })
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })

  let folder, file, net

  /** What the app's log was told. */
  const logLine = vi.fn(async () => {})

  /**
   * updates.js as a build with a key has it, having found and downloaded the
   * update: refusing one that isn't ours, or only warning of it.
   */
  const loadWithKey = async (check = 'refuse') => {
    vi.doMock('../../electron/src/updateKeys.js', () => ({
      UPDATE_KEYS: [publicKey],
      UPDATE_CHECK: check,
    }))
    vi.doMock('../../electron/src/log.js', () => ({ logLine }))
    const updates = await load()
    ;({ net } = await import('electron'))
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version },
    })
    autoUpdater.downloadUpdate.mockResolvedValue([file])
    return updates
  }

  /** The release answering for the update's signature with this. */
  const releaseSays = (written, status = 200) =>
    net.fetch.mockResolvedValue({
      ok: status === 200,
      status,
      text: async () => written,
    })

  /** A signature as the release workflow makes one, for a file that says this. */
  const signed = async (of = {}) => {
    const { hashOf, signUpdate } = await import('../../electron/src/updateSignature.js')
    const sha512 = await hashOf(file)
    return JSON.stringify(signUpdate({ version, file: name, sha512, ...of }, privateKey))
  }

  beforeEach(async () => {
    logLine.mockClear()
    folder = await mkdtemp(join(tmpdir(), 'inksprite-update-'))
    file = join(folder, name)
    await writeFile(file, 'the update')
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(folder, { recursive: true, force: true })
  })

  it('is offered once its signature, read from its own release, is one of ours', async () => {
    const { downloadUpdate, installUpdate } = await loadWithKey()
    releaseSays(await signed())

    expect(await downloadUpdate()).toBe(version)
    expect(net.fetch).toHaveBeenCalledWith(
      `https://github.com/inksprite-io/inksprite/releases/download/v${version}/${name}.sig`
    )
    installUpdate()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalled()
    expect(logLine).toHaveBeenCalledWith(`update ${version}: signed as ours`)
  })

  it('is never offered, or installed, with no signature in its release', async () => {
    const { downloadUpdate, installUpdate } = await loadWithKey()
    releaseSays('Not Found', 404)

    await expect(downloadUpdate()).rejects.toThrow(
      'The update is not signed as ours: it has no signature (404).'
    )
    expect(() => installUpdate()).toThrow('No update has been downloaded.')
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(logLine).toHaveBeenCalledWith(
      `update ${version}: not signed as ours: it has no signature (404); refused`
    )
  })

  it('is refused when its signature can’t be fetched at all', async () => {
    const { downloadUpdate } = await loadWithKey()
    net.fetch.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))

    await expect(downloadUpdate()).rejects.toThrow(
      'it could not be checked (net::ERR_INTERNET_DISCONNECTED)'
    )
  })

  describe('while the check only warns', () => {
    it('is offered though it isn’t signed as ours, and the log says what was wrong', async () => {
      const { downloadUpdate, installUpdate } = await loadWithKey('warn')
      releaseSays('Not Found', 404)

      expect(await downloadUpdate()).toBe(version)
      expect(logLine).toHaveBeenCalledWith(
        `update ${version}: not signed as ours: it has no signature (404); offered all the same, while the check only warns`
      )
      installUpdate()
      expect(autoUpdater.quitAndInstall).toHaveBeenCalled()
    })

    it('is offered whatever goes wrong in the checking', async () => {
      const { downloadUpdate } = await loadWithKey('warn')
      net.fetch.mockRejectedValue(new Error('net::ERR_FAILED'))
      expect(await downloadUpdate()).toBe(version)
      expect(logLine.mock.calls.at(-1)[0]).toContain('it could not be checked (net::ERR_FAILED)')
    })

    it('says in the log when it is signed as ours', async () => {
      const { downloadUpdate } = await loadWithKey('warn')
      releaseSays(await signed())

      expect(await downloadUpdate()).toBe(version)
      expect(logLine).toHaveBeenCalledWith(`update ${version}: signed as ours`)
    })
  })

  it('is refused when the file downloaded is not the one that was signed', async () => {
    const { downloadUpdate, installUpdate } = await loadWithKey()
    releaseSays(await signed())
    await writeFile(file, 'something else')

    await expect(downloadUpdate()).rejects.toThrow('it is for another file')
    expect(() => installUpdate()).toThrow('No update has been downloaded.')
  })

  it('is refused when it was signed as an older version', async () => {
    const { downloadUpdate } = await loadWithKey()
    releaseSays(await signed({ version: '0.1.0-dev.20' }))

    await expect(downloadUpdate()).rejects.toThrow('it is for 0.1.0-dev.20, not 0.1.0-dev.30')
  })

  it('is refused when the updater says it downloaded nothing', async () => {
    const { downloadUpdate } = await loadWithKey()
    autoUpdater.downloadUpdate.mockResolvedValue(undefined)

    await expect(downloadUpdate()).rejects.toThrow('the updater named no file')
  })

  it('is looked for again after a refusal, and offered once it is signed', async () => {
    const { downloadUpdate } = await loadWithKey()
    releaseSays('Not Found', 404)
    await expect(downloadUpdate()).rejects.toThrow()

    releaseSays(await signed())
    expect(await downloadUpdate()).toBe(version)
  })

  it('is left to the system on a Mac, which checks who signed the app', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    const { downloadUpdate } = await loadWithKey()

    expect(await downloadUpdate()).toBe(version)
    expect(net.fetch).not.toHaveBeenCalled()
  })
})

describe('an update in a build with no keys', () => {
  it('is offered as before, with no signature looked for', async () => {
    const { downloadUpdate } = await load()
    const { net } = await import('electron')
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.1.0-dev.30' },
    })
    autoUpdater.downloadUpdate.mockResolvedValue(['/nowhere/update.AppImage'])

    expect(await downloadUpdate()).toBe('0.1.0-dev.30')
    expect(net.fetch).not.toHaveBeenCalled()
  })
})
