/* global Request, Response */
/**
 * The app's site on Cloudflare (`wrangler.jsonc`). Cloudflare serves the build
 * in `dist` itself, every path that isn't a file answered with `index.html`,
 * as a single-page app is. This runs only for `/api/*`, where the one path is
 * the price list (`/api/prices`, `src/ai/prices.js`): read off OpenRouter's
 * list and kept in Cloudflare's cache for a day, so OpenRouter is asked about
 * once a day at each of Cloudflare's locations. Anything else under `/api/`
 * is not found, rather than the app's page that every other path gets.
 */

import { PRICES_PATH, priceListResponse } from './src/ai/prices.js'

/**
 * @typedef {Object} Around
 * @property {{fetch: (request: Request) => Promise<Response>}} assets - The build's files
 * @property {{match: (key: Request) => Promise<Response|undefined>, put: (key: Request, response: Response) => Promise<void>}} cache
 * @property {(promise: Promise<any>) => void} waitUntil - Keep the Worker running for this
 * @property {typeof fetch} [ask] - How OpenRouter is asked
 */

/**
 * Answer a request that reached the Worker.
 *
 * @param {Request} request
 * @param {Around} around
 * @returns {Promise<Response>}
 */
export async function handle(request, { assets, cache, waitUntil, ask = fetch }) {
  const url = new URL(request.url)
  if (url.pathname !== PRICES_PATH) {
    return url.pathname.startsWith('/api/')
      ? new Response('Not found', { status: 404 })
      : assets.fetch(request)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  // One entry for every way of asking, whatever its query or headers.
  const key = new Request(new URL(PRICES_PATH, url.origin))
  const kept = await cache.match(key)
  if (kept) return kept
  const response = await priceListResponse(ask)
  // The response's own cache-control says how long to keep it: a day.
  if (response.ok) waitUntil(cache.put(key, response.clone()))
  return response
}

export default {
  /**
   * @param {Request} request
   * @param {{ASSETS: Around['assets']}} env
   * @param {{waitUntil: Around['waitUntil']}} context
   */
  fetch: (request, env, context) =>
    handle(request, {
      assets: env.ASSETS,
      cache: /** @type {any} */ (globalThis.caches).default,
      waitUntil: promise => context.waitUntil(promise),
    }),
}
