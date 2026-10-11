/* global structuredClone */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  RETRY,
  cancelJob,
  isRunning,
  isTransient,
  pauseJob,
  registerJobKind,
  resumeJob,
  startJob,
} from '@/jobs/runner.js'
import { useJobsStore } from '@/stores/jobsStore.js'

const rows = new Map()
vi.mock('@/stores/db', () => ({
  default: {
    jobs: {
      put: vi.fn(async row => {
        rows.set(row.id, structuredClone(row))
      }),
      delete: vi.fn(async id => {
        rows.delete(id)
      }),
      toArray: vi.fn(async () => [...rows.values()]),
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

const provider = { id: 'p1', name: 'Test', type: 'generic', endpoint: 'http://x' }
vi.mock('@/composables/useAIConfig.js', () => ({
  useAIConfig: () => ({
    getPreset: id => (id === 'preset_strong' ? { providerId: 'p1', model: 'strong' } : null),
    activeAIPreset: { value: { providerId: 'p1', model: 'active', allowedProviders: ['fast'] } },
    getProvider: id => (id === 'p1' ? provider : null),
  }),
}))
const workflows = { value: { convert: { presetId: null } } }
vi.mock('@/composables/useApplicationState.js', () => ({
  useApplicationState: () => ({ workflows }),
}))

const asked = []
let answer = async messages => ({ content: `did ${messages[0].content}`, finishReason: 'stop' })
vi.mock('@/ai/complete.js', () => ({
  complete: vi.fn(async ({ messages, model, allowedProviders, signal }) => {
    asked.push({ text: messages[0].content, model, allowedProviders })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => answer(messages).then(resolve, reject), 5)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      })
    })
  }),
}))

/** A kind whose steps ask the model to "do" their id and whose finish records the outputs. */
const finished = []
registerJobKind('test', {
  async runStep(job, step, { ask }) {
    const { content, usage } = await ask([{ role: 'user', content: step.id }])
    return { output: content, usage }
  },
  async finish(job) {
    finished.push(job.steps.map(step => step.output))
    return 'doc_result'
  },
})

/** A kind that does its steps and then cannot write the result. */
registerJobKind('broken', {
  async runStep(job, step, { ask }) {
    const { content } = await ask([{ role: 'user', content: step.id }])
    return { output: content }
  },
  async finish() {
    throw new Error('The document is gone.')
  },
})

const tick = () => new Promise(resolve => setTimeout(resolve, 20))

