/**
 * @module stores/jobsStore
 * @description The long jobs running in the app, or that ran, whatever
 * project each belongs to.
 *
 * A job is work a model does over many requests — converting a book to
 * Markdown, a chunk at a time — that outlives a turn and may outlive the
 * tab. Its row holds the plan, every step's state and output, and where it
 * got to, so a tab closed halfway resumes from the step after the last one
 * that finished rather than from the top.
 *
 * Written straight to storage rather than through `syncStore`: a step's
 * output is written once, when the step is done, and the jobs are read back
 * whole when the jobs toast first opens. The sync store's debounce would only add a
 * window in which a finished step was not yet safe. Until the toast opens they
 * are only counted, which is all the Jobs button needs to know.
 */

import { defineStore } from 'pinia'
import { computed, ref, shallowRef, triggerRef } from 'vue'
import { nanoid } from 'nanoid'
import { storage } from '@/storage/index.js'
import { projectsElsewhere } from '@/platform/windows.js'

/** @typedef {import('../types/models.js').Job} Job */
/** @typedef {import('../types/models.js').JobStep} JobStep */

export const useJobsStore = defineStore('jobs', () => {
  /** @type {import('vue').ShallowRef<Map<string, Job>>} */
  const jobs = shallowRef(new Map())
  /** Whether the jobs have been read in. */
  const loaded = ref(false)
  /** How many jobs storage held when last counted, while they are not read in. */
  const counted = ref(0)
  /** Projects whose jobs were left out as they were read in: open in another window then. */
  const leftOut = new Set()

  /**
   * Read every job in, whichever project it is for. A job found still
   * `running` was interrupted — the tab closed, the app reloaded — and is
   * `paused` from here, ready to resume from its last finished step.
   *
   * The jobs of a project open in another window are that window's, and
   * left out (`platform/windows.js`); asked again, they are read in once
   * that window has let go of the project.
   *
   * @returns {Promise<void>}
   */
  async function loadJobs() {
    if (loaded.value && leftOut.size === 0) return
    try {
      const elsewhere = await projectsElsewhere()
      const free = [...leftOut].filter(storyId => !elsewhere.has(storyId))
      /** @type {Job[]} */
      const rows = loaded.value
        ? (await Promise.all(free.map(storyId => storage.ofStory('jobs', storyId)))).flat()
        : await storage.all('jobs')
      for (const storyId of free) leftOut.delete(storyId)
      for (const row of rows) {
        if (elsewhere.has(row.storyId)) {
          leftOut.add(row.storyId)
          continue
        }
        // A job this tab already holds is this tab's: running here, not
        // interrupted. The rows are for what the tab has not seen.
        if (jobs.value.has(row.id)) continue
        if (row.status === 'running') {
          row.status = 'paused'
          for (const step of row.steps) if (step.status === 'running') step.status = 'pending'
          await storage.put('jobs', row)
        }
        jobs.value.set(row.id, row)
      }
      loaded.value = true
      triggerRef(jobs)
    } catch (error) {
      console.error('Failed to load jobs:', error)
    }
  }

  /**
   * Count the jobs kept from before, without reading them: a job's row holds
   * the text it works through, which can wait for the toast.
   *
   * @returns {Promise<void>}
   */
  async function countJobs() {
    if (loaded.value) return
    try {
      counted.value = await storage.count('jobs')
    } catch (error) {
      console.error('Failed to count jobs:', error)
    }
  }

  /**
   * Start a job's record: planned, not yet running.
   *
   * @param {Omit<Job, 'id'|'status'|'created'|'updated'>} fields
   * @returns {Promise<Job>}
   */
  async function createJob(fields) {
    const now = Date.now()
    /** @type {Job} */
    const job = { id: `job_${nanoid()}`, status: 'queued', created: now, updated: now, ...fields }
    jobs.value.set(job.id, job)
    triggerRef(jobs)
    await storage.put('jobs', job)
    return job
  }

  /**
   * Change a job and write it. The job object in the map is replaced, so a
   * component holding the old one sees the change through the map.
   *
   * @param {string} jobId
   * @param {Partial<Job>} patch
   * @returns {Promise<Job|null>}
   */
  async function updateJob(jobId, patch) {
    const current = jobs.value.get(jobId)
    if (!current) return null
    const next = { ...current, ...patch, updated: Date.now() }
    jobs.value.set(jobId, next)
    triggerRef(jobs)
    await storage.put('jobs', next)
    return next
  }

  /**
   * Change one step of a job and write the job.
   *
   * @param {string} jobId
   * @param {string} stepId
   * @param {Partial<JobStep>} patch
   * @returns {Promise<Job|null>}
   */
  async function updateStep(jobId, stepId, patch) {
    const current = jobs.value.get(jobId)
    if (!current) return null
    const steps = current.steps.map(step => (step.id === stepId ? { ...step, ...patch } : step))
    return updateJob(jobId, { steps })
  }

  /**
   * Forget a job for good.
   *
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async function deleteJob(jobId) {
    jobs.value.delete(jobId)
    triggerRef(jobs)
    await storage.remove('jobs', [jobId])
  }

  /**
   * @param {string} jobId
   * @returns {Job|null}
   */
  const getJob = jobId => jobs.value.get(jobId) || null

  /**
   * Every job, newest first.
   * @returns {Job[]}
   */
  const getJobs = () => Array.from(jobs.value.values()).sort((a, b) => b.created - a.created)

  /** How many jobs are running, whichever project each is for: the Jobs button's badge. */
  const runningCount = computed(
    () => Array.from(jobs.value.values()).filter(job => job.status === 'running').length
  )

  /** Whether there is a job, read in or not: the Jobs button shows only then. */
  const hasJobs = computed(() => jobs.value.size > 0 || (!loaded.value && counted.value > 0))

  /**
   * Forget a project's jobs, read in or not: the project is being deleted.
   * A job still running is the runner's to stop first.
   *
   * @param {string} storyId
   * @returns {Promise<string[]>} The ids forgotten
   */
  async function deleteJobsForStory(storyId) {
    /** @type {Job[]} */
    const rows = await storage.ofStory('jobs', storyId)
    const ids = new Set(rows.map(row => row.id))
    for (const job of jobs.value.values()) if (job.storyId === storyId) ids.add(job.id)
    for (const id of ids) jobs.value.delete(id)
    triggerRef(jobs)
    await storage.remove('jobs', [...ids])
    await countJobs()
    return [...ids]
  }

  return {
    jobs,
    loadJobs,
    countJobs,
    createJob,
    updateJob,
    updateStep,
    deleteJob,
    deleteJobsForStory,
    getJob,
    getJobs,
    runningCount,
    hasJobs,
  }
})
