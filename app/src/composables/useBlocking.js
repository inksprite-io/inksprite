/**
 * @module composables/useBlocking
 * @description Blocking an account, from an invitation it sent or from the
 * people in Settings › Sync and sharing. Every share between the two ends,
 * both ways, and its invitations are never listed again. Where nothing is
 * shared between them it is done at once; where something is, the writer is
 * asked first (`BlockDialog`), and chooses whether the projects the other
 * shared with them go to the trash, as a project left does, or stay as
 * their own, kept on this device.
 *
 * Design: `.llm/sync_design.md`, "Invitations, people and blocks".
 */

import { ref } from 'vue'
import { sharing } from '@/cloud/people.js'
import { useCloudSync } from './useCloudSync.js'

/**
 * A block being asked about: who, and the projects shared between the two.
 *
 * @typedef {Object} Blocking
 * @property {{account: number, name: string}} person
 * @property {string[]} mine - This account's projects they are in
 * @property {string[]} theirs - Their projects this account is in
 */

/** The block the writer is being asked about. @type {import('vue').Ref<Blocking|null>} */
const asking = ref(null)

/**
 * The projects shared between this account and another, either way, as
 * sync last heard.
 * @param {number} account
 * @returns {{mine: string[], theirs: string[]}}
 */
export function sharedBetween(account) {
  /** @type {string[]} */
  const mine = []
  /** @type {string[]} */
  const theirs = []
  for (const [storyId, shared] of Object.entries(sharing.value.projects)) {
    if (shared.role === 'owner') {
      if (shared.members.some(member => member.account === account)) mine.push(storyId)
    } else if (shared.owner === account) {
      theirs.push(storyId)
    }
  }
  return { mine, theirs }
}

export function useBlocking() {
  const cloud = useCloudSync()

  /**
   * Block someone: at once where nothing is shared between the two, and
   * otherwise once the writer has said so.
   * @param {{account: number, name: string}} person
   */
  async function block(person) {
    const between = sharedBetween(person.account)
    if (between.mine.length === 0 && between.theirs.length === 0) {
      await cloud.block(person.account)
      return
    }
    asking.value = { person, ...between }
  }

  return { asking, block }
}
