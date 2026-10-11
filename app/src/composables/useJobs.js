/**
 * @module composables/useJobs
 * @description The app's long jobs, whichever project each is for: for the
 * panel that shows them, the outline that starts them, and the rail that
 * counts them.
 */

import { computed } from 'vue'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useDocuments } from '@/composables/useDocuments.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { cancelJob, isRunning, pauseJob, resumeJob, startConversion } from '@/jobs/index.js'
import { activity } from '@/jobs/live.js'

/** @typedef {import('@/types/models.js').Job} Job */

/**
 * How far along a job is: steps done over steps in all.
 *
 * @param {Job} job
 * @returns {{done: number, total: number, fraction: number}}
 */
export function progressOf(job) {
  const total = job.steps.length
  const done = job.steps.filter(step => step.status === 'done').length
  return { done, total, fraction: total > 0 ? done / total : 0 }
}

/**
 * How long a job has run in all, over every run: what its record holds, and
 * the run in hand's time when one is going.
 *
 * @param {Job} job
 * @param {number} now
 * @returns {number} ms
 */
export function elapsedOf(job, now) {
  const started = activity[job.id]?.started
  return (job.elapsed || 0) + (job.status === 'running' && started ? now - started : 0)
}

/**
 * A length of time the way the panel says it: `45s`, `12m 05s`, `1h 02m`.
 * @param {number} ms
 */
export function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * Every job in the app, and the ways to start, stop and drop one.
 */
export function useJobs() {
  const store = useJobsStore()
  const documents = useDocumentsStore()

  /** Every job, newest first. */
  const jobs = computed(() => {
    void store.jobs
    return store.getJobs()
  })

  /** Whether any job is running in this tab. */
  const anyRunning = computed(() => jobs.value.some(job => isRunning(job.id)))

  /** The jobs running now. */
  const runningJobs = computed(() => jobs.value.filter(job => job.status === 'running'))

  /**
   * The job running on a document, if one is.
   * @param {string} documentId
   * @returns {Job|null}
   */
  const runningOn = documentId =>
    runningJobs.value.find(job => job.documentId === documentId) || null

  /**
   * The name of the project a job is for, as the projects menu shows it.
   * @param {Job} job
   */
  const projectOf = job => documents.getRoot(job.storyId)?.title || 'Untitled'

  /**
   * Open what a finished job wrote in its project's editor, while it is
   * still there. The project is read in first, since the job may be for
   * one not open; going to it is the caller's.
   *
   * @param {Job} job
   * @returns {Promise<boolean>} Whether there was a document to open
   */
  async function openResult(job) {
    if (!job.resultId) return false
    const api = useDocuments(job.storyId)
    await api.init()
    if (!documents.getDocument(job.resultId)) return false
    api.open(job.resultId)
    return true
  }

  /** Read the jobs in, and the names of the projects they are for. */
  async function load() {
    await store.loadJobs()
    await documents.loadRoots([...new Set(store.getJobs().map(job => job.storyId))])
  }

  return {
    jobs,
    anyRunning,
    runningJobs,
    runningOn,
    projectOf,
    openResult,
    /** What a running job is doing now, by id. */
    activity,
    load,
    /**
     * @param {string} storyId
     * @param {string} documentId
     */
    convert: (storyId, documentId) => startConversion(storyId, documentId),
    pause: pauseJob,
    resume: resumeJob,
    cancel: cancelJob,
    /** @param {string} jobId */
    remove: jobId => store.deleteJob(jobId),
    running: isRunning,
    progressOf,
  }
}
