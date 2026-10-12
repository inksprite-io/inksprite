import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useJobsStore } from '@/stores/jobsStore.js'

const rows = new Map()
vi.mock('@/stores/db', () => ({
  default: {
    jobs: {
      put: vi.fn(async row => {
        rows.set(row.id, { ...row })
      }),
      toArray: vi.fn(async () => [...rows.values()]),
      count: vi.fn(async () => rows.size),
      bulkDelete: vi.fn(async ids => {
        for (const id of ids) rows.delete(id)
      }),
      where: vi.fn(() => ({
        equals: vi.fn(storyId => ({
          toArray: vi.fn(async () => [...rows.values()].filter(row => row.storyId === storyId)),
        })),
      })),
    },
  },
}))

/**
 * @param {string} id
 * @param {string} storyId
 */
const keep = (id, storyId) =>
  rows.set(id, { id, storyId, status: 'done', steps: [], created: 1, updated: 1 })

const plan = {
  storyId: 's1',
  kind: 'convert',
  workflow: 'convert',
  title: 'One',
  steps: [{ id: 'a', label: 'a', status: 'pending' }],
}

describe('jobsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    rows.clear()
  })

  it('has no jobs until one is counted or started', async () => {
    const store = useJobsStore()
    await store.countJobs()
    expect(store.hasJobs).toBe(false)

    await store.createJob(plan)
    expect(store.hasJobs).toBe(true)
  })

  it('has the jobs kept from before once they are counted, without reading them', async () => {
    keep('job_old', 's1')
    const store = useJobsStore()
    expect(store.hasJobs).toBe(false)

    await store.countJobs()

    expect(store.hasJobs).toBe(true)
    expect(store.getJobs()).toEqual([])
  })

  it('goes by the jobs read in once they are, and has none when the last is cleared', async () => {
    keep('job_old', 's1')
    const store = useJobsStore()
    await store.countJobs()
    await store.loadJobs()
    expect(store.hasJobs).toBe(true)

    await store.deleteJob('job_old')

    expect(store.hasJobs).toBe(false)
  })

  it("counts again when a project's jobs are forgotten before they are read in", async () => {
    keep('job_mine', 's1')
    const store = useJobsStore()
    await store.countJobs()

    await store.deleteJobsForStory('s1')
    expect(store.hasJobs).toBe(false)

    keep('job_other', 's2')
    keep('job_mine', 's1')
    await store.countJobs()
    await store.deleteJobsForStory('s1')
    expect(store.hasJobs).toBe(true)
  })
})
