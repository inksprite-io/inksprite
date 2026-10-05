/**
 * @module harness/environment
 * @description The browser the app expects, stood up in Node.
 *
 * Imported before anything under `src/`. Dexie reads `indexedDB` off the
 * global the moment its module evaluates, and the stores read
 * `window.localStorage` the moment they are used, so both have to be there
 * before either module is. Pinia is made active here for the same reason: the
 * stores are plain `defineStore` calls with no app to install them into.
 *
 * Also the one place the harness looks at the wire. `fetch` is wrapped to keep
 * every chat completion request the app sends, so a run can write down what
 * the model was actually shown — the request is the thing being tuned, and the
 * transcript alone does not say what was in it.
 */

import 'fake-indexeddb/auto'
import { Window } from 'happy-dom'
import { createPinia, setActivePinia } from 'pinia'

const window = new Window({ url: 'http://localhost:8002/' })

// Everything the window has that Node does not — HTMLElement, DOMParser, the
// storages. Node's own globals win, apart from the four the app has to find
// on one page.
for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globalThis) continue
  const descriptor = Object.getOwnPropertyDescriptor(window, key)
  if (!descriptor) continue
  try {
    Object.defineProperty(globalThis, key, { ...descriptor, configurable: true })
  } catch {
    // Read-only on this Node; the app does not need it.
  }
}
for (const key of ['window', 'document', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, {
    value: /** @type {any} */ (window)[key],
    configurable: true,
    writable: true,
  })
}

setActivePinia(createPinia())

/**
 * A request the app made to a chat completions endpoint.
 *
 * @typedef {Object} CapturedRequest
 * @property {string} url
 * @property {any} body - Parsed JSON, or the raw string if it was not JSON
 * @property {string} [provider] - The upstream that served it, read off the
 *   response as it streamed, when the server names one
 * @property {{prompt_tokens?: number, completion_tokens?: number}} [usage] - What
 *   the server said the request cost, off the stream's last chunk. A skill's
 *   requests are counted nowhere else: a consultation's tokens are not put on
 *   the message it answers for.
 */

/**
 * Every chat completion request since the last reset, in the order sent.
 * @type {CapturedRequest[]}
 */
export const requests = []

/** The streams still being read for their usage. */
const reading = new Set()

/** Forget the requests kept so far. Called at the start of each run. */
export function resetRequests() {
  requests.length = 0
}

/**
 * Wait until every response so far has been read to its end, so the usage on
 * the last request of a turn is there before the requests are written down.
 *
 * @returns {Promise<void>}
 */
export async function requestsSettled() {
  await Promise.all([...reading])
}

/**
 * Read the provider and the usage off a streamed response without consuming it.
 *
 * OpenRouter puts `"provider":"…"` in every chunk, and the app asks for usage
 * (`stream_options.include_usage`), which comes on the last. The body is
 * split, the app gets one branch untouched, and this reads the other to the
 * end a line at a time.
 *
 * @param {Response} response
 * @param {CapturedRequest} captured
 * @returns {Response} The response to hand the app
 */
function watchProvider(response, captured) {
  if (!response.body) return response
  const [forApp, forUs] = response.body.tee()
  /** @param {string} line */
  const read = line => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    try {
      const chunk = JSON.parse(data)
      if (!captured.provider && typeof chunk.provider === 'string') {
        captured.provider = chunk.provider
      }
      if (chunk.usage) captured.usage = chunk.usage
    } catch {
      // Not a chunk of ours to read.
    }
  }
  const finished = (async () => {
    const reader = forUs.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop() || ''
        lines.forEach(read)
      }
      read(pending)
    } catch {
      // The app's branch is the one that matters; ours can fail quietly.
    } finally {
      reader.cancel().catch(() => {})
    }
  })()
  reading.add(finished)
  finished.finally(() => reading.delete(finished))
  return new globalThis.Response(forApp, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (init?.body && /chat\/completions\/?$/.test(url)) {
    let body = init.body
    try {
      body = JSON.parse(String(init.body))
    } catch {
      // Not JSON; keep the string.
    }
    /** @type {CapturedRequest} */
    const captured = { url, body }
    requests.push(captured)
    return watchProvider(await realFetch(input, init), captured)
  }
  return realFetch(input, init)
}
