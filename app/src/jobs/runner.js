/* global AbortController */
/**
 * @module jobs/runner
 * @description Running a job: step after step, stoppable, resumable.
 *
 * A job is a plan of steps and a kind that knows how to run one and what to
 * do when all are done. The runner walks the steps from the first that is
 * not finished, writes each result as it lands, and stops when told: a
 * pause aborts the request in flight and leaves the step to be done again,
 * a cancel does the same and closes the job. Resuming is starting again;
 * the finished steps are skipped. Nothing here knows what a step does.
 *
 * One job runs at a time per browser tab. The requests it makes are its
 * own — see `ai/complete.js` — so a chat can go on beside it.
 */

import { complete } from '@/ai/complete.js'
import { useAIConfig } from '@/composables/useAIConfig.js'
import { useApplicationState } from '@/composables/useApplicationState.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { ProviderNotConfiguredError } from '@/utils/errors.js'
import { addChars, clearActivity, setActivity } from './live.js'

/** @typedef {import('@/types/models.js').Job} Job */
/** @typedef {import('@/types/models.js').JobStep} JobStep */

/**
 * What a kind of job supplies.
 *
 * @typedef {Object} JobKind
 * @property {(job: Job, step: JobStep, run: StepRun) => Promise<{output: string, usage?: any}>} runStep
 * @property {(job: Job) => Promise<string|void>} finish - Apply the result once every
 *   step is done; the id of the document it wrote, when it wrote one, for the
 *   panel to open
 */

/**
 * What a step is given to run with.
 *
 * @typedef {Object} StepRun
 * @property {(messages: Array<{role: string, content: string}>) => Promise<{content: string, finishReason: string|null, usage?: any}>} ask
 * @property {AbortSignal} signal
 * @property {(phase: import('./live.js').JobActivity['phase'], detail?: string) => void} note - Say
 *   what the step is doing now, for the panel's status line
 */

/** @type {Map<string, JobKind>} */
const kinds = new Map()

/** Jobs running in this tab, by id, with the way to stop each. */
const running = new Map()

/**
 * Teach the runner a kind of job.
 * @param {string} name
 * @param {JobKind} kind
 */
export function registerJobKind(name, kind) {
  kinds.set(name, kind)
}

/** @param {unknown} error */
const messageOf = error => (error instanceof Error ? error.message : String(error))

/** How often, and after how long, a request that failed in passing is asked again. */
export const RETRY = { times: 3, delay: 5000 }

/** A failure of the connection or the provider, not of the answer. */
const TRANSIENT =
  /terminated|fetch failed|failed to fetch|network|socket|ECONNRESET|ETIMEDOUT|timed? ?out|overloaded|rate limit|\b(429|5\d\d)\b/i

/**
 * Whether a request failed in passing — the connection, a busy provider —
 * and is worth asking again.
 * @param {unknown} error
 */
export const isTransient = error => TRANSIENT.test(messageOf(error))

/**
 * Wait, or stop waiting when the job is paused.
 * @param {number} ms
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })

/** Whether a job is running in this tab. @param {string} jobId */
export const isRunning = jobId => running.has(jobId)

/**
 * The way to ask the model a workflow names, or an error saying what is not set.
 *
 * The allowed providers come with the model they were chosen for: the
 * preset's with the preset's, the workflow's own with its own.
 *
 * @param {string} name - A workflow in the application state's `workflows`
 * @returns {{provider: import('@/types/models.js').AIProvider, model: string, allowedProviders?: string[], overrides?: any}}
 * @throws {ProviderNotConfiguredError|Error}
 */
export function resolveWorkflow(name) {
  const { workflows } = useApplicationState()
  const aiConfig = useAIConfig()
  /** @type {Partial<import('@/types/models.js').WorkflowSettings>} */
  const settings = workflows.value[name] || {}
  // A workflow never set runs on the active preset; one set runs on its own.
  const preset = settings.providerId ? null : aiConfig.activeAIPreset.value
  const providerId = settings.providerId || preset?.providerId
  const model = settings.providerId ? settings.model : preset?.model
  if (!providerId) {
    throw new ProviderNotConfiguredError(
      'Set up a provider, and pick one for this workflow in Settings.'
    )
  }
  const provider = aiConfig.getProvider(providerId)
  if (!provider) throw new ProviderNotConfiguredError('The provider this workflow uses is gone.')
  if (!model) throw new Error('Pick a model for this workflow in Settings.')
  const overrides = settings.providerId
    ? settings.reasoningEffort
      ? { reasoningEffort: settings.reasoningEffort }
      : undefined
    : preset?.generationOverrides
  const allowedProviders = settings.providerId
    ? settings.allowedProviders
    : preset?.allowedProviders
  return { provider, model, allowedProviders, overrides }
}

