/**
 * @module mcp/servers
 * @description The servers the writer has connected, as the rest of the app
 * reads them.
 *
 * Set by the store that keeps them (`stores/mcpServerStore.js`), the way the
 * skills library is, so the tool registry and the chat can read them without
 * reaching for a store, and be told when they change.
 *
 * A server is opted into, not out of. Each lists the profiles whose chats use
 * it; a chat follows that until the writer picks servers in the chat itself.
 * The usual rule — every group on unless withheld — would put a server added
 * tomorrow into every Roleplay chat, which withholds the groups it knows of
 * and has never heard of this one.
 */

/** @typedef {import('../types/models.js').McpServer} McpServer */
/** @typedef {import('../types/models.js').McpTool} McpTool */
/** @typedef {import('../types/models.js').McpPrompt} McpPrompt */

/** @type {McpServer[]} */
let servers = []

/** @type {Set<() => void>} */
const listeners = new Set()

/**
 * Replace the servers with these, and tell everything made from them.
 *
 * @param {McpServer[]} stored
 */
export function setServers(stored) {
  servers = [...(stored || [])]
  for (const listener of listeners) listener()
}

/**
 * Be told whenever the servers change.
 *
 * @param {() => void} listener
 * @returns {() => void} What to call to stop being told
 */
export function onServersChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** @returns {McpServer[]} Every server, in the order they were added */
export function allServers() {
  return servers
}

/**
 * @param {string} id
 * @returns {McpServer|undefined}
 */
export function getServer(id) {
  return servers.find(server => server.id === id)
}

/**
 * Whether a server can be reached from here: it has an address. One that runs
 * as a local program needs a bridge first.
 *
 * @param {McpServer} server
 * @returns {boolean}
 */
export function reachable(server) {
  return Boolean(server.url)
}

/**
 * The headers a server has no value for: its key, left out of the backup it
 * was restored from, and not sent until the writer enters it again.
 *
 * @param {Pick<McpServer, 'headers'>} server
 * @returns {string[]} Their names
 */
export function missingHeaders(server) {
  return Object.entries(server.headers || {})
    .filter(([, value]) => !value)
    .map(([name]) => name)
}

/**
 * The server a tool the model calls belongs to, and the tool.
 *
 * @param {string} exposed - The name the model called
 * @returns {{server: McpServer, tool: McpTool}|null}
 */
export function serverTool(exposed) {
  for (const server of servers) {
    const tool = (server.tools || []).find(one => one.exposed === exposed)
    if (tool) return { server, tool }
  }
  return null
}

/**
 * The servers whose tools a chat is offered: the ones it chose, or, until it
 * chooses, the ones that list its profile.
 *
 * @param {{mcpServers?: string[]}|null|undefined} chat
 * @param {string} profileId - The chat's profile, the default resolved
 * @param {McpServer[]} [from] - The servers to choose among; every one by default
 * @returns {McpServer[]}
 */
export function serversForChat(chat, profileId, from = servers) {
  const chosen = chat?.mcpServers
  return from.filter(
    server =>
      reachable(server) &&
      (Array.isArray(chosen)
        ? chosen.includes(server.id)
        : (server.profiles || []).includes(profileId))
  )
}

/**
 * How many of a prompt's arguments the writer has to fill in.
 *
 * @param {McpPrompt} prompt
 * @returns {number}
 */
export function requiredArguments(prompt) {
  return (prompt.arguments || []).filter(argument => argument.required).length
}

/**
 * A server's prompt as a command the writer can type, or null for one that
 * cannot be one yet.
 *
 * The text after the name is one argument, so a prompt that needs more than
 * one filled in is listed with its server and not offered. One that needs
 * none takes the text, if any, as its first argument, or after it when it
 * has none at all.
 *
 * @typedef {Object} PromptCommand
 * @property {string} name - What the writer types after the slash: `<prefix>:<prompt>`
 * @property {McpServer} server
 * @property {McpPrompt} prompt
 * @property {{name: string, description?: string, required?: boolean}|null} argument -
 *   The one the text fills, when it fills one
 *
 * @param {McpServer} server
 * @param {McpPrompt} prompt
 * @returns {PromptCommand|null}
 */
export function promptCommand(server, prompt) {
  if (!reachable(server) || requiredArguments(prompt) > 1) return null
  const args = prompt.arguments || []
  const argument = args.find(one => one.required) || args[0] || null
  const own = String(prompt.name)
    .toLowerCase()
    .replace(/[^a-z0-9_'-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return own ? { name: `${server.prefix}:${own}`, server, prompt, argument } : null
}

/**
 * Every server prompt the writer can type, in the order the servers were
 * added.
 *
 * @returns {PromptCommand[]}
 */
export function promptCommands() {
  return servers.flatMap(server =>
    (server.prompts || []).flatMap(prompt => {
      const made = promptCommand(server, prompt)
      return made ? [made] : []
    })
  )
}

/**
 * Whether calling this tool waits for the writer: any tool of a server's that
 * does not say it only reads, unless the writer has said to always allow it,
 * or everything the server has.
 * A hint is only the server's word, but a server the writer does not trust
 * should not be connected at all.
 *
 * @param {string} exposed
 * @returns {boolean}
 */
export function needsApproval(exposed) {
  const found = serverTool(exposed)
  if (!found) return false
  const { server, tool } = found
  if (server.allowAll || tool.annotations?.readOnlyHint === true) return false
  return !(server.allowed || []).includes(tool.name)
}
