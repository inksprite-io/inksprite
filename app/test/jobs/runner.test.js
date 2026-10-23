/* global structuredClone */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'
import {
  MOST_STEPS_AT_ONCE,
  RETRY,
  cancelJob,
  chatModel,
  isRunning,
  isTransient,
  pauseJob,
  readySteps,
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

const provider = { id: 'p1', name: 'Test', type: 'generic', endpoint: 'http://x' }
vi.mock('@/composables/useAIConfig.js', () => ({
  useAIConfig: () => ({
    getPreset: id => (id === 'preset_strong' ? { providerId: 'p1', model: 'strong' } : null),
    activeAIPreset: {
      value: {
        providerId: 'p1',
        model: 'active',
        allowedProviders: ['fast'],
        ignoredProviders: ['slow'],
      },
    },
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
  complete: vi.fn(async ({ messages, model, upstreams, overrides, signal }) => {
    asked.push({
      text: messages[0].content,
      model,
      allowedProviders: upstreams?.allowedProviders,
      ignoredProviders: upstreams?.ignoredProviders,
      overrides,
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => answer(messages).then(resolve, reject), 5)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      })
    })
  }),
}))

// How many requests the connection takes at once.
const room = vi.hoisted(() => ({ value: Infinity }))
vi.mock('@/ai/gate.js', () => ({ roomFor: async () => room.value }))

