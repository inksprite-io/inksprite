import { describe, it, expect, vi, afterEach } from 'vitest'
import { settingsFileText } from '@/platform/settingsFile.js'

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('settingsFileText', () => {
  it('finds none in a browser, which has no folder to leave one in', async () => {
    expect(await settingsFileText()).toBeNull()
  })

  it('reads the one a script left for the desktop app', async () => {
    globalThis.__INKSPRITE_DESKTOP__ = { settingsFile: vi.fn().mockResolvedValue('{}') }
    expect(await settingsFileText()).toBe('{}')
  })
})
