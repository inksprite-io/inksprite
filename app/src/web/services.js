/**
 * @module web/services
 * @description The search services the writer can connect, and what each
 * needs.
 *
 * One is in use at a time, behind the same two tools. Exa and Kagi are
 * reached through their hosted MCP servers, which answer a page; Brave
 * refuses a page, so it is the desktop app's alone.
 */

import { checkExa, readExa, searchExa, EXA_LIMITED } from './exa.js'
import { checkKagi, readKagi, searchKagi } from './kagi.js'
import { searchBrave } from './brave.js'
import { readDirect } from './direct.js'

/** @typedef {import('./answers.js').SearchAnswer} SearchAnswer */
/** @typedef {import('./answers.js').Page} Page */
/** @typedef {import('../types/models.js').WebServiceId} WebServiceId */

/**
 * @typedef {Object} CallOptions
 * @property {string} [key] - The writer's key for the service
 * @property {AbortSignal} [signal] - The call's, which stops it
 * @property {number} [timeout] - How long the call may take, in milliseconds
 *
 * @typedef {Object} WebService
 * @property {WebServiceId} id
 * @property {string} name - As the writer knows it
 * @property {boolean} needsKey - Whether it answers at all without a key
 * @property {boolean} desktopOnly - Whether only the desktop app can reach it
 * @property {string} [note] - The one line Connections shows under it
 * @property {string} [limited] - What its own limit running out means for the writer
 * @property {(query: string, options: CallOptions) => Promise<SearchAnswer>} search
 * @property {(url: string, options: CallOptions) => Promise<Page>} read
 * @property {(key?: string) => Promise<void>} [check] - Whether it answers with
 *   this key, at no cost; one without has its key tried by its first search
 */

/** @type {WebService[]} */
export const WEB_SERVICES = [
  {
    id: 'exa',
    name: 'Exa',
    needsKey: false,
    desktopOnly: false,
    note: 'Searches go to Exa, which may keep them.',
    limited: EXA_LIMITED,
    search: searchExa,
    read: readExa,
    check: checkExa,
  },
  {
    id: 'kagi',
    name: 'Kagi',
    needsKey: true,
    desktopOnly: false,
    search: searchKagi,
    read: readKagi,
    check: checkKagi,
  },
  // No free check: a search costs, so its key is tried by its first.
  {
    id: 'brave',
    name: 'Brave',
    needsKey: true,
    desktopOnly: true,
    search: searchBrave,
    read: readDirect,
  },
]

/**
 * @param {string|undefined} id
 * @returns {WebService|undefined}
 */
export function getWebService(id) {
  return WEB_SERVICES.find(service => service.id === id)
}
