/**
 * @module stores/migrations/jobWorkflows
 * @description A job's `role` becomes its `workflow`.
 *
 * A job names the settings its model is picked from: which provider, which
 * model, how hard it thinks. Those were called roles until they were renamed
 * workflows, and a job kept the name under `role`. A job paused before the
 * rename still has to find its settings when it is resumed, so the name moves
 * across rather than being read under both.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/**
 * Move every job's `role` to `workflow`.
 *
 * Idempotent: a job with no `role` is left as it is, so a retried upgrade or a
 * backup taken after this one restores unchanged. One that somehow has both
 * keeps its `workflow`.
 *
 * @param {any[]} jobs - `jobs` rows
 * @returns {{jobs: any[], moved: number}}
 */
export function rolesToWorkflows(jobs) {
  let moved = 0

  const out = (jobs || []).map(job => {
    if (!job || !('role' in job)) return job

    moved++
    const { role, ...rest } = job
    return { ...rest, workflow: rest.workflow ?? role }
  })

  return { jobs: out, moved }
}
