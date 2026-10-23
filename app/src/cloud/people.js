/**
 * @module cloud/people
 * @description Who is who, for sharing: the account this device is signed in
 * to, and who is in each project shared, as sync last heard (`useCloudSync`
 * keeps them here). Kept apart from sync itself so that what shows a
 * comment's author needn't load it.
 *
 * A comment's post written on a device signed in to sync says which account
 * wrote it (`by`). In a project shared, a post is the writer's own when that
 * is this account, and one with none, from before, is its owner's; anyone
 * else's is under their name.
 *
 * Design: `.llm/sync_design.md`, "Sharing".
 */

import { computed, shallowRef } from 'vue'

/** @typedef {import('./engine.js').Sharing} Sharing */

/**
 * The people of one project shared, for naming a post's author.
 *
 * @typedef {Object} People
 * @property {number|null} me - This account
 * @property {number|null} owner - The project's owner
 * @property {Record<number, string|null>} names - Each one's name, by account
 */

/** The account this device is signed in to, once the server has said. */
export const me = shallowRef(/** @type {number|null} */ (null))

/** The projects shared, as sync last heard. */
export const sharing = shallowRef(/** @type {Sharing} */ ({ me: null, projects: {} }))

/**
 * A post as the writer here writes it: saying which account it is, where
 * this device is signed in.
 * @template {{author: string}} T
 * @param {T} post
 * @returns {T & {by?: number}}
 */
export function byMe(post) {
  return me.value === null ? post : { ...post, by: me.value }
}

/**
 * The people of a project, where it is shared.
 * @param {string} storyId
 * @returns {People|null}
 */
export function peopleOf(storyId) {
  const shared = sharing.value.projects[storyId]
  if (!shared) return null
  return {
    me: me.value ?? sharing.value.me,
    owner: shared.owner,
    names: Object.fromEntries(shared.members.map(member => [member.account, member.display])),
  }
}

/**
 * The people of a project, kept up with sync.
 * @param {() => string} storyId
 */
export const usePeople = storyId => computed(() => peopleOf(storyId()))

/**
 * Whether a post is the writer's own here: one they wrote, rather than
 * someone they share the project with, the model, or a person in a Doc.
 * @param {{author: string, by?: number}} post
 * @param {People|null} [people]
 */
export function isMine(post, people = null) {
  if (post.author !== 'writer') return false
  if (!people || people.me === null) return true
  const who = post.by ?? people.owner
  return who === null || who === people.me
}

/**
 * The name of the one who wrote a post that is a writer's but not this
 * one's, in a project shared.
 * @param {{author: string, by?: number}} post
 * @param {People} people
 * @returns {string}
 */
export function nameOf(post, people) {
  const who = post.by ?? people.owner
  return (who !== null && people.names[who]) || 'Someone'
}
