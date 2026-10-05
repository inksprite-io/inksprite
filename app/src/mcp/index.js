/**
 * @module mcp
 * @description Tools from MCP servers: connecting to them, and offering what
 * they have to the model.
 *
 * The Model Context Protocol is how other apps let a model reach outside
 * itself — a wiki, a tracker, a search. InkSprite connects to a server from
 * the page, with no backend in between, so only remote servers that let a web
 * page connect can be used; a local one needs a bridge that serves it over
 * HTTP. See `.llm/skills_design.md`, part 6.
 *
 * ## Files
 *
 * - `client.js` - The connection: the SDK loaded on first use, one connection
 *   per server, listing and calling, and what a failure means
 * - `auth.js` - Signing in to a server that wants it: OAuth with PKCE, in a
 *   tab of its own, back to `/connect/mcp`, kept in this browser and never in
 *   a backup
 * - `servers.js` - The connected servers as the rest of the app reads them,
 *   which chats use which, and which calls wait for the writer
 * - `names.js` - What a server's tools are called to the model
 * - `config.js` - Servers from a pasted `mcpServers` block
 * - `saved.js` - A server's answer kept in the project as a document: its
 *   title, and a line saying where it came from
 *
 * The servers are kept in `stores/mcpServerStore.js`, registered as tools in
 * `ai/tools/index.js`, one group per server, and run by the chat like any
 * other tool — except that a tool that does not say it only reads waits for
 * the writer to allow it, and while any server's tools are offered, the
 * document tools propose their changes rather than make them. A tool's answer
 * is text from a stranger, arriving in the same context as `edit_document`.
 *
 * A server's prompts are the writer's: each that takes at most one argument
 * is a command in the `/` menu, `/<prefix>:<prompt>`, whose text the server
 * writes when it is asked and which goes into the writer's turn the way a
 * saved prompt's does (`promptCommands` here, the commands in ai/commands.js).
 *
 * @example
 * import { listServer } from '@/mcp/client.js'
 * const { tools } = await listServer({ url: 'https://mcp.deepwiki.com/mcp' })
 */

export {
  SERVER_GROUP_PREFIX,
  serverGroup,
  serverOfGroup,
  serverPrefix,
  exposedNames,
} from './names.js'
export { parseServerConfig, nameFromUrl } from './config.js'
export {
  setServers,
  onServersChanged,
  allServers,
  getServer,
  reachable,
  serverTool,
  serversForChat,
  needsApproval,
} from './servers.js'
export {
  listServer,
  callServerTool,
  disconnect,
  describeFailure,
  resultForModel,
} from './client.js'
export { signedIn, signOut, startSignIn, finishSignIn, SignInError } from './auth.js'