describe('the job runner', () => {
  /** @type {ReturnType<typeof useJobsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    rows.clear()
    asked.length = 0
    finished.length = 0
    workflows.value = { convert: { presetId: null } }
    answer = async messages => ({ content: `did ${messages[0].content}`, finishReason: 'stop' })
    store = useJobsStore()
  })

  const plan = (kind = 'test') =>
    store.createJob({
      storyId: 's1',
      kind,
      workflow: 'convert',
      title: 'Test job',
      steps: ['a', 'b', 'c'].map(id => ({ id, label: id, status: 'pending' })),
    })

  it('runs the steps in order, keeps each result, and finishes', async () => {
    const job = await plan()

    await startJob(job.id)

    const after = store.getJob(job.id)
    expect(after.status).toBe('done')
    expect(after.steps.map(step => step.output)).toEqual(['did a', 'did b', 'did c'])
    expect(finished).toEqual([['did a', 'did b', 'did c']])
    expect(after.resultId).toBe('doc_result')
    expect(rows.get(job.id).status).toBe('done')
    expect(isRunning(job.id)).toBe(false)
  })

  it('asks on the role’s preset, or the active one when the role names none', async () => {
    const job = await plan()
    await startJob(job.id)
    expect(asked[0].model).toBe('active')

    workflows.value = { convert: { providerId: 'p1', model: 'strong', reasoningEffort: 'high' } }
    const second = await plan()
    await startJob(second.id)
    expect(asked.at(-1).model).toBe('strong')
  })

  it('routes to the providers allowed for the model it asks', async () => {
    // Chosen for a model, so they come with it: the preset's with the
    // preset's, and a workflow on a model of its own has its own or none.
    const job = await plan()
    await startJob(job.id)
    expect(asked[0].allowedProviders).toEqual(['fast'])

    workflows.value = { convert: { providerId: 'p1', model: 'strong' } }
    const second = await plan()
    await startJob(second.id)
    expect(asked.at(-1).allowedProviders).toBeUndefined()

    workflows.value = { convert: { providerId: 'p1', model: 'strong', allowedProviders: ['big'] } }
    const third = await plan()
    await startJob(third.id)
    expect(asked.at(-1).allowedProviders).toEqual(['big'])
  })

  it('pauses after the step in flight, keeps what is done, and resumes from there', async () => {
    const job = await plan()
    // Step b waits at a gate, so the pause lands while it is in flight.
    let gate = null
    answer = async messages => {
      if (messages[0].content === 'b') await new Promise(resolve => (gate = resolve))
      return { content: `did ${messages[0].content}`, finishReason: 'stop' }
    }

    const run = startJob(job.id)
    while (!asked.some(one => one.text === 'b')) await tick()
    pauseJob(job.id)
    await run

    const paused = store.getJob(job.id)
    expect(paused.status).toBe('paused')
    expect(paused.steps.map(step => step.status)).toEqual(['done', 'pending', 'pending'])
    expect(paused.steps[0].output).toBe('did a')

    answer = async messages => ({ content: `did ${messages[0].content}`, finishReason: 'stop' })
    if (gate) gate()
    await resumeJob(job.id)

    expect(store.getJob(job.id).status).toBe('done')
    expect(store.getJob(job.id).steps.map(step => step.output)).toEqual(['did a', 'did b', 'did c'])
    // Step a was not asked again.
    expect(asked.filter(one => one.text === 'a')).toHaveLength(1)
  })

  it('cancels a running job, and a paused one', async () => {
    const job = await plan()
    const run = startJob(job.id)
    await tick()
    await cancelJob(job.id)
    await run
    expect(store.getJob(job.id).status).toBe('cancelled')

    const other = await plan()
    await cancelJob(other.id)
    expect(store.getJob(other.id).status).toBe('cancelled')
  })

  it('fails on a bad step, says why, and retries that step on resume', async () => {
    const job = await plan()
    let calls = 0
    answer = async messages => {
      calls++
      if (messages[0].content === 'b' && calls < 3) throw new Error('flaky')
      return { content: `did ${messages[0].content}`, finishReason: 'stop' }
    }

    await startJob(job.id)

    const failed = store.getJob(job.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('flaky')
    expect(failed.steps.find(step => step.id === 'b').status).toBe('failed')
    expect(failed.steps.find(step => step.id === 'a').status).toBe('done')

    await resumeJob(job.id)

    expect(store.getJob(job.id).status).toBe('done')
    expect(store.getJob(job.id).error).toBeUndefined()
  })

  it('leaves a job this tab is running alone when the jobs load', async () => {
    const job = await plan()
    let gate = null
    answer = async () => {
      await new Promise(resolve => (gate = resolve))
      return { content: 'did', finishReason: 'stop' }
    }
    const run = startJob(job.id)
    while (!asked.length) await tick()

    await store.loadJobs()

    expect(store.getJob(job.id).status).toBe('running')
    answer = async messages => ({ content: `did ${messages[0].content}`, finishReason: 'stop' })
    if (gate) gate()
    await run
    expect(store.getJob(job.id).status).toBe('done')
  })

  it('brings a job interrupted mid-run back as paused, whatever its project', async () => {
    rows.set('job_x', {
      id: 'job_x',
      storyId: 's2',
      kind: 'test',
      workflow: 'convert',
      title: 'Interrupted',
      status: 'running',
      steps: [
        { id: 'a', label: 'a', status: 'done', output: 'did a' },
        { id: 'b', label: 'b', status: 'running' },
      ],
      created: 1,
      updated: 1,
    })

    await store.loadJobs()

    const job = store.getJob('job_x')
    expect(job.status).toBe('paused')
    expect(job.steps[1].status).toBe('pending')
    expect(rows.get('job_x').status).toBe('paused')
  })

  it('keeps how long a job has run, over every run', async () => {
    const job = await plan()
    let gate = null
    answer = async messages => {
      if (messages[0].content === 'b') await new Promise(resolve => (gate = resolve))
      return { content: `did ${messages[0].content}`, finishReason: 'stop' }
    }
    const run = startJob(job.id)
    while (!asked.some(one => one.text === 'b')) await tick()
    pauseJob(job.id)
    await run
    const first = store.getJob(job.id).elapsed
    expect(first).toBeGreaterThan(0)
    expect(rows.get(job.id).elapsed).toBe(first)

    answer = async messages => ({ content: `did ${messages[0].content}`, finishReason: 'stop' })
    if (gate) gate()
    await resumeJob(job.id)

    expect(store.getJob(job.id).status).toBe('done')
    expect(store.getJob(job.id).elapsed).toBeGreaterThan(first)
  })

  it('fails a job whose result cannot be written, rather than leave it running', async () => {
    const job = await plan('broken')

    await startJob(job.id)

    const after = store.getJob(job.id)
    expect(after.status).toBe('failed')
    expect(after.error).toBe('The document is gone.')
    expect(isRunning(job.id)).toBe(false)
  })

  it("forgets a project's jobs, read in or not, and leaves the others", async () => {
    const mine = await plan()
    rows.set('job_unread', { id: 'job_unread', storyId: 's1', steps: [], created: 1, updated: 1 })
    rows.set('job_other', { id: 'job_other', storyId: 's2', steps: [], created: 1, updated: 1 })

    const gone = await store.deleteJobsForStory('s1')

    expect(gone.sort()).toEqual([mine.id, 'job_unread'].sort())
    expect(store.getJob(mine.id)).toBeNull()
    expect([...rows.keys()]).toEqual(['job_other'])
  })

  it('asks again when the connection drops, and fails at once on a real error', async () => {
    RETRY.delay = 1
    const job = await plan()
    let calls = 0
    answer = async messages => {
      calls++
      if (messages[0].content === 'b' && calls < 4) throw new Error('terminated')
      return { content: `did ${messages[0].content}`, finishReason: 'stop' }
    }
    await startJob(job.id)
    expect(store.getJob(job.id).status).toBe('done')
    expect(asked.filter(one => one.text === 'b')).toHaveLength(3)

    const other = await plan()
    answer = async () => {
      throw new Error('Invalid API key')
    }
    await startJob(other.id)
    expect(store.getJob(other.id).status).toBe('failed')
    expect(asked.filter(one => one.text === 'a')).toHaveLength(2)

    expect(isTransient(new Error('fetch failed'))).toBe(true)
    expect(isTransient(new Error('HTTP 503 Service Unavailable'))).toBe(true)
    expect(isTransient(new Error('The answer was cut off'))).toBe(false)
    RETRY.delay = 5000
  })
})
