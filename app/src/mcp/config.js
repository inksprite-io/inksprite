/**
 * @module mcp/config
 * @description Servers from a pasted configuration.
 *
 * Every app that connects to MCP servers has a file of them, and they agree
 * closely enough: an object of servers by name, under `mcpServers` (Claude
 * Desktop, Cursor, LM Studio) or `servers` (VS Code), each with a `url` (or
 * Windsurf's `serverUrl`) and `headers`, or a `command` that starts a local
 * program. Pasting that block is how the writer brings the servers they
 * already use.
 *
 * A server that runs as a local program cannot be reached from a page. It is
 * kept, so the writer can see what came in and put a bridge in front of it,
 * and is shown as needing one.
 */

/**
 * One server from a configuration.
 *
 * @typedef {Object} ConfiguredServer
 * @property {string} name
 * @property {string} [url]
 * @property {Record<string, string>} [headers]
 * @property {string} [command] - For one that runs as a local program
 * @property {string[]} [args]
 */

/**
 * @param {any} value
 * @returns {value is Record<string, any>}
 */
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Headers as strings, leaving out anything that is not one.
 *
 * @param {any} headers
 * @returns {Record<string, string>|undefined}
 */
function readHeaders(headers) {
  if (!isObject(headers)) return undefined
  const kept = Object.entries(headers).filter(([, value]) => typeof value === 'string')
  return kept.length ? Object.fromEntries(kept) : undefined
}

/**
 * One entry, or why it is not one.
 *
 * @param {string} name
 * @param {any} entry
 * @returns {{server: ConfiguredServer}|{error: string}}
 */
function readEntry(name, entry) {
  if (!isObject(entry)) return { error: `${name}: not a server.` }
  const url = typeof entry.url === 'string' ? entry.url : entry.serverUrl
  if (typeof url === 'string' && url.trim()) {
    if (!isWebAddress(url)) return { error: `${name}: ${url} is not a web address.` }
    const headers = readHeaders(entry.headers)
    return { server: { name, url: url.trim(), ...(headers ? { headers } : {}) } }
  }
  if (typeof entry.command === 'string' && entry.command.trim()) {
    const args = Array.isArray(entry.args)
      ? entry.args.filter(arg => typeof arg === 'string')
      : undefined
    return { server: { name, command: entry.command.trim(), ...(args ? { args } : {}) } }
  }
  return { error: `${name}: no url or command.` }
}

/**
 * The servers in a pasted configuration.
 *
 * @param {string} text
 * @returns {{servers: ConfiguredServer[], errors: string[]}}
 */
export function parseServerConfig(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // Most apps document the block without the braces around it, so a copy
    // of it often comes without them.
    try {
      parsed = JSON.parse(`{${text}}`)
    } catch {
      return { servers: [], errors: [`That isn’t JSON: ${error.message}`] }
    }
  }
  if (!isObject(parsed)) return { servers: [], errors: ['That isn’t a list of servers.'] }

  // One server on its own, as some apps' "add server" boxes take it.
  if (typeof parsed.url === 'string' || typeof parsed.serverUrl === 'string') {
    const read = readEntry(typeof parsed.name === 'string' ? parsed.name : 'server', parsed)
    return 'server' in read
      ? { servers: [read.server], errors: [] }
      : { servers: [], errors: [read.error] }
  }

  const entries = isObject(parsed.mcpServers)
    ? parsed.mcpServers
    : isObject(parsed.servers)
      ? parsed.servers
      : parsed

  /** @type {ConfiguredServer[]} */
  const servers = []
  /** @type {string[]} */
  const errors = []
  for (const [name, entry] of Object.entries(entries)) {
    const read = readEntry(name, entry)
    if ('server' in read) servers.push(read.server)
    else errors.push(read.error)
  }
  if (servers.length === 0 && errors.length === 0) errors.push('There are no servers in that.')
  return { servers, errors }
}

/**
 * A name for a server added by its address alone: its host, less the parts
 * that say nothing (`mcp.`, `www.`, `api.`). One on this machine or the
 * network, by an IP address or a name of one word, is named by the whole of
 * it and its port, which is what tells two of them apart.
 *
 * @param {string} url
 * @returns {string}
 */
export function nameFromUrl(url) {
  try {
    const parsed = new URL(url)
    const local =
      /^\d+(\.\d+){3}$/.test(parsed.hostname) ||
      parsed.hostname.startsWith('[') ||
      !parsed.hostname.includes('.')
    if (local) return parsed.host
    const host = parsed.hostname.replace(/^(mcp|www|api)\./, '')
    const [first] = host.split('.')
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : host
  } catch {
    return 'Server'
  }
}

/**
 * Whether an address typed for a server is a web address at all.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isWebAddress(url) {
  try {
    const { protocol } = new URL(url.trim())
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
