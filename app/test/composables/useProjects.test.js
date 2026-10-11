import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjects } from '@/composables/useProjects'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const { push, importProject, readProjectFile } = vi.hoisted(() => ({
  push: vi.fn(),
  importProject: vi.fn(),
  readProjectFile: vi.fn(),
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
})
