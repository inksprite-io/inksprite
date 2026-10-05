/**
 * @module harness/endpoints
 * @description The endpoints this machine can reach, from
 * `scripts/endpoints.local.json` — the file `scripts/chat-harness.js` reads too.
 *
 * Each entry is an AIProvider without its id, plus the model to run on it:
 * `type` (`openrouter`, `llamacpp`, or `generic`; generic when absent),
 * `endpoint` for anything that is not OpenRouter, and the key as either
 * `apiKey` inline or `apiKeyFile`, a path relative to `app/` to a file holding
 * the key alone. An OpenRouter entry may carry `routing`, the app's own
 * routing policy (`only`, `ignore`, `quantizations`, and the rest — see
 * ai/routing.js), which is resolved the way the app resolves it, so an entry
 * without one still gets the privacy floor. The file is not committed;
 * `endpoints.example.json` shows the shape.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Where the endpoints live. */
export const ENDPOINTS_FILE = join(APP_DIR, 'scripts', 'endpoints.local.json')

/**
 * @typedef {Object} Endpoint
 * @property {string} name - The key it was listed under
 * @property {'openrouter'|'llamacpp'|'generic'} type
 * @property {string} [endpoint] - Base URL, for every type but OpenRouter
 * @property {string} [apiKey]
 * @property {string} [model] - The model to run, when the entry names one
 * @property {Partial<import('@/ai/routing.js').OpenRouterRouting>} [routing] - Provider
 *   routing for an OpenRouter entry; absent means the app's defaults
 */

/**
 * Every endpoint in the file, keys resolved. An absent file is no endpoints.
 *
 * @returns {Promise<Record<string, Endpoint>>}
 */
export async function loadEndpoints() {
  /** @type {Record<string, any>} */
  let raw
  try {
    raw = JSON.parse(await readFile(ENDPOINTS_FILE, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return {}
  }

  /** @type {Record<string, Endpoint>} */
  const endpoints = {}
  for (const [name, entry] of Object.entries(raw)) {
    const { apiKeyFile, ...rest } = entry
    /** @type {Endpoint} */
    const endpoint = { type: 'generic', ...rest, name }
    if (apiKeyFile && !endpoint.apiKey) {
      endpoint.apiKey = (await readFile(resolve(APP_DIR, apiKeyFile), 'utf8')).trim()
    }
    endpoints[name] = endpoint
  }
  return endpoints
}

/**
 * The named endpoint, or the first in the file when no name is given.
 *
 * @param {string} [name]
 * @returns {Promise<Endpoint>}
 * @throws {Error} When there is no such endpoint, or no file to find one in
 */
export async function resolveEndpoint(name) {
  const endpoints = await loadEndpoints()
  const key = name || Object.keys(endpoints)[0]
  if (!key) {
    throw new Error(
      `No endpoints. Copy scripts/endpoints.example.json to ${ENDPOINTS_FILE} and fill it in.`
    )
  }
  const endpoint = endpoints[key]
  if (!endpoint) {
    throw new Error(`Unknown endpoint "${key}". Known: ${Object.keys(endpoints).join(', ')}`)
  }
  return endpoint
}
