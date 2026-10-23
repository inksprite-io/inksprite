/**
 * @module ai/gate
 * @description How many requests a connection is asked at once, and who goes
 * first while it is busy.
 *
 * A server run at home answers from a slot or two, and keeps in each the
 * prompt it last read, so the next request in the same conversation reads
 * only what is new. Asked for five things at once, it answers them in turn
 * anyway, and each one that lands in the slot after another conversation
 * reads its whole prompt again; KoboldCpp turns a second request away
 * outright. So a server at home is asked one thing at a time, or as many as
 * it says it has slots for (llama.cpp's `/props`; see `ai/llamacpp.js`),
 * unless the writer says otherwise on the connection
 * (`AIProvider.concurrency`).
 *
 * A hosted service is asked as many things at once as there are to ask. Its
 * real limit is the account's rate limit, counted in requests and tokens a
 * minute, which depends on the provider and the tier and which no number
 * here could know. So when it answers 429, the request waits as long as the
 * service says (Retry-After), or a few seconds more each time when it says
 * nothing, and is asked again; and the connection is asked half as much at
 * once as it was, coming back up one request at a time as answers come.
 *
 * Every request to a model goes through here: a turn, a skill, a title, a
 * job's step. Requests someone is waiting on go before a job's: the writer
 * never waits behind a summary. A request holds its place from when it is
 * sent until its answer has finished streaming.
 *
 * Kept for the page: a reload starts every connection afresh.
 */

import { BUILT_IN_PROVIDERS } from './providers.js'
import { askProps, forgetProps } from './llamacpp.js'

/** @typedef {import('@/types/models.js').AIProvider} AIProvider */

/**
 * Who is waiting on a request: `now` for the writer (a turn, a skill inside
 * one, a title), `later` for a job running on its own.
 *
 * @typedef {'now'|'later'} Urgency
 */

/** How many times a request the service refused for its rate is asked again. */
export const RATE_RETRIES = 4

/** How long to wait the first time a service refuses without saying how long, in ms; doubling after. */
const FIRST_WAIT_MS = 2000

/**
 * The longest a request waits to be asked again. A service that says to wait
 * longer than this has run out for the day, or the hour, and the writer is
 * better told than kept waiting.
 */
export const LONGEST_WAIT_MS = 60000

/** The built-in connections to servers at home, by id: one request at a time. */
const AT_HOME = new Set(
  BUILT_IN_PROVIDERS.filter(entry =>
    ['lmstudio', 'ollama', 'koboldcpp', 'kokoro'].includes(entry.server || '')
  ).map(entry => entry.id)
)

/** The types that are hosted services. */
const HOSTED = new Set(['openrouter', 'anthropic', 'openai', 'gemini'])

/**
 * A refusal for the rate the connection is being asked at: a 429. Said for
 * the writer, and carrying how long the service asked to be left, when it
 * said.
 */
export class RateLimitedError extends Error {
  /**
   * @param {string} message
   * @param {number} [retryAfter] - In ms
   */
  constructor(message, retryAfter) {
    super(message)
    this.name = 'RateLimitedError'
    this.retryAfter = retryAfter
  }
}

/** What a rate-limited request says when it gives up. */
export const RATE_LIMITED = 'Rate limited. Wait a moment and try again, or pick another model.'

/**
 * How long a service asked to be left, from its Retry-After: seconds, or a
 * date.
 *
 * @param {Headers|Record<string, string>|null|undefined} headers
 * @returns {number|undefined} In ms
 */
