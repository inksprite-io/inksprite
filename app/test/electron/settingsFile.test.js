// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { readSettingsFile, settingsFilePath } from '../../electron/src/settingsFile.js'

/** The app's data folder, a folder of its own for each test. */
let userData

beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'inksprite-settings-'))
  app.getPath.mockImplementation(name => (name === 'userData' ? userData : '/nowhere'))
})

afterEach(async () => {
  await fs.rm(userData, { recursive: true, force: true })
})

describe('readSettingsFile', () => {
  it('reads the file a script left in the app’s data folder, and leaves it there', async () => {
    const file = path.join(userData, 'inksprite-settings.json')
    await fs.writeFile(file, '{"scope":"settings"}')

    expect(settingsFilePath()).toBe(file)
    expect(await readSettingsFile()).toBe('{"scope":"settings"}')
    expect(await fs.readFile(file, 'utf8')).toBe('{"scope":"settings"}')
  })

  it('is null when there is none', async () => {
    expect(await readSettingsFile()).toBeNull()
  })

  it('says why a file that is there can’t be read', async () => {
    await fs.mkdir(path.join(userData, 'inksprite-settings.json'))
    await expect(readSettingsFile()).rejects.toThrow()
  })
})
