/**
 * @module stores/migrations/experimentalSkills
 * @description Interpret and Write go into a group of their own, switched off.
 *
 * The built-in skills were all in the skills group, which a chat on Default
 * had on: the model was offered Interpret, and Write was the writer's alone.
 * Interpret and Write are in the experimental group now, which every built-in
 * profile starts with off, and Write is offered in it. A chat or a profile
 * from before names no such group, so it would be offered both; it has the
 * group switched off instead, as one started today does. The writer's own
 * `/interpret` and `/write` are not tools, and work as they did.
 *
 * The group's id as of schema 28 is named here rather than imported, for the
 * reason every migration here names what it migrates: this is a statement
 * about what was true then.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

const EXPERIMENTAL = 'experimental'

/**
 * Withheld groups with the experimental one among them.
 *
 * @param {string[]|undefined} groups
 * @returns {string[]|null} Null when it is there already
 */
function withExperimentalOff(groups) {
  const list = Array.isArray(groups) ? groups : []
  return list.includes(EXPERIMENTAL) ? null : [...list, EXPERIMENTAL]
}

/**
 * Switch the experimental group off on every chat.
 *
 * Idempotent: a chat with the group off already is left as it is, so a
 * retried upgrade or a backup taken after this one restores unchanged.
 *
 * @param {any[]} chats - `chats` rows
 * @returns {{chats: any[], moved: number}}
 */
export function experimentalOffChats(chats) {
  let moved = 0
  const out = (chats || []).map(chat => {
    if (!chat) return chat
    const groups = withExperimentalOff(chat.disabledToolGroups)
    if (!groups) return chat
    moved++
    return { ...chat, disabledToolGroups: groups }
  })
  return { chats: out, moved }
}

/**
 * Switch the experimental group off on every profile of the writer's, which
 * new chats are stamped from.
 *
 * Idempotent, as `experimentalOffChats` is.
 *
 * @param {any[]} profiles - `chatProfiles` rows
 * @returns {{profiles: any[], moved: number}}
 */
export function experimentalOffProfiles(profiles) {
  let moved = 0
  const out = (profiles || []).map(profile => {
    if (!profile) return profile
    const groups = withExperimentalOff(profile.settings?.disabledToolGroups)
    if (!groups) return profile
    moved++
    return { ...profile, settings: { ...profile.settings, disabledToolGroups: groups } }
  })
  return { profiles: out, moved }
}
