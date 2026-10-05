/**
 * @module mcp/client
 * @description Talking to an MCP server from the page.
 *
 * InkSprite has no backend, so the browser connects to the server itself:
 * Streamable HTTP, falling back to the older HTTP with SSE when a server
 * answers the first with a 4xx, as the spec says a client should. The client
 * is the SDK's (`@modelcontextprotocol/client`), imported the first time a
 * server is used, so a writer with none never loads it.
 *
 * One connection per server, opened when it is first needed and kept for the
 * rest of the session. A server changed or removed has its connection closed,
 * and the next call opens a fresh one.
 *
 * A server the writer has signed in to is reached with their sign-in, which
 * the SDK refreshes as it lapses (see ./auth.js); one they have not is reached
 * as it is, and says it wants signing in by answering 401.
 *
 * What the browser rules out has to be said plainly when it happens. A server
 * that will not answer a page (no CORS for this app's origin) fails exactly
 * like one that is down — the browser tells the page nothing more — so the
 * message names both.
 */

/** @typedef {import('../types/models.js').McpServer} McpServer */
/** @typedef {import('../types/models.js').McpTool} McpTool */
/** @typedef {import('../types/models.js').McpPrompt} McpPrompt */
/** @typedef {import('@modelcontextprotocol/client').Client} Client */

import { authProvider, signedIn } from './auth.js'

/** Who the app says it is, to the server. */
const CLIENT_INFO = { name: 'InkSprite', version: '1.0.0' }

/** How many pages of tools or prompts are read before giving up. */
const MAX_PAGES = 20

/** @type {Promise<typeof import('@modelcontextprotocol/client')>|null} */
let sdk = null

/** The SDK, loaded the first time anything here is used. */
function loadSdk() {
  sdk ??= import('@modelcontextprotocol/client')
  return sdk
}

/**
 * Open connections, by server id, with what they were opened with, so a
 * server whose address or headers changed gets a new one.
 *
 * @type {Map<string, {key: string, client: Promise<Client>}>}
 */
const connections = new Map()

/**
 * What a connection depends on.
 *
 * @param {Pick<McpServer, 'url'|'headers'>} server
 * @returns {string}
 */
function connectionKey(server) {
  return JSON.stringify([
    server.url,
    server.headers || {},
    Boolean(server.url && signedIn(server.url)),
  ])
}

/**
 * The HTTP status an SDK error carries, if it carries one.
 *
 * @param {any} error
 * @returns {number|undefined}
 */
function statusOf(error) {
  const status = error?.data?.status ?? error?.status ?? error?.code
  return typeof status === 'number' ? status : undefined
}

/**
 * Open a connection: Streamable HTTP, and the older SSE transport when the
 * server says it does not take the newer one.
 *
 * @param {Pick<McpServer, 'url'|'headers'>} server
 * @returns {Promise<Client>}
 */
async function open(server) {
  if (!server.url)
    throw new Error('This server runs as a program, and needs a bridge to be reached.')
  const { Client, StreamableHTTPClientTransport, SSEClientTransport } = await loadSdk()
  const url = new URL(server.url)
  const requestInit = server.headers ? { headers: { ...server.headers } } : undefined
  // Only once the writer has signed in. Before that a 401 is the answer, and
  // the sign-in is theirs to start, with a click, from Settings.
  const options = {
    requestInit,
    ...(signedIn(server.url) ? { authProvider: authProvider(server.url) } : {}),
  }

  const client = new Client(CLIENT_INFO)
  try {
    await client.connect(new StreamableHTTPClientTransport(url, options))
    return client
  } catch (error) {
    const status = statusOf(error)
    // Sign-in and refusals are answers, and another transport would get the
    // same one. A server that does not know the newer transport says so with
    // a 400, 404 or 405.
    if (status === undefined || status === 401 || status === 403 || status >= 500) throw error
  }

  const legacy = new Client(CLIENT_INFO)
  await legacy.connect(new SSEClientTransport(url, options))
  return legacy
}

/**
 * The open connection to a server, opening one if there is none.
 *
 * @param {McpServer} server
 * @returns {Promise<Client>}
 */
function connection(server) {
  const key = connectionKey(server)
  const existing = connections.get(server.id)
  if (existing && existing.key === key) return existing.client

  if (existing) disconnect(server.id)
  const client = open(server)
  connections.set(server.id, { key, client })
  // A connection that failed to open is not kept, so the next try starts over.
  client.catch(() => {
    if (connections.get(server.id)?.client === client) connections.delete(server.id)
  })
  return client
}

/**
 * Close a server's connection, if it has one.
 *
 * @param {string} serverId
 */
export function disconnect(serverId) {
  const existing = connections.get(serverId)
  if (!existing) return
  connections.delete(serverId)
  existing.client.then(client => client.close()).catch(() => {})
}

/**
 * Every page of a listing.
 *
 * @template T
 * @param {(cursor: string|undefined) => Promise<{nextCursor?: string} & Record<string, any>>} list
 * @param {string} key - Which field of a page holds the items
 * @returns {Promise<T[]>}
 */
async function everyPage(list, key) {
  /** @type {T[]} */
  const items = []
  let cursor
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await list(cursor)
    items.push(...(result[key] || []))
    cursor = result.nextCursor
    if (!cursor) break
  }
  return items
}

/**
 * What a server offers: its name for itself, and its tools and prompts.
 *
 * For a server being added as well as one that has been, so it opens a
 * connection of its own and closes it after, rather than keeping one for a
 * server that may never be saved.
 *
 * @param {Pick<McpServer, 'url'|'headers'>} server
 * @returns {Promise<{serverName: string, instructions: string, tools: Array<Omit<McpTool, 'exposed'>>, prompts: McpPrompt[]}>}
 */
