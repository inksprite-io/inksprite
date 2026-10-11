/* global File, Response */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { zipSync, strToU8 } from 'fflate'
import { describeRepositoryImport, useRepositoryImport } from '@/composables/useRepositoryImport.js'
import { contentsOf } from '@/source/write.js'
import { listFiles } from '@/files/batch.js'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    stories: { toArray: vi.fn(async () => []) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const fetch = vi.fn()
vi.mock('@/platform/fetch.js', () => ({ fetch: (...args) => fetch(...args) }))
vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => true }))

const STORY = 'story_1'

/** Files listed as a folder chooser hands them over, under `server/`. */
const chosen = files =>
  listFiles(
    Object.entries(files).map(([path, text]) => {
      const file = new File([text], path.split('/').pop() || path)
      Object.defineProperty(file, 'webkitRelativePath', { value: `server/${path}` })
      return file
    })
  )

describe('useRepositoryImport', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    vi.clearAllMocks()
    api = useDocuments(STORY)
    await api.init()
  })

  const paths = folderId => [...contentsOf(api.childrenOf, folderId).files.keys()].sort()

  it('imports a folder as a repository named after it, leaving out what the rules say', async () => {
    const steps = []
    const result = await useRepositoryImport(STORY).importFolder(
      chosen({
        'src/index.ts': 'export {}\n',
        '.gitignore': 'tmp/\n',
        'tmp/scratch.ts': 'x',
        'node_modules/a/index.js': 'x',
      }),
      { onStep: step => steps.push(step) }
    )

    expect(result).toMatchObject({ name: 'server', files: 2 })
    expect(result.left).toMatchObject({ never: 1, ignored: 1 })
    expect(api.get(result.folderId)).toMatchObject({
      title: 'server',
      kind: 'repository',
      source: { from: 'folder', name: 'server' },
    })
    expect(paths(result.folderId)).toEqual(['.gitignore', 'src/index.ts'])
    expect(new Set(steps)).toEqual(new Set(['reading', 'writing']))
  })

  it('refreshes a folder from the folder chosen again', async () => {
    const repositories = useRepositoryImport(STORY)
    const { folderId } = await repositories.importFolder(chosen({ 'a.ts': 'one', 'b.ts': 'b' }))

    const result = await repositories.refresh(folderId, {
      listed: chosen({ 'a.ts': 'two', 'c.ts': 'c' }),
    })

    expect(result.refreshed).toEqual({ added: 1, updated: 1, removed: 1, unchanged: 0 })
    expect(paths(folderId)).toEqual(['a.ts', 'c.ts'])
  })

  it('asks for the folder again to refresh one that came from a folder', async () => {
    const repositories = useRepositoryImport(STORY)
    const { folderId } = await repositories.importFolder(chosen({ 'a.ts': 'one' }))

    await expect(repositories.refresh(folderId)).rejects.toThrow('Choose the folder')
  })

  it('imports a folder of a GitHub repository at a branch, and refreshes it at the same place', async () => {
    const archive = files =>
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([path, text]) => [
            `acme-widgets-abc1234/${path}`,
            strToU8(text),
          ])
        )
      )
    fetch
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(archive({ 'packages/core/a.ts': 'a', 'packages/web/b.ts': 'b' }))
      )
    const repositories = useRepositoryImport(STORY)

    const result = await repositories.importGitHub(
      'https://github.com/acme/widgets/tree/release/2.0/packages/core'
    )

    expect(api.get(result.folderId)).toMatchObject({
      title: 'core',
      source: {
        from: 'github',
        name: 'acme/widgets',
        ref: 'release/2.0',
        subpath: 'packages/core',
        commit: 'abc1234',
      },
    })
    expect(paths(result.folderId)).toEqual(['a.ts'])

    fetch.mockResolvedValueOnce(new Response(archive({ 'packages/core/a.ts': 'a2' })))
    const refreshed = await repositories.refresh(result.folderId, { token: 'tok' })

    expect(fetch.mock.calls.at(-1)?.[0]).toBe(
      'https://api.github.com/repos/acme/widgets/zipball/release/2.0'
    )
    expect(fetch.mock.calls.at(-1)?.[1].headers.Authorization).toBe('Bearer tok')
    expect(refreshed.refreshed).toMatchObject({ updated: 1 })
  })

  it('refuses an address that is not a GitHub repository', async () => {
    await expect(useRepositoryImport(STORY).importGitHub('not a url')).rejects.toThrow(
      '"not a url" is not a GitHub repository\'s address.'
    )
  })
})

describe('describeRepositoryImport', () => {
  const left = { never: 3, ignored: 2, binary: ['a.png'], large: [] }

  it('tallies an import and what was left out', () => {
    expect(
      describeRepositoryImport({ folderId: 'f', name: 'acme/widgets', files: 120, left })
    ).toEqual({
      detail: 'acme/widgets imported: 120 files. Left out: 5 files ignored, 1 file not text.',
      severity: 'success',
    })
  })

  it('tallies a refresh by what changed', () => {
    const refreshed = { added: 2, updated: 0, removed: 1, unchanged: 9 }
    expect(
      describeRepositoryImport({
        folderId: 'f',
        name: 'server',
        files: 11,
        left: { never: 0, ignored: 0, binary: [], large: [] },
        refreshed,
      })
    ).toEqual({ detail: 'server refreshed: 2 added, 1 removed.', severity: 'success' })
  })
})
