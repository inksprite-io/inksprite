<template>
  <BlockDialog />
</template>

<script setup>
import { watch } from 'vue'
import { useToast as usePrimeToast } from 'primevue/usetoast'
import BlockDialog from './BlockDialog.vue'
import { readFriendCode } from '@/cloud/crypto.js'
import { sharing } from '@/cloud/people.js'
import { useBlocking } from '@/composables/useBlocking.js'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { useToast } from '@/composables/useToast.js'

/**
 * A toast for each invitation to a project, which stays until it is
 * answered: Accept, Reject or Block. One answered on another device, or
 * taken back by whoever sent it, goes. One closed unanswered isn't shown
 * again in this window; Settings › Sync and sharing lists it, and the
 * outline's menu says it waits. See composables/useCloudSync.js.
 *
 * @typedef {import('@/cloud/engine.js').Invitation} Invitation
 */
const prime = usePrimeToast()
const toast = useToast()
const cloud = useCloudSync()
const { block } = useBlocking()

/** The toast shown for each invitation, by its key, closed or not. @type {Map<string, object>} */
const shown = new Map()

/** @param {Invitation} invitation */
const keyOf = invitation => `${invitation.collection} ${invitation.invited}`

/**
 * Answer an invitation, saying so if it couldn't be.
 * @param {() => Promise<void>} answer
 * @param {string} failed - What didn't happen
 */
const answering = (answer, failed) => () => {
  answer().catch(error => toast.error(`${failed} ${/** @type {Error} */ (error).message}`))
}

/** @param {Invitation} invitation */
function show(invitation) {
  const { from, title, collection } = invitation
  const message = {
    severity: 'info',
    summary: title
      ? `${from.name} shared a project with you: ${title}`
      : `${from.name} shared a project with you.`,
    detail: from.friend ? `Friend code: ${readFriendCode(from.friend) ?? from.friend}` : undefined,
    life: null,
    closable: true,
    actions: [
      {
        label: 'Accept',
        name: 'invitation-accept',
        command: answering(() => cloud.accept(collection), "The project couldn't be accepted."),
      },
      {
        label: 'Reject',
        name: 'invitation-reject',
        command: answering(() => cloud.reject(collection), "The project couldn't be rejected."),
      },
      // Blocking may ask first; the toast goes once the invitation does.
      {
        label: 'Block',
        name: 'invitation-block',
        stays: true,
        command: answering(() => block(from), `${from.name} couldn't be blocked.`),
      },
    ],
  }
  prime.add(message)
  shown.set(keyOf(invitation), message)
}

watch(
  () => sharing.value.invitations,
  invitations => {
    const waiting = new Set(invitations.map(keyOf))
    for (const [key, message] of shown) {
      if (waiting.has(key)) continue
      prime.remove(message)
      shown.delete(key)
    }
    for (const invitation of invitations) if (!shown.has(keyOf(invitation))) show(invitation)
  },
  { immediate: true }
)
</script>
