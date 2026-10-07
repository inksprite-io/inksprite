/* global URLSearchParams */
/**
 * @module platform/signIn
 * @description Signing in to a service in the writer's own browser.
 *
 * In a browser, a sign-in happens in another tab, and the page the service
 * sends it back to (`/connect/...`) tells this one. In the desktop window
 * there is no other tab. The sign-in opens in the system browser, and the
 * native side listens on localhost for the service to send the browser back,
 * answers it with a page that says to go back to the app, and hands the query
 * it came back with to the page here.
 *
 * The port is fixed rather than picked fresh each time: an MCP server
 * registers the app with the address it will send the writer back to, and
 * some hold it to exactly that address.
 */

import { isDesktop } from './desktop.js'

/** Where the desktop app listens for a sign-in to come back. */
export const SIGN_IN_PORT = 41721

/**
 * Where a sign-in comes back to: this page's own origin in a browser, the
 * desktop app's listener in its window.
 *
 * @returns {string}
 */
export const callbackOrigin = () =>
  isDesktop() ? `http://localhost:${SIGN_IN_PORT}` : globalThis.location?.origin || ''

/**
 * In the desktop window: open an address in the system browser to sign in
 * there, and wait for the service to send the browser back to `path`.
 *
 * Stopped by its signal, which also stops the listening. A sign-in started
 * while another is waiting takes its place.
 *
 * @param {string|URL} address - Where to sign in
 * @param {string} path - Where the service sends the browser back, under
 *   `callbackOrigin()`: `/connect/mcp`
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<URLSearchParams>} The query it came back with
 */
export async function signInInBrowser(address, path, { signal } = {}) {
  const { invoke, Channel } = await import('@tauri-apps/api/core')
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    /** @type {import('@tauri-apps/api/core').Channel<string>} */
    const channel = new Channel(query => resolve(new URLSearchParams(query)))
    invoke('sign_in_in_browser', {
      address: String(address),
      port: SIGN_IN_PORT,
      path,
      onReturn: channel,
    }).then(
      id => {
        const stop = () => {
          invoke('stop_sign_in', { id }).catch(() => {})
          reject(signal?.reason)
        }
        if (signal?.aborted) stop()
        else signal?.addEventListener('abort', stop, { once: true })
      },
      // The native side says what went wrong as a plain string.
      error => reject(typeof error === 'string' ? new Error(error) : error)
    )
  })
}
