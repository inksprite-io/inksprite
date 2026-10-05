import { describe, it, expect } from 'vitest'
import { rolesToWorkflows } from '@/stores/migrations/jobWorkflows.js'
import { upgradeTables } from '@/utils/backup.js'

const job = fields => ({ id: 'job_1', storyId: 's1', kind: 'convert', status: 'paused', ...fields })

describe('rolesToWorkflows', () => {
  it('moves a job’s role to its workflow, so a paused one still finds its model', () => {
    const { jobs, moved } = rolesToWorkflows([job({ role: 'convert' })])

    expect(moved).toBe(1)
    expect(jobs[0]).toEqual(job({ workflow: 'convert' }))
  })

  it('leaves a job with no role as it is', () => {
    const untouched = job({ workflow: 'convert' })
    const { jobs, moved } = rolesToWorkflows([untouched])

    expect(moved).toBe(0)
    expect(jobs[0]).toBe(untouched)
  })

  it('keeps the workflow a job somehow has beside its role', () => {
    const { jobs } = rolesToWorkflows([job({ role: 'old', workflow: 'convert' })])

    expect(jobs[0]).toEqual(job({ workflow: 'convert' }))
  })

  it('carries a backup taken before it forward the same way', () => {
    const tables = upgradeTables({ jobs: [job({ role: 'convert' })] }, 20, 21)

    expect(tables.jobs).toEqual([job({ workflow: 'convert' })])
  })
})
