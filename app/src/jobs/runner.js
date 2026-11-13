/* global AbortController */
/**
 * @module jobs/runner
 * @description Running a job: step after step, stoppable, resumable.
 *
 * A job is a plan of steps and a kind that knows how to run one and what to
 * do when all are done. The runner starts each step once the steps it waits
 * on are done, the one before it unless it says otherwise, as many at once
 * as the connection of its model takes (`ai/gate.js`); it writes each result
 * as it lands, and stops when told: a pause aborts the requests in flight
 * and leaves their steps to be done again, a cancel does the same and closes
 * the job. A step that fails starts no more, and lets those asking finish.
 * Resuming is starting again; the finished steps are skipped. Nothing here
 * knows what a step does.
 *
 * A job runs on the model it keeps (`runsOn`), the one the chat that asked
 * for it runs on, or else on its workflow's: a conversion's, chosen in the
 * dialog that asks for one, and until then what new chats start on.
 *
 * One job runs at a time per browser tab. The requests it makes are its
 * own — see `ai/complete.js` — so a chat can go on beside it. A job writes
 * into its project as it goes, so while it runs the project is its window's
 * (`platform/windows.js`): no other window opens it until the job stops.
 */

import { complete } from '@/ai/complete.js'
import { roomFor } from '@/ai/gate.js'
import { useAIConfig } from '@/composables/useAIConfig.js'
import { useApplicationState } from '@/composables/useApplicationState.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useStoriesStore } from '@/stores/storiesStore.js'
import { ProviderNotConfiguredError } from '@/utils/errors.js'
import { presetProblem } from '@/ai/providers.js'
import { letGoOfProject, takeProject } from '@/platform/windows.js'
import { addChars, clearActivity, setActivity } from './live.js'

/** @typedef {import('@/types/models.js').Job} Job */
/** @typedef {import('@/types/models.js').JobModel} JobModel */
/** @typedef {import('@/types/models.js').JobStep} JobStep */

/**
 * The way to ask a model: its connection, the model, the providers allowed
 * and ignored for it, and the settings its requests are sent with.
 *
 * @typedef {Object} ResolvedModel
 * @property {import('@/types/models.js').AIProvider} provider
 * @property {string} model
 * @property {import('@/ai/routing.js').ModelUpstreams} [upstreams]
 * @property {any} [overrides] - On top of AI_DEFAULTS, as a preset's `generationOverrides`
 */

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

/**
 * A failure of the connection or the provider, not of the answer. Safari
 * says "Load failed" where Chrome says "Failed to fetch".
 */
const TRANSIENT =
  /terminated|fetch failed|failed to fetch|load failed|network|socket|ECONNRESET|ETIMEDOUT|timed? ?out|overloaded|rate limit|\b(429|5\d\d)\b/i

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

/**
 * However many requests its connection takes, a job has at most this many
 * steps asking at once: a pause throws away what is in flight.
 */
export const MOST_STEPS_AT_ONCE = 8

/**
 * The steps that can start: waiting, and with everything they wait on done.
 * A step that names nothing waits on the one before it.
 *
 * @param {JobStep[]} steps
 * @returns {JobStep[]}
 */
export function readySteps(steps) {
  const done = new Set(steps.filter(step => step.status === 'done').map(step => step.id))
  return steps.filter(
    (step, at) =>
      step.status === 'pending' &&
      (step.after ?? (at > 0 ? [steps[at - 1].id] : [])).every(id => done.has(id))
  )
}

/**
 * How many steps of a job can ask at once. One when its model can't be
 * resolved: the step that starts then says why.
 *
 * @param {Job} job
 * @returns {Promise<number>}
 */
async function roomOf(job) {
  try {
    return Math.min(await roomFor(resolveJob(job).provider), MOST_STEPS_AT_ONCE)
  } catch {
    return 1
  }
}

/** Whether a job is running in this tab. @param {string} jobId */
export const isRunning = jobId => running.has(jobId)

/**
 * The way to ask the model a workflow names, or an error saying what is not set.
 *
 * Its own model where it has one, else what new chats start on, on that
 * model's settings (`runOn` in useAIConfig), with the workflow's own effort.
 *
 * @param {string} name - A workflow in the application state's `workflows`
 * @returns {ResolvedModel}
 * @throws {ProviderNotConfiguredError|Error}
 */
export function resolveWorkflow(name) {
  const { workflows } = useApplicationState()
  const aiConfig = useAIConfig()
  /** @type {Partial<import('@/types/models.js').WorkflowSettings>} */
  const settings = workflows.value[name] || {}
  // A workflow never set runs on what new chats start on; one set runs on
  // its own.
  const run =
    settings.providerId && settings.model
      ? aiConfig.runOn(settings.providerId, settings.model)
      : aiConfig.startingPreset.value
  const providerId = run?.providerId
  const model = run?.model
  if (!providerId) {
    throw new ProviderNotConfiguredError('No AI provider is connected.')
  }
  const provider = aiConfig.getProvider(providerId)
  if (!provider) throw new ProviderNotConfiguredError('The provider this workflow uses is gone.')
  if (!model) throw new Error('Pick a model to convert with.')
  const effort = settings.providerId ? settings.reasoningEffort : null
  const overrides = effort
    ? { ...(run?.generationOverrides || {}), reasoningEffort: /** @type {any} */ (effort) }
    : run?.generationOverrides
  return { provider, model, upstreams: run, overrides }
}

