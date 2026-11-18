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
import { readDirect } from './direct.js'

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
 * Who reads a page at an address: the service in use, where there is one;
 * and in the desktop app with none, the app itself, straight from the site
 * (web/direct.js). A page in a browser can't ask another site for anything,
 * so there a page is read only through a service.
 *
 * @param {WebSearchSetup|null} [from]
 * @returns {{name: string, key: string, read: WebService['read'], id: string, limited?: WebService['limited']}|null}
 */
export function readerInUse(from = setup) {
  const using = serviceInUse(from)
  if (using) {
    const { service, key } = using
    return { id: service.id, name: service.name, key, read: service.read, limited: service.limited }
  }
  return isDesktop() ? { id: 'direct', name: 'inksprite', key: '', read: readDirect } : null
}

/**
 * Whether the model keeps a page in the project without asking the writer
 * first: only once they said so, with Always allow or in Settings ›
 * Extensions › Web.
 *
 * @param {WebSearchSetup|null} [from]
 * @returns {boolean}
 */
export function savesWithoutAsking(from = setup) {
  return from?.saveWithoutAsking === true
}

/**
 * How the writer has reading set: whether an address the model put together
 * is read without asking, and the sites that always are.
 *
 * @param {WebSearchSetup|null} [from]
 * @returns {import('./addresses.js').ReadingAllowed}
 */
export function readingAllowed(from = setup) {
  return {
    always: from?.readWithoutAsking === true,
    local: from?.readLocalWithoutAsking === true,
    sites: from?.allowedSites || [],
  }
}
