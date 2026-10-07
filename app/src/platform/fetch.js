/**
 * @module platform/fetch
 * @description Requests to servers, made from where they can be answered.
 *
 * In a browser a request is the page's own, and the server has to allow the
 * app's origin (CORS); many MCP servers and most model servers on a home
 * network do not. In the desktop app the request goes out from the native
 * side, through Tauri's HTTP plugin: there is no page origin for a server to
 * refuse, and an `http://` address on the local network is as reachable as
 * `localhost`. Everything that talks to a server — models, speech, MCP —
 * takes its `fetch` from here.
 *
 * The plugin is loaded in the desktop app only, the first time it is needed,
 * so the web build never runs it.
 */

import { isDesktop } from './desktop.js'

/** The plugin's fetch, once loaded. @type {Promise<typeof globalThis.fetch>|null} */
let native = null

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
  native ??= import('@tauri-apps/plugin-http').then(
    plugin => plugin.fetch,
    error => {
      // A failed load is not a fact about the next request.
      native = null
      throw error
    }
  )
  return native.then(send => send(input, init))
}
