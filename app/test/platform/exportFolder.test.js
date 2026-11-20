/* global Blob, TextEncoder */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  canExportToFolder,
  chooseExportFolder,
  writeExportFolder,
} from '@/platform/exportFolder.js'

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('exports to a folder', () => {
  it('are the desktop app’s alone, and one new enough to make them', async () => {
    expect(canExportToFolder()).toBe(false)
    expect(() => chooseExportFolder('Guide')).toThrow('only in the desktop app')
    globalThis.__INKSPRITE_DESKTOP__ = {}
    expect(canExportToFolder()).toBe(false)
    await expect(writeExportFolder('/docs/Guide', [])).rejects.toThrow('only in the desktop app')
  })

  it('ask where, and send what is read as bytes and the rest as it is', async () => {
    const exportFolder = {
      choose: vi.fn().mockResolvedValue('/docs/Guide'),
      write: vi.fn().mockResolvedValue(undefined),
    }
    globalThis.__INKSPRITE_DESKTOP__ = { exportFolder }
    expect(canExportToFolder()).toBe(true)

    expect(await chooseExportFolder('Guide')).toBe('/docs/Guide')
    expect(exportFolder.choose).toHaveBeenCalledWith('Guide')

    await writeExportFolder('/docs/Guide', [
      { path: 'Guide', folder: true },
      { path: 'Guide/Intro.md', text: 'Hello.' },
      { path: 'Guide/images/map.png', blob: new Blob(['map'], { type: 'image/png' }) },
      { path: 'Guide/Rules.pdf', file: 'My Project/Rules.pdf' },
    ])
    const [target, sent] = exportFolder.write.mock.calls[0]
    expect(target).toBe('/docs/Guide')
    expect(sent).toEqual([
      { path: 'Guide', folder: true },
      { path: 'Guide/Intro.md', text: 'Hello.' },
      { path: 'Guide/images/map.png', bytes: new TextEncoder().encode('map') },
      { path: 'Guide/Rules.pdf', file: 'My Project/Rules.pdf' },
    ])
  })
})