export async function listServer(server) {
  const client = await open(server)
  try {
    const capabilities = client.getServerCapabilities() || {}
    const tools = capabilities.tools
      ? await everyPage(cursor => client.listTools(cursor ? { cursor } : undefined), 'tools')
      : []
    const prompts = capabilities.prompts
      ? await everyPage(cursor => client.listPrompts(cursor ? { cursor } : undefined), 'prompts')
      : []
    return {
      serverName: client.getServerVersion()?.name || '',
      instructions: client.getInstructions() || '',
      tools: tools.map(tool => ({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
      })),
      prompts: prompts.map(prompt => ({
        name: prompt.name,
        ...(prompt.title ? { title: prompt.title } : {}),
        ...(prompt.description ? { description: prompt.description } : {}),
        ...(prompt.arguments ? { arguments: prompt.arguments.map(arg => ({ ...arg })) } : {}),
      })),
    }
  } finally {
    client.close().catch(() => {})
  }
}

/**
 * Call one of a server's tools.
 *
 * @param {McpServer} server
 * @param {string} name - The server's name for the tool
 * @param {Record<string, any>} args
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Stops the call, and tells the server so
 * @param {number} [options.timeout] - How long to wait, in milliseconds. The
 *   SDK's own limit is a minute, and gives up on a call the caller is still
 *   willing to wait for.
 * @returns {Promise<any>} The server's CallToolResult
 */
export async function callServerTool(server, name, args, { signal, timeout } = {}) {
  const options = { signal, ...(timeout ? { timeout } : {}) }
  const client = await connection(server)
  try {
    return await client.callTool({ name, arguments: args || {} }, options)
  } catch (error) {
    // A session the server has forgotten, or a connection that dropped: once
    // more on a fresh one, then give up. Not a call that was stopped.
    if (!signal?.aborted && (statusOf(error) === 404 || error instanceof TypeError)) {
      disconnect(server.id)
      const fresh = await connection(server)
      return fresh.callTool({ name, arguments: args || {} }, options)
    }
    throw error
  }
}

/**
 * Ask a server for one of its prompts, filled in with these arguments.
 *
 * @param {McpServer} server
 * @param {string} name - The server's name for the prompt
 * @param {Record<string, string>} args
 * @returns {Promise<any>} The server's GetPromptResult
 */
export async function getServerPrompt(server, name, args) {
  const client = await connection(server)
  try {
    return await client.getPrompt({ name, arguments: args })
  } catch (error) {
    // The same once-more as a tool call, for the same reasons.
    if (statusOf(error) === 404 || error instanceof TypeError) {
      disconnect(server.id)
      const fresh = await connection(server)
      return fresh.getPrompt({ name, arguments: args })
    }
    throw error
  }
}

/**
 * A prompt's messages as the text of the writer's turn: what each said, one
 * after another, with a note for anything that is not text.
 *
 * @param {any} result - A GetPromptResult
 * @returns {string}
 */
export function promptText(result) {
  const parts = []
  let left = 0
  for (const message of result?.messages || []) {
    const content = message?.content
    if (content?.type === 'text' && typeof content.text === 'string') parts.push(content.text)
    else if (content?.type === 'resource' && typeof content.resource?.text === 'string') {
      parts.push(content.resource.text)
    } else left += 1
  }
  if (left > 0)
    parts.push(
      `[${left} part${left === 1 ? '' : 's'} of the prompt left out: only text is read here]`
    )
  return parts.join('\n\n').trim()
}

/** What a failure that wants the writer to sign in says. */
export const SIGN_IN_NEEDED = 'It needs you to sign in. Sign in from Settings → Connections.'

/**
 * Whether a failure is the server wanting the writer to sign in, so the
 * screen can offer to.
 *
 * @param {any} error
 * @returns {boolean}
 */
export function wantsSignIn(error) {
  return statusOf(error) === 401 || error?.name === 'UnauthorizedError'
}

/**
 * Why a server could not be reached or listed, for the writer.
 *
 * @param {any} error
 * @returns {string}
 */
export function describeFailure(error) {
  const status = statusOf(error)
  if (status === 401 || error?.name === 'UnauthorizedError') return SIGN_IN_NEEDED
  if (status === 403) return 'It refused: the key or account doesn’t have access.'
  if (status === 404) return 'Nothing answers at that address. Check the URL, including its path.'
  if (status && status >= 500) return `The server had an error (${status}). Try again later.`
  if (error instanceof TypeError || /fetch|network|load failed/i.test(String(error?.message))) {
    return 'It couldn’t be reached from the browser. Either it is down, or it doesn’t let web pages connect (CORS): many servers expect an app with a backend.'
  }
  return String(error?.message || error || 'It failed for a reason it didn’t give.')
}

/**
 * A tool's answer as the model reads it: its text, its structured content as
 * JSON when it has no text, and a note for anything left out. An answer the
 * server marked as an error goes back as one.
 *
 * @param {any} result - A CallToolResult
 * @returns {string|{error: string}}
 */
export function resultForModel(result) {
  const parts = []
  let left = 0
  for (const block of result?.content || []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block?.type === 'resource' && typeof block.resource?.text === 'string') {
      parts.push(block.resource.text)
    } else if (block?.type === 'resource_link' && block.uri) {
      parts.push(`[${block.name || block.title || 'Link'}](${block.uri})`)
    } else left += 1
  }
  if (parts.length === 0 && result?.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent))
  }
  if (left > 0)
    parts.push(
      `[${left} part${left === 1 ? '' : 's'} of the answer left out: images and other media are not read here]`
    )

  const text = parts.join('\n\n') || '(The tool returned nothing.)'
  return result?.isError ? { error: text } : text
}
