/**
 * @module stores/migrations/profileSkills
 * @description A profile's wording for its roles becomes its wording for its
 * skills.
 *
 * A profile could reword what each role ran under — the Director, Interpret,
 * Write, Compaction — kept on `settings.roles` by role id. They are skills now,
 * named by what the writer types, and "role" has come to mean something else:
 * which model a piece of work runs on, since renamed workflows. So the wording moves to
 * `settings.skills`, keyed by skill name, and Compaction's under `compact`,
 * the one whose name changed.
 *
 * The role ids as of schema 18 are named here rather than read from the
 * skills, for the reason every migration here names what it migrates: this is
 * a statement about what was true then.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/** Role ids, as of schema 18, whose skill has another name. */
const RENAMED = { compaction: 'compact' }

/**
 * Move every profile's role wording onto its skills.
 *
 * Idempotent: a profile with no `roles` is left as it is, so a retried upgrade
 * or a backup taken after this one restores unchanged. Where a profile
 * somehow has both, what is already under `skills` wins.
 *
 * @param {any[]} profiles - `chatProfiles` rows
 * @returns {{profiles: any[], moved: number}}
 */
export function rolesToSkills(profiles) {
  let moved = 0

  const out = (profiles || []).map(profile => {
    const roles = profile?.settings?.roles
    if (!roles || typeof roles !== 'object') return profile

    moved++
    const { roles: _, ...settings } = profile.settings
    /** @type {Record<string, {prompt?: string}>} */
    const skills = { ...(settings.skills || {}) }
    for (const [id, wording] of Object.entries(roles)) {
      const name = RENAMED[/** @type {keyof typeof RENAMED} */ (id)] || id
      if (!(name in skills)) skills[name] = wording
    }
    return { ...profile, settings: { ...settings, skills } }
  })

  return { profiles: out, moved }
}
