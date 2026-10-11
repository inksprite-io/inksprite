import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useJobs } from '@/composables/useJobs.js'

vi.mock('@/stores/db', () => ({ default: { jobs: { put: vi.fn(async () => undefined) } } }))

const present = new Set()
vi.mock('@/stores/documentsStore.js', () => ({
  useDocumentsStore: () => ({
    getDocument: id => (present.has(id) ? { id } : undefined),
    getRoot: () => null,
    loadRoots: vi.fn(),
  }),
}))

const api = { init: vi.fn(async () => undefined), open: vi.fn() }
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => api }))

const job = extra => ({
  id: 'job_1',
  storyId: 's2',
  kind: 'convert',
  workflow: 'convert',
  title: 'Convert',
  status: 'done',
  steps: [],
  created: 1,
  updated: 1,
  ...extra,
})

describe('opening what a job wrote', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    present.clear()
    vi.clearAllMocks()
  })

  it('reads its project in and opens the document there', async () => {
    present.add('doc_copy')
    expect(await useJobs().openResult(job({ resultId: 'doc_copy' }))).toBe(true)
    expect(api.init).toHaveBeenCalled()
    expect(api.open).toHaveBeenCalledWith('doc_copy')
  })

  it('opens nothing once the document has gone, or when the job wrote none', async () => {
    expect(await useJobs().openResult(job({ resultId: 'doc_gone' }))).toBe(false)
    expect(await useJobs().openResult(job())).toBe(false)
    expect(api.open).not.toHaveBeenCalled()
  })
})