/**
 * The model a chat runs on, as a job keeps it: the connection and the model,
 * the providers preferred and ignored for it, and its settings, copied, so
 * the job goes on as it was planned whatever is done to them after.
 *
 * @param {import('@/types/models.js').AIPreset|null} preset - The chat's
 * @returns {JobModel}
 * @throws {ProviderNotConfiguredError|Error} What a chat on it would fail with
 */
export function chatModel(preset) {
  const aiConfig = useAIConfig()
  const problem = presetProblem(preset, id => aiConfig.getProvider(id))
  if (problem || !preset) throw problem
  const { providerId, model, allowedProviders, fallbacks, ignoredProviders, generationOverrides } =
    preset
  return {
    providerId,
    model,
    ...(allowedProviders?.length ? { allowedProviders: [...allowedProviders] } : {}),
    ...(typeof fallbacks === 'boolean' ? { fallbacks } : {}),
    ...(ignoredProviders?.length ? { ignoredProviders: [...ignoredProviders] } : {}),
    // Plain, for the job's row: a preset read from its store is a proxy.
    ...(generationOverrides && Object.keys(generationOverrides).length > 0
      ? { overrides: JSON.parse(JSON.stringify(generationOverrides)) }
      : {}),
  }
}

/**
 * The way to ask a model a job keeps, or an error saying it can't be.
 *
 * @param {JobModel} runsOn
 * @returns {ResolvedModel}
 * @throws {ProviderNotConfiguredError} When its connection is gone
 */
export function resolveModel(runsOn) {
  const provider = useAIConfig().getProvider(runsOn.providerId)
  if (!provider) throw new ProviderNotConfiguredError('The connection this job runs on is gone.')
  return { provider, model: runsOn.model, upstreams: runsOn, overrides: runsOn.overrides }
}

/**
 * The way to ask the model a job runs on: the one it keeps, or its
 * workflow's. An exploration from before explore kept one names the
 * workflow it ran on, `explore`, which runs on what new chats start on
 * unless the writer gave it a model of its own then.
 *
 * @param {Job} job
 * @returns {ResolvedModel}
 * @throws {ProviderNotConfiguredError|Error}
 */
function resolveJob(job) {
  return job.runsOn ? resolveModel(job.runsOn) : resolveWorkflow(job.workflow || '')
}

/**
 * Run a job from where it stands until it is done or stopped.
 *
 * @param {string} jobId
 * @returns {Promise<void>}
 * @throws {Error} When the job's project is open in another window, or has
 *   changed there since this window had it
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

  const reason = /** @type {const} */ (`job:${jobId}`)
  const { held, stale, first } = await takeProject(job.storyId, reason).catch(error => {
    running.delete(jobId)
    throw error
  })
  if (!held || stale) {
    running.delete(jobId)
    if (held) letGoOfProject(job.storyId, reason)
    throw new Error(
      held
        ? 'The project has changed in another window since. Open it, then resume the job.'
        : 'The project is open in another window. Resume the job there.'
    )
  }
  if (first) await useStoriesStore().readAfresh(job.storyId)

  const started = Date.now()

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

  /** The steps asking now, by id. @type {Map<string, Promise<void>>} */
  const inFlight = new Map()
  /** Why a step failed, once one has: no more are started. @type {string|null} */
  let failed = null

  /**
   * Run one step and write what came of it.
   * @param {JobStep} step
   */
  const run = async step => {
    await store.updateStep(jobId, step.id, { status: 'running', error: undefined })
    setActivity(jobId, 'asking')
    try {
      const current = /** @type {Job} */ (store.getJob(jobId))
      const { provider, model, upstreams, overrides } = resolveJob(current)
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
              const answer = await complete({
                provider,
                model,
                upstreams,
                messages,
                overrides,
                signal: controller.signal,
                onChunk: piece => addChars(jobId, piece.length),
              })
              useApplicationState().noteModelUse(
                provider.id,
                model,
                answer.usage?.completion_tokens
              )
              return answer
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
        return
      }
      const message = messageOf(error)
      await store.updateStep(jobId, step.id, { status: 'failed', error: message })
      failed ??= message
    }
  }

  try {
    setActivity(jobId, 'asking')
    await store.updateJob(jobId, { status: 'running', error: undefined })
    for (;;) {
      const current = store.getJob(jobId)
      if (!current) break
      if (!state.stop && !failed) {
        const room = await roomOf(current)
        for (const step of readySteps(current.steps)) {
          if (inFlight.size >= room) break
          if (inFlight.has(step.id)) continue
          inFlight.set(
            step.id,
            run(step).finally(() => inFlight.delete(step.id))
          )
        }
      }
      if (inFlight.size === 0) {
        if (state.stop || failed) break
        const latest = /** @type {Job} */ (store.getJob(jobId))
        if (latest.steps.some(step => step.status !== 'done')) {
          await stopping({ status: 'failed', error: 'A step waits on one the job does not have.' })
          return
        }
        setActivity(jobId, 'finishing')
        let resultId
        try {
          resultId = await kind.finish(latest)
        } catch (error) {
          // Left as it was, the job would say it was running with nothing
          // running it. Every step is done; a retry only finishes again.
          await stopping({ status: 'failed', error: messageOf(error) })
          return
        }
        await stopping({ status: 'done', ...(resultId ? { resultId } : {}) })
        break
      }
      await Promise.race(inFlight.values())
    }
    // A step that failed lets the others asking finish, and keeps what they made.
    if (failed) await stopping({ status: 'failed', error: failed })
    else if (state.stop === 'pause') await stopping({ status: 'paused' })
    else if (state.stop === 'cancel') await stopping({ status: 'cancelled' })
  } finally {
    running.delete(jobId)
    clearActivity(jobId)
    letGoOfProject(job.storyId, reason)
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
