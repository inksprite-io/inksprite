/**
 * @module jobs/live
 * @description What a running job is doing right now.
 *
 * The job's row records what is done; this records what is happening — the
 * step being asked for, how long the model has been answering, how much has
 * come back — for the panel's status line. Kept in memory only: it is true
 * for as long as the request is, and a reload starts it over.
 */

import { reactive } from 'vue'

/**
 * @typedef {Object} JobActivity
 * @property {'asking'|'checking'|'retrying'|'fallback'|'finishing'} phase
 * @property {number} since - When this phase began
 * @property {number} started - When this run of the job began: the job's
 *   `elapsed` plus the time since is how long it has run in all
 * @property {string} [detail] - A line on what is being done: the step, a note from the kind
 * @property {number} [chars] - How much of the answer has come back so far
 */

/** @type {Record<string, JobActivity>} */
export const activity = reactive({})

/**
 * Say what a job is doing.
 *
 * @param {string} jobId
 * @param {JobActivity['phase']} phase
 * @param {string} [detail]
 */
export function setActivity(jobId, phase, detail) {
  const now = Date.now()
  activity[jobId] = {
    phase,
    since: now,
    started: activity[jobId]?.started ?? now,
    detail,
    chars: 0,
  }
}

/**
 * Note how much of an answer has come back.
 *
 * @param {string} jobId
 * @param {number} chars - Added since the last note
 */
export function addChars(jobId, chars) {
  const current = activity[jobId]
  if (current) current.chars = (current.chars || 0) + chars
}

/**
 * Forget what a job was doing: it stopped.
 * @param {string} jobId
 */
export function clearActivity(jobId) {
  delete activity[jobId]
}
