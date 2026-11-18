/**
 * @module addresses
 * @description Whether an address is the writer's own computer or network,
 * by where it leads and not by what it is called. The page tells a local
 * address by its name (`src/web/addresses.js`), which a name anyone may
 * register gets past: it only has to resolve to a private number, or
 * redirect to one. A fetch the page marks as for the web alone is made here
 * a step at a time, each step's host looked up first, and refused when it
 * is local.
 *
 * What is not closed: the host is looked up here and again by Chromium as
 * it connects, and a name could answer the two differently.
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** What a fetch refused for where it led says, which the page looks for. */
export const LOCAL_REFUSED = 'That address is on this computer or its network.'

/** How many redirects a fetch for the web alone follows. */
const MOST_STEPS = 10

/**
 * Whether a number is this computer's, or in a range kept for private use.
 *
 * @param {string} address - An IPv4 or IPv6 number
 * @returns {boolean}
 */
export function isPrivateNumber(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return isPrivateNumber(mapped[1])
  if (isIP(address) === 6) {
    const lower = address.toLowerCase()
    return (
      lower === '::1' ||
      lower === '::' ||
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith('::ffff:')
    )
  }
  const [a, b] = address.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * Whether an address leads to the writer's own computer or network: its
 * host is a private number, or a name that resolves to one. A name that
 * can't be looked up leads nowhere, and is left to the fetch to fail on.
 *
 * @param {string} url
 * @param {(host: string) => Promise<Array<{address: string}>>} [resolve]
 * @returns {Promise<boolean>}
 */
export async function leadsHome(url, resolve = host => lookup(host, { all: true })) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return isPrivateNumber(host)
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const found = await resolve(host).catch(() => [])
  return found.some(({ address }) => isPrivateNumber(address))
}

/**
 * Fetch an address for the web alone: each step looked up before it is
 * taken, redirects followed here so each is looked up too.
 *
 * @param {(url: string, init: object) => Promise<Response>} fetch - Electron's
 * @param {string} url
 * @param {object} init - What the request is made with, its redirect aside
 * @param {(url: string) => Promise<boolean>} [home]
 * @param {string[]} [allowed] - The sites (host, and port where one is
 *   named) the writer always allows, which may be at home: only these, so
 *   that an allowed site's redirect leads to no other place there
 * @returns {Promise<Response>}
 * @throws {Error} `LOCAL_REFUSED`, or for more redirects than are followed
 */
export async function fetchFromWeb(fetch, url, init, home = leadsHome, allowed = []) {
  let at = url
  for (let step = 0; step <= MOST_STEPS; step++) {
    const site = new URL(at).host.toLowerCase()
    // Which step it was goes on a line of its own, for the page to ask about.
    if (!allowed.includes(site) && (await home(at))) throw new Error(`${LOCAL_REFUSED}\n${site}`)
    const response = await fetch(at, { ...init, redirect: 'manual' })
    const to = response.status >= 300 && response.status < 400 && response.headers.get('location')
    if (!to) return response
    const next = new URL(to, at)
    // Not home, and nothing to ask the writer about: no page is there.
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw new Error('That address redirects to what is no web page.')
    }
    at = next.href
  }
  throw new Error('That address redirects too many times.')
}