/**
 * Run a job from where it stands until it is done or stopped.
 *
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function startJob(jobId) {
  const store = useJobsStore()
  if (running.has(jobId)) return
  const job = store.getJob(jobId)
  if (!job) throw new Error(`No job ${jobId}`)
  const kind = kinds.get(job.kind)
  if (!kind) throw new Error(`No way to run a ${job.kind} job`)

  const controller = new AbortController()
  const state = { controller, stop: /** @type {'pause'|'cancel'|null} */ (null) }
  running.set(jobId, state)
  const started = Date.now()
  setActivity(jobId, 'asking')
  await store.updateJob(jobId, { status: 'running', error: undefined })

  /**
   * The job's state as it stops, with this run's time added to its own:
   * the panel shows the time a job has run in all, not per step.
   * @param {Partial<Job>} patch
   */
  const stopping = patch =>
    store.updateJob(jobId, {
      ...patch,
      elapsed: (store.getJob(jobId)?.elapsed || 0) + (Date.now() - started),
    })

  try {
    for (;;) {
      const current = store.getJob(jobId)
      if (!current || state.stop) break
      const step = current.steps.find(one => one.status !== 'done')
      if (!step) {
        setActivity(jobId, 'finishing')
        let resultId
        try {
          resultId = await kind.finish(current)
        } catch (error) {
          // Left as it was, the job would say it was running with nothing
          // running it. Every step is done; a retry only finishes again.
          await stopping({ status: 'failed', error: messageOf(error) })
          return
        }
        await stopping({ status: 'done', ...(resultId ? { resultId } : {}) })
        break
      }

      await store.updateStep(jobId, step.id, { status: 'running', error: undefined })
      setActivity(jobId, 'asking')
      try {
        const { provider, model, allowedProviders, overrides } = resolveWorkflow(current.workflow)
        const { output, usage } = await kind.runStep(current, step, {
          signal: controller.signal,
          note: (phase, detail) => setActivity(jobId, phase, detail),
          ask: async messages => {
            // A dropped connection or a busy provider is asked again after a
            // pause, a few times: a book is many requests, and one blip in
            // an hour of them should not stop the job.
            for (let attempt = 0; ; attempt++) {
              setActivity(
                jobId,
                'asking',
                attempt > 0 ? 'asked again after a dropped connection' : undefined
              )
              try {
                return await complete({
                  provider,
                  model,
                  allowedProviders,
                  messages,
                  overrides,
                  signal: controller.signal,
                  onChunk: piece => addChars(jobId, piece.length),
                })
              } catch (error) {
                if (state.stop || attempt >= RETRY.times || !isTransient(error)) throw error
                await pause(RETRY.delay * 3 ** attempt, controller.signal)
              }
            }
          },
        })
        await store.updateStep(jobId, step.id, {
          status: 'done',
          output,
          tokens: usage?.total_tokens,
        })
      } catch (error) {
        if (state.stop) {
          await store.updateStep(jobId, step.id, { status: 'pending' })
          break
        }
        const message = messageOf(error)
        await store.updateStep(jobId, step.id, { status: 'failed', error: message })
        await stopping({ status: 'failed', error: message })
        return
      }
    }
    if (state.stop === 'pause') await stopping({ status: 'paused' })
    if (state.stop === 'cancel') await stopping({ status: 'cancelled' })
  } finally {
    running.delete(jobId)
    clearActivity(jobId)
  }
}

/**
 * Stop a running job after the request in flight, keeping its place.
 * @param {string} jobId
 */
export function pauseJob(jobId) {
  const state = running.get(jobId)
  if (!state) return
  state.stop = 'pause'
  state.controller.abort()
}

/**
 * Stop a job for good. A job not running is closed where it stands.
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function cancelJob(jobId) {
  const state = running.get(jobId)
  if (state) {
    state.stop = 'cancel'
    state.controller.abort()
    return
  }
  await useJobsStore().updateJob(jobId, { status: 'cancelled' })
}

/**
 * Take up a paused or failed job again. A failed step is tried again.
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function resumeJob(jobId) {
  const store = useJobsStore()
  const job = store.getJob(jobId)
  if (!job) return
  const steps = job.steps.map(step =>
    step.status === 'failed' ? { ...step, status: /** @type {const} */ ('pending') } : step
  )
  await store.updateJob(jobId, { steps, error: undefined })
  await startJob(jobId)
}
