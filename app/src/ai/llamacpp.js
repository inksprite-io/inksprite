/* global AbortSignal */
/**
 * @module ai/llamacpp
 * @description What a llama.cpp server says it has: `/props` beside its API.
 *
 * How many slots it answers from, which is how many requests it takes at once
 * (`ai/gate.js`), and how long a context each slot holds, which is how much a
 * job can send it in one request (`jobs/explore.js`). Asked once for each
 * address a page, and nothing when it can't be asked.
 */

import { fetch } from '@/platform/fetch.js'

/** @typedef {import('@/types/models.js').AIProvider} AIProvider */

/**
 * What a server said of itself; a field it said nothing of is absent.
 *
 * @typedef {Object} ServerProps
 * @property {number} [slots] - How many requests it answers at once
 * @property {number} [context] - How many tokens a slot holds, prompt and answer
 */

/**
 * Where a server says what it has.
 *
 * @param {string|undefined} endpoint - The connection's, ending in `/v1` as often as not
 * @returns {string|null}
 */
function propsAddress(endpoint) {
  try {
    const url = new URL(endpoint || '')
    url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}/props`
    url.search = ''
    return url.href
  } catch {
    return null
  }
}

/** What each server said, by address. @type {Map<string, Promise<ServerProps>>} */
const said = new Map()

/** @param {unknown} value */
const count = value => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

/**
 * What a llama.cpp server says it has.
 *
 * @param {AIProvider} provider
 * @returns {Promise<ServerProps>}
 */
export function askProps(provider) {
  const address = propsAddress(provider.endpoint)
  if (!address) return Promise.resolve({})
  let asking = said.get(address)
  if (!asking) {
    asking = fetch(address, { signal: AbortSignal.timeout(5000) })
      .then(response => (response.ok ? response.json() : null))
      .then(props => {
        /** @type {ServerProps} */
        const found = {}
        const slots = count(props?.total_slots)
        const context = count(props?.default_generation_settings?.n_ctx)
        if (slots) found.slots = slots
        if (context) found.context = context
        return found
      })
      .catch(() => ({}))
    said.set(address, asking)
  }
  return asking
}

/** Forget what every server said: for tests. */
export function forgetProps() {
  said.clear()
}