export function retryAfterOf(headers) {
  if (!headers) return undefined
  const value =
    typeof (/** @type {Headers} */ (headers).get) === 'function'
      ? /** @type {Headers} */ (headers).get('retry-after')
      : /** @type {Record<string, string>} */ (headers)['retry-after']
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

/**
 * Whether an address is a server at home: this machine, the local network,
 * or a name only the local network knows.
 *
 * @param {string|undefined} address
 * @returns {boolean}
 */
export function isAtHome(address) {
  let hostname
  try {
    hostname = new URL(address || '').hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return false
  }
  if (!hostname) return false
  if (hostname === 'localhost' || hostname === '::1' || !hostname.includes('.')) return true
  if (/\.(local|lan|home|internal|localhost)$/.test(hostname)) return true
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  const [a, b] = parts
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/**
 * How many requests a connection takes at once when the writer hasn't said:
 * as many as asked for from a hosted service, or from vLLM, which is built to
 * take many; one from a server at home, or what llama.cpp says it has slots
 * for; and for any other server, one at home and as many as asked elsewhere.
 *
 * @param {AIProvider} provider
 * @param {number} [slots] - What llama.cpp said, when it has
 * @returns {number} Infinity for no limit
 */
export function defaultRoom(provider, slots) {
  if (HOSTED.has(provider.type)) return Infinity
  if (provider.id === 'provider_vllm_default') return Infinity
  if (provider.type === 'llamacpp') return slots && slots > 0 ? slots : 1
  if (AT_HOME.has(provider.id)) return 1
  return isAtHome(provider.endpoint) ? 1 : Infinity
}

/**
 * How many requests a connection takes at once: what the writer set on it,
 * else what it takes by default.
 *
 * @param {AIProvider} provider
 * @returns {Promise<number>} Infinity for no limit
 */
export async function roomFor(provider) {
  const set = provider.concurrency
  if (typeof set === 'number' && Number.isInteger(set) && set > 0) return set
  return defaultRoom(
    provider,
    provider.type === 'llamacpp' ? (await askProps(provider)).slots : undefined
  )
}

/**
 * A request waiting for its place.
 *
 * @typedef {Object} Waiting
 * @property {Urgency} urgency
 * @property {() => void} go - Its place is taken for it: on its way
 */

/**
 * A connection, as this page is asking it.
 *
 * @typedef {Object} Lane
 * @property {number} room - How many it takes at once, as last worked out
 * @property {number} busy - Places taken: requests sent and not yet answered in full
 * @property {number} eased - How many at once since it was last refused for
 *   its rate, rising by one with each answer; Infinity once back to its room
 * @property {number} until - When it may be asked again after a refusal, in ms since the epoch
 * @property {ReturnType<typeof setTimeout>|null} timer - Wakes the line when the wait is over
 * @property {Waiting[]} waiting - Those waiting now first, then jobs, each in the order they came
 */

/** @type {Map<string, Lane>} */
const lanes = new Map()

/** @param {string} id */
function laneOf(id) {
  let lane = lanes.get(id)
  if (!lane) {
    lane = { room: 1, busy: 0, eased: Infinity, until: 0, timer: null, waiting: [] }
    lanes.set(id, lane)
  }
  return lane
}

/** @param {Lane} lane */
const hasPlace = lane => lane.busy < Math.min(lane.room, lane.eased)

/**
 * Let those first in line go while there are places, each with its place
 * taken for it, so nobody who comes in the meantime takes it first. While the
 * connection is cooling off after a refusal, nobody goes, and the line is
 * woken when the wait is over.
 *
 * @param {Lane} lane
 */
function wake(lane) {
  while (lane.waiting.length > 0 && hasPlace(lane)) {
    const wait = lane.until - Date.now()
    if (wait > 0) {
      lane.timer ??= setTimeout(() => {
        lane.timer = null
        wake(lane)
      }, wait)
      return
    }
    lane.busy++
    lane.waiting[0].go()
  }
}

/**
 * Wait for a place on a connection: until it is no longer cooling off after
 * a refusal, and fewer requests are out than it takes. Someone waiting now
 * goes before a job; otherwise in the order they came.
 *
 * @param {Lane} lane
 * @param {Urgency} urgency
 * @param {AbortSignal|undefined} signal
 * @returns {Promise<() => void>} What to call when the answer is in, to give the place back
 */
async function take(lane, urgency, signal) {
  signal?.throwIfAborted()
  const ahead = lane.waiting.some(one => urgency === 'later' || one.urgency === 'now')
  if (!ahead && hasPlace(lane) && lane.until <= Date.now()) {
    lane.busy++
  } else {
    await new Promise((resolve, reject) => {
      /** @type {Waiting} */
      const waiting = { urgency, go: () => settle(resolve) }
      const stop = () => settle(() => reject(signal?.reason))
      /** @param {(value?: any) => void} end */
      function settle(end) {
        const at = lane.waiting.indexOf(waiting)
        if (at !== -1) lane.waiting.splice(at, 1)
        signal?.removeEventListener('abort', stop)
        end()
      }
      signal?.addEventListener('abort', stop, { once: true })
      const jobs = urgency === 'now' ? lane.waiting.findIndex(one => one.urgency === 'later') : -1
      lane.waiting.splice(jobs === -1 ? lane.waiting.length : jobs, 0, waiting)
      wake(lane)
    })
  }
  let given = false
  return () => {
    if (given) return
    given = true
    lane.busy--
    wake(lane)
  }
}

/**
 * Send a request to a connection when it has room for it.
 *
 * `send` makes the request and resolves once its answer is whole, so the
 * place is held for as long as the answer streams. A refusal for the rate
 * (RateLimitedError, thrown before anything of the answer has come) is asked
 * again, after the wait the service asked for, up to RATE_RETRIES times;
 * anything else is passed on as it is.
 *
 * @template T
 * @param {AIProvider} provider
 * @param {{urgency?: Urgency, signal?: AbortSignal}} options
 * @param {() => Promise<T>} send
 * @returns {Promise<T>}
 */
export async function throughGate(provider, { urgency = 'now', signal } = {}, send) {
  const room = await roomFor(provider)
  const lane = laneOf(provider.id)
  lane.room = room
  for (let attempt = 0; ; attempt++) {
    const giveBack = await take(lane, urgency, signal)
    try {
      const answer = await send()
      // Answered: one more at once, until it is back to its room.
      if (Number.isFinite(lane.eased)) {
        lane.eased = lane.eased + 1 >= room ? Infinity : lane.eased + 1
      }
      return answer
    } catch (error) {
      if (!(error instanceof RateLimitedError) || signal?.aborted) throw error
      const wait = error.retryAfter ?? FIRST_WAIT_MS * 2 ** attempt
      if (attempt >= RATE_RETRIES || wait > LONGEST_WAIT_MS) throw error
      // Half as many at once as were out when it said no, and none at all
      // until the wait is over.
      lane.eased = Math.max(1, Math.floor(Math.min(lane.busy, room) / 2))
      lane.until = Math.max(lane.until, Date.now() + wait)
    } finally {
      giveBack()
    }
  }
}

/**
 * Run calls at most so many at a time, each starting as one before it ends.
 *
 * @param {number} room - Infinity for all at once
 * @returns {<T>(run: () => Promise<T>) => Promise<T>}
 */
export function inTurn(room) {
  let running = 0
  /** @type {Array<() => void>} */
  const queued = []
  return async run => {
    if (running >= room) await new Promise(resolve => queued.push(() => resolve(undefined)))
    else running++
    try {
      return await run()
    } finally {
      // The next in line takes this one's place as it is given up.
      const next = queued.shift()
      if (next) next()
      else running--
    }
  }
}

/** Forget every connection's state and what llama.cpp said: for tests. */
export function resetGate() {
  for (const lane of lanes.values()) if (lane.timer) clearTimeout(lane.timer)
  lanes.clear()
  forgetProps()
}
