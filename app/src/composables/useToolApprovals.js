/**
 * @module composables/useToolApprovals
 * @description The tool calls waiting on the writer before they run.
 *
 * A server's tool that does not say it only reads asks first: the turn shows
 * the call and waits for Allow, Always allow (the tool, or everything from the
 * server), or Deny. The wait belongs to
 * the turn rather than to the tool, so it does not count against the tool's
 * time limit, and a turn that is stopped answers every call it was waiting on
 * with Deny.
 *
 * Kept in memory, by call: a page reloaded mid-turn has lost the turn anyway.
 */

import { computed, reactive, toValue } from 'vue'

/**
 * `always` is the tool from now on; `always-server` is everything the server
 * has.
 *
 * @typedef {'allow'|'always'|'always-server'|'deny'} Decision
 */

/**
 * @typedef {Object} PendingApproval
 * @property {string} id - The call's id
 * @property {string} messageId - The turn it was made in
 * @property {string} name - The tool, as the model called it
 * @property {string} arguments - As the model wrote them
 */

/** @type {Map<string, PendingApproval & {resolve: (decision: Decision) => void}>} */
const waiting = reactive(new Map())

/**
 * Wait for the writer to decide on a call.
 *
 * @param {string} messageId
 * @param {{id: string, function: {name: string, arguments?: string}}} call
 * @returns {Promise<Decision>}
 */
export function askApproval(messageId, call) {
  return new Promise(resolve => {
    waiting.set(call.id, {
      id: call.id,
      messageId,
      name: call.function.name,
      arguments: call.function.arguments || '',
      resolve,
    })
  })
}

/**
 * The writer's answer to a call.
 *
 * @param {string} id - The call's id
 * @param {Decision} decision
 */
export function answerApproval(id, decision) {
  const pending = waiting.get(id)
  if (!pending) return
  waiting.delete(id)
  pending.resolve(decision)
}

/**
 * Deny every call a turn is waiting on: it has stopped, and nothing will
 * come of them.
 *
 * @param {string} [messageId] - The turn's message; every turn's when absent
 */
export function denyWaiting(messageId) {
  for (const pending of [...waiting.values()]) {
    if (!messageId || pending.messageId === messageId) answerApproval(pending.id, 'deny')
  }
}

/**
 * The calls a message is waiting on, for the message to show.
 *
 * @param {import('vue').MaybeRefOrGetter<string>} messageId
 * @returns {{pending: import('vue').ComputedRef<PendingApproval[]>, answer: typeof answerApproval}}
 */
export function useToolApprovals(messageId) {
  const pending = computed(() =>
    [...waiting.values()]
      .filter(one => one.messageId === toValue(messageId))
      .map(({ id, messageId: message, name, arguments: args }) => ({
        id,
        messageId: message,
        name,
        arguments: args,
      }))
  )
  return { pending, answer: answerApproval }
}
