/**
 * @module web/config
 * @description How the writer set web search up, for whatever needs to know
 * without reaching for a store: the tools, and the turn choosing them.
 *
 * Web search is opted into, as a server's tools are. Profiles and chats name
 * the tool groups they withhold, so a group added later would turn up in
 * every chat there is, Roleplay and Blank included. So a chat searches when a
 * service is set up and either the setup lists the chat's profile or the
 * chat itself said so (`Chat.web`).
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
 * Whether a chat searches the web: a service can search, and the chat chose
 * it, or, until it chooses, its profile is one the setup lists.
 *
 * @param {{web?: boolean}|null|undefined} chat
 * @param {string} profileId - The chat's profile, the default resolved
 * @param {WebSearchSetup|null} [from]
 * @returns {boolean}
 */
export function webForChat(chat, profileId, from = setup) {
  if (!serviceInUse(from)) return false
  return typeof chat?.web === 'boolean' ? chat.web : (from?.profiles || []).includes(profileId)
}
