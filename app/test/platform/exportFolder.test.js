/* global Blob, TextEncoder */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  canExportToFolder,
  canLinkExportFolder,
  chooseExportFolder,
  linkExportFolder,
  linkedExportFolder,
  lookInLinkedFolder,
  unlinkExportFolder,
  writeExportFolder,
  writeLinkedFolder,
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

describe('a project’s linked folder', () => {
  /** The native side's end, stood in for. */
  const linking = () => {
    const exportFolder = {
      choose: vi.fn(),
      write: vi.fn(),
      linked: vi.fn().mockResolvedValue('/repo/docs'),
      link: vi.fn().mockResolvedValue('/repo/docs'),
      unlink: vi.fn().mockResolvedValue(undefined),
      look: vi.fn().mockResolvedValue({ 'Thief/Plan.md': '# Plan' }),
      apply: vi.fn().mockResolvedValue({ folder: '/repo/docs', written: ['Plan.md'] }),
    }
    globalThis.__INKSPRITE_DESKTOP__ = { exportFolder }
    return exportFolder
  }

  it('is the desktop app’s alone, and one new enough to link one', async () => {
    expect(canLinkExportFolder()).toBe(false)
    expect(await linkedExportFolder('story_a')).toBeNull()
    expect(() => linkExportFolder('story_a')).toThrow('only in the desktop app')

    // A desktop app from before folders were linked: exports, but no link.
    globalThis.__INKSPRITE_DESKTOP__ = { exportFolder: { choose: vi.fn(), write: vi.fn() } }
    expect(canExportToFolder()).toBe(true)
    expect(canLinkExportFolder()).toBe(false)
    expect(await linkedExportFolder('story_a')).toBeNull()
    await expect(writeLinkedFolder('story_a', [])).rejects.toThrow('only in the desktop app')
  })

  it('is asked of the native side by the project’s id, never by a path', async () => {
    const exportFolder = linking()

    expect(canLinkExportFolder()).toBe(true)
    expect(await linkedExportFolder('story_a')).toBe('/repo/docs')
    expect(await linkExportFolder('story_a')).toBe('/repo/docs')
    await unlinkExportFolder('story_a')
    expect(await lookInLinkedFolder('story_a', ['Thief/Plan.md'])).toEqual({
      'Thief/Plan.md': '# Plan',
    })

    expect(exportFolder.linked).toHaveBeenCalledWith('story_a')
    expect(exportFolder.link).toHaveBeenCalledWith('story_a')
    expect(exportFolder.unlink).toHaveBeenCalledWith('story_a')
    expect(exportFolder.look).toHaveBeenCalledWith('story_a', ['Thief/Plan.md'])
  })

  it('sends what is read as bytes, and a text with whether it is the export’s own', async () => {
    const exportFolder = linking()

    const report = await writeLinkedFolder('story_a', [
      { path: 'Thief', folder: true },
      { path: 'Thief/Plan.md', text: '# Plan', own: true },
      { path: 'Thief/images/map.png', blob: new Blob(['map'], { type: 'image/png' }) },
      { path: 'Thief/Rules.pdf', file: 'Thief/Rules.pdf' },
    ])

    expect(report).toEqual({ folder: '/repo/docs', written: ['Plan.md'] })
    const [storyId, sent] = exportFolder.apply.mock.calls[0]
    expect(storyId).toBe('story_a')
    expect(sent[0]).toEqual({ path: 'Thief', folder: true })
    expect(sent[1]).toEqual({ path: 'Thief/Plan.md', text: '# Plan', own: true })
    expect(sent[2].path).toBe('Thief/images/map.png')
    expect(new TextDecoder().decode(sent[2].bytes)).toBe('map')
    expect(sent[3]).toEqual({ path: 'Thief/Rules.pdf', file: 'Thief/Rules.pdf' })
  })
})
