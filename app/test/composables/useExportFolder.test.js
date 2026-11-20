import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'

const platform = vi.hoisted(() => ({
  can: true,
  linked: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
}))
vi.mock('@/platform/exportFolder.js', () => ({
  canLinkExportFolder: () => platform.can,
  linkedExportFolder: (/** @type {string} */ storyId) => platform.linked(storyId),
  linkExportFolder: (/** @type {string} */ storyId) => platform.link(storyId),
  unlinkExportFolder: (/** @type {string} */ storyId) => platform.unlink(storyId),
}))

import {
  chooseExportFolderFor,
  clearExportFolders,
  exportFolderOf,
  exportFolderOffered,
  folderName,
  removeExportFolderOf,
  shortFolder,
} from '@/composables/useExportFolder.js'

/** Let what was asked of the native side come back. */
const heard = async () => {
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  clearExportFolders()
  platform.can = true
  platform.linked.mockResolvedValue('/Users/me/repo/docs/design')
  vi.stubEnv('VITE_PREVIEW', 'mcp-server')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('useExportFolder', () => {
  it('is offered in the desktop app, while the feature is in preview', () => {
    expect(exportFolderOffered()).toBe(true)
    platform.can = false
    expect(exportFolderOffered()).toBe(false)
    platform.can = true
    vi.stubEnv('VITE_PREVIEW', '')
    expect(exportFolderOffered()).toBe(false)
  })

  it('asks for a project’s folder the first time it is wanted, and has it from then on', async () => {
    expect(exportFolderOf('story_a')).toBeNull()
    expect(exportFolderOf('story_a')).toBeNull()
    await heard()

    expect(exportFolderOf('story_a')).toBe('/Users/me/repo/docs/design')
    expect(platform.linked).toHaveBeenCalledTimes(1)
  })

  it('asks nothing where a folder can’t be linked', async () => {
    platform.can = false
    expect(exportFolderOf('story_a')).toBeNull()
    await heard()
    expect(platform.linked).not.toHaveBeenCalled()
  })

  it('has the folder the writer chose, and none when they cancelled', async () => {
    platform.linked.mockResolvedValue(null)
    exportFolderOf('story_a')
    await heard()

    platform.link.mockResolvedValue(null)
    expect(await chooseExportFolderFor('story_a')).toBeNull()
    expect(exportFolderOf('story_a')).toBeNull()

    platform.link.mockResolvedValue('/repo/docs')
    expect(await chooseExportFolderFor('story_a')).toBe('/repo/docs')
    expect(exportFolderOf('story_a')).toBe('/repo/docs')
    expect(exportFolderOf('story_b')).toBeNull()
  })

  it('has none once the link is removed', async () => {
    exportFolderOf('story_a')
    await heard()

    await removeExportFolderOf('story_a')

    expect(platform.unlink).toHaveBeenCalledWith('story_a')
    expect(exportFolderOf('story_a')).toBeNull()
  })

  it('goes on with no folder when the native side can’t say', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    platform.linked.mockRejectedValue(new Error('gone'))
    exportFolderOf('story_a')
    await heard()
    expect(exportFolderOf('story_a')).toBeNull()
    error.mockRestore()
  })
})

describe('folderName', () => {
  it('is the last of a folder’s path, on any system', () => {
    expect(folderName('/Users/me/repo/docs/design')).toBe('design')
    expect(folderName('/Users/me/repo/docs/')).toBe('docs')
    expect(folderName('C:\\Users\\me\\repo\\docs')).toBe('docs')
    expect(folderName('/')).toBe('/')
  })
})

describe('shortFolder', () => {
  it('shows the end of a long path, which tells it from another', () => {
    expect(shortFolder('/Users/me/code/repo/docs/design')).toBe('…/repo/docs/design')
    expect(shortFolder('C:\\Users\\me\\code\\repo\\docs')).toBe('…\\code\\repo\\docs')
  })

  it('shows a short one whole', () => {
    expect(shortFolder('/repo/docs')).toBe('/repo/docs')
    expect(shortFolder('/a/b/c')).toBe('/a/b/c')
  })
})
