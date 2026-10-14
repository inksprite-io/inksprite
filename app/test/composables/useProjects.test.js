/* global File */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { strToU8, zipSync } from 'fflate'
import { useProjects } from '@/composables/useProjects'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { scrivx } from '../scrivener/helpers.js'

const { push, importProject, readProjectFile, writeProject } = vi.hoisted(() => ({
  push: vi.fn(),
  importProject: vi.fn(),
  readProjectFile: vi.fn(),
  writeProject: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/stores/db', () => ({
  default: {
    stories: { toArray: vi.fn(async () => []) },
    documents: { bulkGet: vi.fn(async () => []) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))
vi.mock('@/composables/useBackup', () => ({
  useBackup: () => ({ importProject, readProjectFile }),
}))
vi.mock('@/platform/persistence.js', () => ({ askToKeepData: vi.fn() }))
vi.mock('@/scrivener/project.js', async importOriginal => ({
  .../** @type {object} */ (await importOriginal()),
  writeProject,
}))

/** @param {Record<string, string>} entries */
const zipFile = entries =>
  new File(
    [
      zipSync(
        Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)]))
      ),
    ],
    'Backup.zip',
    { type: 'application/zip' }
  )

describe('useProjects', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('numbers a new project whose name another has', async () => {
    const projects = useProjects()
    const first = await projects.create('Lighthouse')
    const second = await projects.create('Lighthouse')

    expect(projects.nameOf(first.id)).toBe('Lighthouse')
    expect(projects.nameOf(second.id)).toBe('Lighthouse (2)')
  })

  it('numbers a project imported beside the one it came from, before writing it', async () => {
    const projects = useProjects()
    await projects.create('Lighthouse')
    const rows = {
      story: { id: 'story_file' },
      documents: [{ id: rootIdFor('story_file'), title: 'Lighthouse' }],
    }
    readProjectFile.mockResolvedValue(rows)
    // What the import writes: a story and its root, under ids of their own,
    // named as it was asked to be.
    importProject.mockImplementation(async (_rows, { title }) => {
      const copy = { id: 'story_copy', updated: 0 }
      useStoriesStore().stories.set(copy.id, copy)
      useDocumentsStore().ensureRoot(copy.id, title)
      return copy
    })

    const copy = await projects.importFile(/** @type {any} */ ({}))

    expect(importProject).toHaveBeenCalledWith(rows, { title: 'Lighthouse (2)' })
    expect(projects.nameOf(copy.id)).toBe('Lighthouse (2)')
  })

  it('makes a project of a zipped Scrivener project, named after it', async () => {
    const projects = useProjects()
    await projects.create('Harbour')
    const zip = zipFile({
      'Harbour.scriv/Harbour.scrivx': scrivx([{ id: 'D', type: 'DraftFolder', title: 'Draft' }]),
    })

    const story = await projects.importFile(zip)

    expect(projects.nameOf(story.id)).toBe('Harbour (2)')
    expect(writeProject).toHaveBeenCalledWith(
      story.id,
      expect.objectContaining({ name: 'Harbour' })
    )
    expect(readProjectFile).not.toHaveBeenCalled()
  })

  it('makes a project of a .scriv chosen as a file', async () => {
    const projects = useProjects()
    const zip = zipFile({
      'Harbour.scriv/Harbour.scrivx': scrivx([{ id: 'D', type: 'DraftFolder', title: 'Draft' }]),
    })

    const story = await projects.importFile(new File([zip], 'Harbour.scriv.zip'))

    expect(projects.nameOf(story.id)).toBe('Harbour')
    expect(writeProject).toHaveBeenCalledWith(
      story.id,
      expect.objectContaining({ name: 'Harbour' })
    )
  })

  it('asks for a zip when a .scriv comes as a folder it cannot read', async () => {
    const projects = useProjects()
    const folder = new File([], 'Harbour.scriv')
    Object.defineProperty(folder, 'arrayBuffer', {
      value: async () => Promise.reject(new Error('NotReadableError')),
    })

    await expect(projects.importFile(folder)).rejects.toThrow(
      'This project could not be read. Compress it in Finder, then import the zip.'
    )
    expect(projects.projects.value).toEqual([])
  })

  it('makes no project of a zip with no Scrivener project in it', async () => {
    const projects = useProjects()

    await expect(projects.importFile(zipFile({ 'notes.txt': 'tides' }))).rejects.toThrow(
      'There is no Scrivener project in this zip.'
    )
    expect(projects.projects.value).toEqual([])
  })
})
