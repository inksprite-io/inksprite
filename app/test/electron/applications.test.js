// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Electron's stand-ins, the ones applications.js has. */
let app, dialog
/** The app's data folder, for each test its own. */
let data
const platform = process.platform

/** applications.js afresh, on a Mac, as a packaged app opened from Downloads. */
const load = async () => {
  ;({ app, dialog } = await import('electron'))
  app.isPackaged = true
  app.getPath = vi.fn(() => data)
  app.isInApplicationsFolder = vi.fn(() => false)
  app.moveToApplicationsFolder = vi.fn(() => true)
  dialog.showMessageBox.mockReset()
  return import('../../electron/src/applications.js')
}

/** The dialog answering `response`, Don't ask again ticked or not. */
const answer = (response, checkboxChecked = false) =>
  dialog.showMessageBox.mockResolvedValueOnce({ response, checkboxChecked })

beforeEach(async () => {
  vi.resetModules()
  vi.doMock('../../electron/src/log.js', () => ({ logLine: vi.fn() }))
  data = await mkdtemp(join(tmpdir(), 'applications-'))
  Object.defineProperty(process, 'platform', { value: 'darwin' })
})

afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: platform })
  await rm(data, { recursive: true, force: true })
})

describe('offerMoveToApplications', () => {
  it('asks nothing off a Mac, from Applications, or run from the checkout', async () => {
    const { offerMoveToApplications } = await load()
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect(await offerMoveToApplications()).toBe(false)
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    app.isInApplicationsFolder.mockReturnValue(true)
    expect(await offerMoveToApplications()).toBe(false)
    app.isInApplicationsFolder.mockReturnValue(false)
    app.isPackaged = false
    expect(await offerMoveToApplications()).toBe(false)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('moves the app when asked to, over any copy already there', async () => {
    const { offerMoveToApplications } = await load()
    answer(0)
    expect(await offerMoveToApplications()).toBe(true)
    const [{ conflictHandler }] = app.moveToApplicationsFolder.mock.calls[0]
    expect(conflictHandler('exists')).toBe(true)
    expect(dialog.showMessageBox.mock.calls[0][0]).toMatchObject({
      message: 'Move inksprite to the Applications folder?',
      buttons: ['Move to Applications', 'Not now'],
      checkboxLabel: "Don't ask again",
    })
  })

  it('asks again next time after Not now', async () => {
    const { offerMoveToApplications } = await load()
    answer(1)
    expect(await offerMoveToApplications()).toBe(false)
    answer(1)
    await offerMoveToApplications()
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
    expect(app.moveToApplicationsFolder).not.toHaveBeenCalled()
  })

  it("never asks again once Don't ask again is ticked", async () => {
    const { offerMoveToApplications } = await load()
    answer(1, true)
    await offerMoveToApplications()
    expect(await stat(join(data, 'never-ask-to-move'))).toBeTruthy()
    expect(await offerMoveToApplications()).toBe(false)
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('says so, and carries on, where the move fails', async () => {
    const { offerMoveToApplications } = await load()
    app.moveToApplicationsFolder.mockImplementation(() => {
      throw new Error('Operation not permitted')
    })
    answer(0)
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(await offerMoveToApplications()).toBe(false)
    expect(dialog.showMessageBox.mock.calls[1][0]).toMatchObject({
      type: 'error',
      message: "inksprite couldn't be moved to the Applications folder.",
    })
  })
})
