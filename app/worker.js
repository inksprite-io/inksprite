/* global Headers, Request, Response */
/**
 * The app's site on Cloudflare (`wrangler.jsonc`). Cloudflare serves each file
 * of the build in `dist` itself; this runs only for a path that isn't one:
 *
 * - `/api/prices`, the price list (`src/ai/prices.js`): read off OpenRouter's
 *   list and kept in Cloudflare's cache for a day, so OpenRouter is asked
 *   about once a day at each of Cloudflare's locations.
 * - Anything else under `/api/`, and a missing file under `/assets/`: not
 *   found. A script the page asks for and doesn't get must never come back as
 *   the page, which `_headers` would have kept for a year.
 * - Any other path, an address in the app: `index.html`, as a single-page app
 *   needs, with the header that keeps other sites from framing it.
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
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) {
      return new Response('Not found', { status: 404 })
    }
    return page(request, url, assets)
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

/**
 * The app's page, for an address in it that isn't a file.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {Around['assets']} assets
 * @returns {Promise<Response>}
 */
async function page(request, url, assets) {
  const index = await assets.fetch(new Request(new URL('/', url.origin), request))
  const headers = new Headers(index.headers)
  headers.set('content-security-policy', "frame-ancestors 'none'")
  return new Response(index.body, { status: index.status, headers })
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
