/**
 * @module composables/useToolApprovals
 * @description The tool calls waiting on the writer before they run.
 *
 * A server's tool that does not say it only reads asks first: the turn shows
 * the call and waits for Allow, Always allow (the tool, or everything from the
 * server), or Deny. So does a page the model keeps in the project
 * (`save_web_page`), whose Always allow is for every page from then on, and
 * a page read or kept at an address the model put together itself, whose
 * Always allow is for the address's site (web/addresses.js). A
 * tool can also ask a question of its own as it runs, whose Always allow
 * the tool keeps: explore, saying what it would cost. The
 * wait belongs to the turn rather than to the tool, so it does not count
 * against the tool's time limit, and a turn that is stopped answers every
 * call it was waiting on with Deny.
 *
 * Kept in memory, by call: a page reloaded mid-turn has lost the turn anyway.
 */

import { computed, reactive, toValue } from 'vue'
import { needsApproval } from '@/mcp/servers.js'
import { readingAllowed, savesWithoutAsking } from '@/web/config.js'
import { addressFetched, readingAsks, siteOf } from '@/web/addresses.js'
import { READ_WEB_PAGE, SAVE_WEB_PAGE } from '@/ai/tools/web.js'

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
 * @property {string} [question] - What the tool itself asks, when it asks
 * @property {string} [site] - The site whose address is what asks, for a
 *   page read or kept: Always allow is then for the site
 */

/**
 * The site a call to a web tool waits on the writer for: the one its address
 * is on, when the address is one the model put together and the site isn't
 * always allowed (web/addresses.js).
 *
 * @param {string} name - The tool, as the model called it
 * @param {string} [written] - Its arguments, as the model wrote them
 * @param {import('@/web/addresses.js').Seen} [seen] - The addresses the chat
 *   has from outside the model. Without them nothing is asked of an address
 * @returns {string|null}
 */
export function siteAsking(name, written, seen) {
  const address = seen ? addressFetched(name, written) : null
  return address && readingAsks(address, seen, readingAllowed()) ? siteOf(address) : null
}

/**
 * Whether a call waits for the writer to allow it: a server's tool that may
 * change something, until they allow it always; a page kept in the project,
 * until they say to keep pages without asking; and a page read or kept at an
 * address the model put together, until they always allow its site.
 *
 * @param {string} name - The tool, as the model called it
 * @param {string} [written] - Its arguments, as the model wrote them
 * @param {import('@/web/addresses.js').Seen} [seen] - The addresses the chat
 *   has from outside the model
 * @returns {boolean}
 */
export function asksFirst(name, written, seen) {
  if (name === READ_WEB_PAGE) return siteAsking(name, written, seen) !== null
  if (name === SAVE_WEB_PAGE) {
    return !savesWithoutAsking() || siteAsking(name, written, seen) !== null
  }
  return needsApproval(name)
}

/** @type {Map<string, PendingApproval & {resolve: (decision: Decision) => void}>} */
const waiting = reactive(new Map())

/**
 * Wait for the writer to decide on a call.
 *
 * @param {string} messageId
 * @param {{id: string, function: {name: string, arguments?: string}}} call
 * @param {string} [question] - What the tool asks, when it asks as it runs
 * @param {string|null} [site] - The site whose address is what asks
 * @returns {Promise<Decision>}
 */
export function askApproval(messageId, call, question, site) {
  return new Promise(resolve => {
    waiting.set(call.id, {
      id: call.id,
      messageId,
      name: call.function.name,
      arguments: call.function.arguments || '',
      ...(question ? { question } : {}),
      ...(site ? { site } : {}),
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
      .map(({ id, messageId: message, name, arguments: args, question, site }) => ({
        id,
        messageId: message,
        name,
        arguments: args,
        ...(question ? { question } : {}),
        ...(site ? { site } : {}),
      }))
  )
  return { pending, answer: answerApproval }
}