// Which window has which project: here, this one has every project it asks
// for, unless a test says otherwise.
const windows = vi.hoisted(() => ({
  taken: { held: true, stale: false, first: false },
  takeProject: vi.fn(),
  letGoOfProject: vi.fn(),
}))
vi.mock('@/platform/windows.js', async importOriginal => ({
  ...(await importOriginal()),
  takeProject: (...args) => windows.takeProject(...args),
  letGoOfProject: (...args) => windows.letGoOfProject(...args),
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
    windows.taken = { held: true, stale: false, first: false }
    windows.takeProject.mockReset().mockImplementation(async () => windows.taken)
    windows.letGoOfProject.mockReset()
    room.value = Infinity
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

  it('holds the job’s project while it runs, and lets go of it once it stops', async () => {
    const job = await plan()
    const running = startJob(job.id)
    // Mid-run: each step's answer takes a while.
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(windows.takeProject).toHaveBeenCalledWith('s1', `job:${job.id}`)
    expect(windows.letGoOfProject).not.toHaveBeenCalled()

    await running
    expect(windows.letGoOfProject).toHaveBeenCalledWith('s1', `job:${job.id}`)
  })

  it('runs nothing while its project is open in another window', async () => {
    const job = await plan()
    windows.taken = { held: false, stale: false, first: true }

    await expect(startJob(job.id)).rejects.toThrow('The project is open in another window.')
    expect(asked).toEqual([])
    expect(store.getJob(job.id).status).toBe('queued')
    expect(isRunning(job.id)).toBe(false)
  })

  it('runs nothing in a project another window has changed since, until it is opened here', async () => {
    const job = await plan()
    windows.taken = { held: true, stale: true, first: false }

    await expect(startJob(job.id)).rejects.toThrow('Open it, then resume the job.')
    expect(asked).toEqual([])
    expect(windows.letGoOfProject).toHaveBeenCalledWith('s1', `job:${job.id}`)
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

  it('routes to the providers allowed and ignored for the model it asks', async () => {
    // Chosen for a model, so they come with it: the preset's with the
    // preset's, and a workflow on a model of its own has its own or none.
    const job = await plan()
    await startJob(job.id)
    expect(asked[0].allowedProviders).toEqual(['fast'])
    expect(asked[0].ignoredProviders).toEqual(['slow'])

    workflows.value = { convert: { providerId: 'p1', model: 'strong' } }
    const second = await plan()
    await startJob(second.id)
    expect(asked.at(-1).allowedProviders).toBeUndefined()
    expect(asked.at(-1).ignoredProviders).toBeUndefined()

    workflows.value = {
      convert: {
        providerId: 'p1',
        model: 'strong',
        allowedProviders: ['big'],
        ignoredProviders: ['small'],
      },
    }
    const third = await plan()
    await startJob(third.id)
    expect(asked.at(-1).allowedProviders).toEqual(['big'])
    expect(asked.at(-1).ignoredProviders).toEqual(['small'])
  })

  it('asks on the model a job keeps, whatever the preset in use or the workflows say', async () => {
    workflows.value = { convert: { providerId: 'p1', model: 'strong' } }
    const job = await store.createJob({
      storyId: 's1',
      kind: 'test',
      runsOn: {
        providerId: 'p1',
        model: 'kept',
        allowedProviders: ['big'],
        overrides: { reasoningEffort: 'high' },
      },
      title: 'Test job',
      steps: [{ id: 'a', label: 'a', status: 'pending' }],
    })

    await startJob(job.id)

    expect(store.getJob(job.id).status).toBe('done')
    expect(asked).toEqual([
      {
        text: 'a',
        model: 'kept',
        allowedProviders: ['big'],
        ignoredProviders: undefined,
        overrides: { reasoningEffort: 'high' },
      },
    ])
  })

  it('fails a job whose model’s connection is gone, saying so', async () => {
    const job = await store.createJob({
      storyId: 's1',
      kind: 'test',
      runsOn: { providerId: 'p_gone', model: 'kept' },
      title: 'Test job',
      steps: [{ id: 'a', label: 'a', status: 'pending' }],
    })

    await startJob(job.id)

    expect(store.getJob(job.id)).toMatchObject({
      status: 'failed',
      error: 'The connection this job runs on is gone.',
    })
    expect(asked).toEqual([])
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
    expect(isTransient(new TypeError('Load failed'))).toBe(true)
    expect(isTransient(new Error('HTTP 503 Service Unavailable'))).toBe(true)
    expect(isTransient(new Error('The answer was cut off'))).toBe(false)
    RETRY.delay = 5000
  })

  describe('steps that say what they wait on', () => {
    /** How many steps were asking at once, at most, and the order they started in. */
    let most = 0
    let now = 0
    /** @type {string[]} */
    let started = []
    /** Steps held until let go, by id. @type {Map<string, () => void>} */
    let held = new Map()

    beforeEach(() => {
      most = 0
      now = 0
      started = []
      held = new Map()
      answer = async messages => {
        const id = messages[0].content
        started.push(id)
        most = Math.max(most, ++now)
        if (id.startsWith('slow')) await new Promise(resolve => held.set(id, resolve))
        else await new Promise(resolve => setTimeout(resolve, 10))
        now--
        if (id.startsWith('bad')) throw new Error(`${id} went wrong`)
        return { content: `did ${id}`, finishReason: 'stop' }
      }
    })

    /** @param {Array<[string, string[]|undefined]>} steps */
    const planned = steps =>
      store.createJob({
        storyId: 's1',
        kind: 'test',
        workflow: 'convert',
        title: 'Test job',
        steps: steps.map(([id, after]) => ({
          id,
          label: id,
          status: 'pending',
          ...(after ? { after } : {}),
        })),
      })

    it('runs those whose waits are over side by side, and the rest once theirs are', async () => {
      const job = await planned([
        ['a', []],
        ['b', []],
        ['c', ['a', 'b']],
        ['d', []],
      ])

      await startJob(job.id)

      expect(store.getJob(job.id).status).toBe('done')
      expect(most).toBe(3)
      expect(started.indexOf('c')).toBeGreaterThan(started.indexOf('a'))
      expect(started.indexOf('c')).toBeGreaterThan(started.indexOf('b'))
      expect(finished).toEqual([['did a', 'did b', 'did c', 'did d']])
    })

    it('runs as many at once as the connection takes, and no more than a job may', async () => {
      room.value = 2
      const two = await planned(['a', 'b', 'c', 'd', 'e'].map(id => [id, []]))
      await startJob(two.id)
      expect(most).toBe(2)

      most = 0
      room.value = Infinity
      const many = await planned(
        Array.from({ length: MOST_STEPS_AT_ONCE + 4 }, (_, at) => [`s${at}`, []])
      )
      await startJob(many.id)
      expect(most).toBe(MOST_STEPS_AT_ONCE)
      expect(store.getJob(many.id).status).toBe('done')
    })

    it('runs steps that name nothing one after another, as a conversion does', async () => {
      const job = await plan()
      await startJob(job.id)
      expect(most).toBe(1)
      expect(started).toEqual(['a', 'b', 'c'])
    })

    it('starts no more once one fails, and keeps what those asking made', async () => {
      room.value = 2
      const job = await planned([
        ['slow-a', []],
        ['bad-b', []],
        ['c', []],
      ])
      const run = startJob(job.id)
      while (!held.has('slow-a')) await tick()
      await tick()
      held.get('slow-a')?.()
      await run

      const failed = store.getJob(job.id)
      expect(failed.status).toBe('failed')
      expect(failed.error).toBe('bad-b went wrong')
      expect(failed.steps.map(step => step.status)).toEqual(['done', 'failed', 'pending'])
      expect(started).not.toContain('c')
    })

    it('pauses every step asking, and asks them again on resume', async () => {
      const job = await planned([
        ['slow-a', []],
        ['slow-b', []],
        ['c', ['slow-a', 'slow-b']],
      ])
      const run = startJob(job.id)
      while (held.size < 2) await tick()
      pauseJob(job.id)
      await run
      expect(store.getJob(job.id).steps.map(step => step.status)).toEqual([
        'pending',
        'pending',
        'pending',
      ])

      answer = async messages => ({ content: `did ${messages[0].content}`, finishReason: 'stop' })
      await resumeJob(job.id)
      expect(store.getJob(job.id).status).toBe('done')
    })

    it('fails a job whose steps wait on one it does not have', async () => {
      const job = await planned([
        ['a', []],
        ['b', ['missing']],
      ])
      await startJob(job.id)
      expect(store.getJob(job.id).status).toBe('failed')
      expect(store.getJob(job.id).steps[0].status).toBe('done')
    })
  })
})

describe('readySteps', () => {
  /** @param {string} id @param {string} status @param {string[]} [after] */
  const step = (id, status, after) => ({ id, label: id, status, ...(after ? { after } : {}) })

  it('takes the first pending step of a plain plan, once the one before is done', () => {
    expect(readySteps([step('a', 'pending'), step('b', 'pending')]).map(s => s.id)).toEqual(['a'])
    expect(readySteps([step('a', 'done'), step('b', 'pending')]).map(s => s.id)).toEqual(['b'])
    expect(readySteps([step('a', 'running'), step('b', 'pending')])).toEqual([])
  })

  it('takes every pending step whose waits are done', () => {
    const steps = [
      step('a', 'done', []),
      step('b', 'running', []),
      step('c', 'pending', ['a']),
      step('d', 'pending', ['a', 'b']),
      step('e', 'failed', []),
    ]
    expect(readySteps(steps).map(s => s.id)).toEqual(['c'])
  })
})

describe('chatModel', () => {
  it('keeps the model a chat on a preset runs on, as plain data', () => {
    const preset = reactive({
      id: 'preset_chat',
      providerId: 'p1',
      model: 'chat-model',
      allowedProviders: ['fast'],
      ignoredProviders: [],
      generationOverrides: { reasoningEffort: 'low', temperature: 0.4 },
    })

    const kept = chatModel(/** @type {any} */ (preset))

    expect(kept).toEqual({
      providerId: 'p1',
      model: 'chat-model',
      allowedProviders: ['fast'],
      overrides: { reasoningEffort: 'low', temperature: 0.4 },
    })
    expect(() => structuredClone(kept)).not.toThrow()
    // A copy: changing the preset after changes nothing planned on it.
    preset.generationOverrides.temperature = 1
    preset.allowedProviders.push('slow')
    expect(kept.overrides.temperature).toBe(0.4)
    expect(kept.allowedProviders).toEqual(['fast'])
  })

  it('takes the preset in use, which a new chat runs on, when it is given none', () => {
    expect(chatModel()).toEqual({
      providerId: 'p1',
      model: 'active',
      allowedProviders: ['fast'],
      ignoredProviders: ['slow'],
    })
  })

  it('says what a chat on it would fail with', () => {
    expect(() => chatModel(null)).toThrow('No AI provider is connected.')
    expect(() => chatModel(/** @type {any} */ ({ providerId: 'p_gone', model: 'm' }))).toThrow(
      'No AI provider is connected.'
    )
    expect(() => chatModel(/** @type {any} */ ({ providerId: 'p1', model: '' }))).toThrow(
      'Pick a model in Settings › AI.'
    )
  })
})
