/* global Request, Response, ReadableStream */
/**
 * @module platform/fetch
 * @description Requests to servers, made from where they can be answered.
 *
 * In a browser a request is the page's own, and the server has to allow the
 * app's origin (CORS); many MCP servers and most model servers on a home
 * network do not. In the desktop app the request goes out from the native
 * side (`app/electron/src/bridge.js`): there is no page origin for a server to
 * refuse, and an `http://` address on the local network is as reachable as
 * `localhost`. Everything that talks to a server — models, speech, MCP —
 * takes its `fetch` from here.
 */

import { desktop, isDesktop } from './desktop.js'

/** Statuses whose response has no body. */
const NO_BODY = new Set([101, 103, 204, 205, 304])

/** What reads a response's body whole. */
const READERS = ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text']

/** The id of the last request sent to the native side. */
let last = 0

/**
 * `fetch`, from wherever the app is running. Takes and returns what the
 * page's own does, streamed body and abort signal included.
 *
 * @param {RequestInfo|URL} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function fetch(input, init) {
  if (!isDesktop()) return globalThis.fetch(input, init)
  return fetchNatively(new Request(input, init))
}

/**
 * Make `request` from the native side. Its body is streamed back as it
 * comes.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function fetchNatively(request) {
  const { signal } = request
  signal.throwIfAborted()
  const bridge = desktop()
  const id = ++last
  const body = request.body ? new Uint8Array(await request.arrayBuffer()) : null

  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let controller
  // Whether the body is still coming: what arrives once it has ended, been
  // stopped, or been given up on by the page, is dropped.
  let open = true
  const end = () => {
    open = false
    signal.removeEventListener('abort', stop)
  }
  // Stopped by its signal, the body fails at once, as the page's own would.
  const stop = () => {
    bridge.abortFetch(id)
    if (!open) return
    end()
    controller.error(signal.reason)
  }
  const stream = new ReadableStream({
    start: c => {
      controller = c
    },
    cancel: () => {
      end()
      bridge.abortFetch(id)
    },
  })
  signal.addEventListener('abort', stop, { once: true })

  /** @param {import('./desktop.js').DesktopBodyPart} part */
  const onBody = part => {
    if (!open) return
    if ('chunk' in part) return controller.enqueue(part.chunk)
    end()
    if ('done' in part) controller.close()
    else controller.error(new TypeError(part.error))
  }

  let head
  try {
    head = await bridge.fetch(
      id,
      {
        url: request.url,
        method: request.method,
        headers: [...request.headers],
        body,
        redirect: request.redirect,
      },
      onBody
    )
  } catch (error) {
    end()
    // What the page's own fetch throws: the signal's reason when it was
    // stopped, and a TypeError when the request never got an answer.
    throw signal.aborted ? signal.reason : new TypeError(error.message)
  }
  // Stopped just as the answer came.
  signal.throwIfAborted()

  const response = new Response(NO_BODY.has(head.status) ? null : stream, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers,
  })
  // Reading a body made here whole, the browser fails with a TypeError
  // whatever stopped it; stopped by its signal, the page's own fetch fails
  // with the signal's reason, and so does this.
  for (const name of READERS.filter(name => name in response)) {
    const read = response[name].bind(response)
    response[name] = () =>
      read().catch(error => {
        throw signal.aborted ? signal.reason : error
      })
  }
  return response
}
