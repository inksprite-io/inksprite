/**
 * @module web/config
 * @description How the writer set web search up, for whatever needs to know
 * without reaching for a store: the tools, and the turn choosing them.
 *
 * A chat searches when a service is set up and the chat has the web on, as
 * every group of tools is (ai/tools/choice.js): on wherever nothing switched
 * it off, but for the profiles that offer only some, Roleplay and Blank.
 */

import { isDesktop } from '@/platform/desktop.js'
import { getWebService } from './services.js'

/** @typedef {import('../types/models.js').WebSearchSetup} WebSearchSetup */
/** @typedef {import('./services.js').WebService} WebService */

/** @type {WebSearchSetup|null} */
let setup = null

/** @type {Set<() => void>} */
const listeners = new Set()

/**
 * Replace the setup with this one, and tell everything made from it.
 *
 * @param {WebSearchSetup|null} stored
 */
export function setWebSearch(stored) {
  setup = stored ? { ...stored } : null
  for (const listener of listeners) listener()
}

/**
 * Be told whenever the setup changes.
 *
 * @param {() => void} listener
 * @returns {() => void} What to call to stop being told
 */
export function onWebSearchChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** @returns {WebSearchSetup|null} The setup as it stands */
export function webSearchSetup() {
  return setup
}

/**
 * Whether a service can be reached from here.
 *
 * @param {WebService} service
 * @returns {boolean}
 */
export function reachableService(service) {
  return !service.desktopOnly || isDesktop()
}

/**
 * The service in use and the key for it, when it can search: chosen,
 * reachable from here, and with a key if it needs one.
 *
 * @param {WebSearchSetup|null} [from]
 * @returns {{service: WebService, key: string}|null}
 */
export function serviceInUse(from = setup) {
  const service = getWebService(from?.service)
  if (!service || !reachableService(service)) return null
  const key = from?.keys?.[service.id] || ''
  if (service.needsKey && !key) return null
  return { service, key }
}

/**
 * Whether the model keeps a page in the project without asking the writer
 * first: only once they said so, with Always allow or in Settings ›
 * Extensions › Web search.
 *
 * @param {WebSearchSetup|null} [from]
 * @returns {boolean}
 */
export function savesWithoutAsking(from = setup) {
  return from?.saveWithoutAsking === true
}
