/**
 * @module ai/tools
 * @description Tool registry and exports for AI tools.
 * Tools allow the model to perform actions and get results during chat.
 *
 * ## Adding New Tools
 *
 * To add a new tool:
 * 1. Create a new file in this directory (e.g., `myTool.js`)
 * 2. Export the tool definition and execute function
 * 3. Import and register it in this file
 *
 * @example
 * // In myTool.js
 * export const myToolDefinition = {
 *   type: 'function',
 *   function: {
 *     name: 'my_tool',
 *     description: 'Does something useful',
 *     parameters: { type: 'object', properties: { ... }, required: [...] }
 *   }
 * }
 * export async function executeMyTool(args) { ... }
 *
 * // In index.js
 * import { myToolDefinition, executeMyTool } from './myTool.js'
 * toolRegistry.register('my_tool', myToolDefinition, executeMyTool)
 *
 * ## Skills
 *
 * A skill is a tool whose work is another inference — a role the model hands
 * the turn to and gets an answer back from. They live in ../skills and are
 * registered here like anything else, because to the model that is all they
 * are: a tool it calls. Every skill the model may call is registered, from the
 * registry rather than by name; see ../skills/index.js.
 *
 * A skill can have tools of its own, drawn from the ones registered here —
 * another skill among them, up to SKILL_MAX_DEPTH. It names them and
 * getToolDefinitionsFor hands back the definitions.
 *
 * A skill that joins the conversation rather than running on its own is not a
 * tool of its own. The model loads every one of those through `use_skill`
 * (./useSkill.js), which is in the skills group too, so the group's switch
 * covers it; each skill it offers keeps a switch of its own, by its name, as
 * if it were a tool.
 *
 * ## Tools from MCP servers
 *
 * Each server the writer connected is a group of its own, its tools named
 * `<prefix>__<tool>` (see ../../mcp/names.js) and registered from what the
 * server offered when it was last listed. Unlike the built-in groups, a
 * server's is opted into: a chat is offered a server's tools only when the
 * selection names the server. See ../../mcp/servers.js.
 *
 * ## The web
 *
 * `web_search` and `read_web_page` (./web.js) are a group of their own,
 * opted into the same way: offered only when the selection says the chat
 * searches, which a service set up and the chat's profile or its own choice
 * decide. See ../../web/config.js.
 */

import { toolRegistry } from './registry.js'
import { diceToolDefinition, executeDiceTool } from './dice.js'
import { generateNamesDefinition, executeGenerateNames } from './names.js'
import {
  readDocumentDefinition,
  executeReadDocument,
  describeDocumentDefinition,
  executeDescribeDocument,
  searchDocumentsDefinition,
  executeSearchDocuments,
  createDocumentDefinition,
  executeCreateDocument,
  createFolderDefinition,
  executeCreateFolder,
  updateDocumentDefinition,
  executeUpdateDocument,
  editDocumentDefinition,
  executeEditDocument,
  listDocumentsDefinition,
  executeListDocuments,
  listCommentsDefinition,
  executeListComments,
  resolveCommentDefinition,
  executeResolveComment,
  appendDocumentDefinition,
  executeAppendDocument,
} from './documents.js'
import {
  BUILT_IN_SKILLS,
  SKILL_MAX_ROUNDS,
  SKILL_MAX_DEPTH,
  getSkill,
  librarySkills,
  onSkillsChanged,
  toolDefinitionFor,
} from '../skills/index.js'
import {
  oracleDefinition,
  executeOracle,
  rollTableDefinition,
  executeRollTable,
  drawTarotDefinition,
  executeDrawTarot,
} from './rpg.js'
import { USE_SKILL, executeUseSkill, loadableSkills, useSkillDefinition } from './useSkill.js'
import { allServers, getServer, onServersChanged, reachable } from '../../mcp/servers.js'
import { serverGroup, serverOfGroup } from '../../mcp/names.js'
import { callServerTool, describeFailure, resultForModel } from '../../mcp/client.js'
import {
  WEB_GROUP,
  WEB_TIMEOUT_MS,
  executeReadWebPage,
  executeWebSearch,
  readWebPageDefinition,
  webSearchDefinition,
} from './web.js'

/**
 * The group skills are registered in.
 *
 * Named, because it is the one group that gets treated differently: a skill
 * never goes into another skill's tool set. See getToolDefinitionsFor.
 */
export const SKILLS_GROUP = 'skills'

/**
 * Tool groups, in display order. The keys are stored on chats that switch a
 * group off, so renaming one orphans that setting — change the label, not the
 * key.
 *
 * @type {Record<string, string>}
 */
export const TOOL_GROUP_LABELS = {
  documents: 'Documents',
  rpg: 'RPG Tools',
  [SKILLS_GROUP]: 'Skills',
  [WEB_GROUP]: 'Web',
}

/**
 * How long a skill may take. It runs whole inferences rather than a lookup, and
 * with tools of its own it runs up to SKILL_MAX_ROUNDS of them, so the limit
 * that suits a document read would cut off every call on a slow model.
 */
const SKILL_TIMEOUT_MS = SKILL_MAX_ROUNDS * 60000

// Register tools. Nothing about the story reaches the model except through
// these, so switching the group off is also how a prompt gets tested with no
// project behind it.
toolRegistry.register('read_document', readDocumentDefinition, executeReadDocument, 'documents')
toolRegistry.register(
  'describe_document',
  describeDocumentDefinition,
  executeDescribeDocument,
  'documents'
)
toolRegistry.register('list_documents', listDocumentsDefinition, executeListDocuments, 'documents')
toolRegistry.register(
  'search_documents',
  searchDocumentsDefinition,
  executeSearchDocuments,
  'documents'
)
toolRegistry.register(
  'create_document',
  createDocumentDefinition,
  executeCreateDocument,
  'documents'
)
toolRegistry.register('create_folder', createFolderDefinition, executeCreateFolder, 'documents')
toolRegistry.register(
  'update_document',
  updateDocumentDefinition,
  executeUpdateDocument,
  'documents'
)
toolRegistry.register('edit_document', editDocumentDefinition, executeEditDocument, 'documents')
toolRegistry.register(
  'append_document',
  appendDocumentDefinition,
  executeAppendDocument,
  'documents'
)
toolRegistry.register('list_comments', listCommentsDefinition, executeListComments, 'documents')
toolRegistry.register(
  'resolve_comment',
  resolveCommentDefinition,
  executeResolveComment,
  'documents'
)

toolRegistry.register('roll_dice', diceToolDefinition, executeDiceTool, 'rpg')
toolRegistry.register('oracle', oracleDefinition, executeOracle, 'rpg')
toolRegistry.register('roll_table', rollTableDefinition, executeRollTable, 'rpg')
toolRegistry.register('draw_tarot', drawTarotDefinition, executeDrawTarot, 'rpg')
toolRegistry.register('generate_names', generateNamesDefinition, executeGenerateNames, 'rpg')

// Opted into rather than withheld, as a server's tools are: a search sends
// words out of the app, so no chat searches that was not asked to. See
// getEnabledToolDefinitions and web/config.js.
toolRegistry.register(
  'web_search',
  webSearchDefinition,
  executeWebSearch,
  WEB_GROUP,
  WEB_TIMEOUT_MS
)
toolRegistry.register(
  'read_web_page',
  readWebPageDefinition,
  executeReadWebPage,
  WEB_GROUP,
  WEB_TIMEOUT_MS
)

// Every built-in skill the model may call, as the tool its SKILL.md describes.
// `interpret` draws a card of its own out of sight and returns what it made
// of it, for a Game Master that wants an idea rather than a card to read;
// `draw_tarot`, above, is for one that wants the cards. See
// ../skills/interpret.
for (const skill of BUILT_IN_SKILLS) {
  if (!skill.model || !skill.execute) continue
  toolRegistry.register(
    skill.name,
    toolDefinitionFor(skill),
    skill.execute,
    SKILLS_GROUP,
    SKILL_TIMEOUT_MS
  )
}

/** The tools the writer's own skills are registered under, as last made. */
let libraryTools = /** @type {string[]} */ ([])

/**
 * Register the writer's own skills the model may call, in place of whatever
 * was registered for them before: their library changes while the app runs.
 * One that would take a name another tool already answers to is left out
 * rather than allowed to replace it.
 *
 * And `use_skill`, when there is a skill to load with it, listing them all.
 */
function registerLibraryTools() {
  for (const name of libraryTools) toolRegistry.unregister(name)
  libraryTools = []
  toolRegistry.unregister(USE_SKILL)

  const loadable = loadableSkills()
  if (loadable.length > 0) {
    toolRegistry.register(USE_SKILL, useSkillDefinition(loadable), executeUseSkill, SKILLS_GROUP)
  }

  for (const skill of librarySkills()) {
    if (!skill.execute || toolRegistry.has(skill.name)) continue
    toolRegistry.register(
      skill.name,
      toolDefinitionFor(skill),
      skill.execute,
      SKILLS_GROUP,
      SKILL_TIMEOUT_MS
    )
    libraryTools.push(skill.name)
  }
}

registerLibraryTools()
onSkillsChanged(registerLibraryTools)

/**
 * How long a server's tool may take. It is someone else's service, doing who
 * knows what — a search, a page fetched and summarised — and the limit that
 * suits a document read would cut most of them off.
 */
const SERVER_TOOL_TIMEOUT_MS = 120000

/** The tools the servers are registered under, as last made. */
let serverTools = /** @type {string[]} */ ([])

/**
 * A server's tool as the model is told of it: the description the server
 * gave, which is what the writer was shown when they added it, and its input
 * schema as the parameters.
 *
 * @param {import('../../types/models.js').McpTool} tool
 * @returns {import('./registry.js').ToolDefinition}
 */
function serverToolDefinition(tool) {
  // A `$schema` line says which draft the schema was written to, and some
  // providers refuse a key they do not know.
  // eslint-disable-next-line no-unused-vars
  const { $schema, ...schema } = /** @type {Record<string, any>} */ (tool.inputSchema || {})
  return {
    type: /** @type {const} */ ('function'),
    function: {
      name: tool.exposed,
      description: tool.description || tool.title || '',
      parameters: { type: 'object', properties: {}, ...schema },
    },
  }
}

/**
 * Run a server's tool: its answer as the model reads it, or what went wrong,
 * said the way the writer would be told.
 *
 * @param {string} serverId
 * @param {string} name - The server's name for the tool
 * @param {Record<string, any>} args
 * @param {AbortSignal} [signal] - The call's, which the server is told of
 * @returns {Promise<string|{error: string}>}
 */
async function runServerTool(serverId, name, args, signal) {
  const server = getServer(serverId)
  if (!server) return { error: 'That server is no longer connected.' }
  try {
    // Waited for as long as the chat waits, not the SDK's minute.
    const options = { signal, timeout: SERVER_TOOL_TIMEOUT_MS }
    return resultForModel(await callServerTool(server, name, args, options))
  } catch (error) {
    return { error: describeFailure(error) }
  }
}

/**
 * Register every connected server's tools, in place of whatever was
 * registered for them before. A tool whose name another tool already answers
 * to is left out rather than allowed to replace it.
 */
function registerServerTools() {
  for (const name of serverTools) toolRegistry.unregister(name)
  serverTools = []

  for (const server of allServers()) {
    if (!reachable(server)) continue
    for (const tool of server.tools || []) {
      if (toolRegistry.has(tool.exposed)) continue
      toolRegistry.register(
        tool.exposed,
        serverToolDefinition(tool),
        (args, context) => runServerTool(server.id, tool.name, args, context?.signal),
        serverGroup(server.id),
        SERVER_TOOL_TIMEOUT_MS
      )
      serverTools.push(tool.exposed)
    }
  }
}

registerServerTools()
onServersChanged(registerServerTools)

/**
 * The group whose calls went back with the conversation before every call
 * did. A turn written then still sends these, and only these; one written
 * since sends every call it made. See ai/context/build.js.
 */
const KEPT_GROUP = 'documents'

/**
 * Whether a call to this tool goes back from a turn written while only the
 * document calls did, until a summary stands in for it.
 * @param {string} name - Tool name
 * @returns {boolean}
 */
export function keptInConversation(name) {
  return toolRegistry.groupOf(name) === KEPT_GROUP
}

/**
 * The time limit a tool has asked for, if it has asked for one.
 * @param {string} name - Tool name
 * @returns {number|undefined} Milliseconds, or undefined to use the caller's default
 */
export function getToolTimeout(name) {
  return toolRegistry.timeoutFor(name)
}

/**
 * Get tool definitions for API requests
 * @returns {import('./registry.js').ToolDefinition[]} Array of tool definitions
 */
export function getToolDefinitions() {
  return toolRegistry.getDefinitions()
}

/**
 * Tool definitions minus whatever a chat has switched off, by tool or by group.
 *
 * A skill the model loads is switched off by its name, like any tool, and
 * that takes it out of `use_skill`'s list; with none left, `use_skill` goes.
 *
 * A server's tools are offered only when `servers` names the server, and then
 * less any the chat switched off by name. The web tools are the same: offered
 * only when `web` says the chat searches (web/config.js `webForChat`).
 *
 * @param {{disabledTools?: string[], disabledGroups?: string[], servers?: string[], web?: boolean}} [selection]
 * @returns {import('./registry.js').ToolDefinition[]}
 */
export function getEnabledToolDefinitions(selection) {
  const off = new Set(selection?.disabledTools || [])
  const servers = new Set(selection?.servers || [])
  return toolRegistry.getEnabledDefinitions(selection).flatMap(definition => {
    const name = definition.function.name
    const group = toolRegistry.groupOf(name)
    if (group === WEB_GROUP) return selection?.web ? [definition] : []
    const server = serverOfGroup(group)
    if (server !== null) return servers.has(server) ? [definition] : []
    if (name !== USE_SKILL) return [definition]
    const offered = loadableSkills().filter(skill => !off.has(skill.name))
    return offered.length > 0 ? [useSkillDefinition(offered)] : []
  })
}

/**
 * Definitions for a named set of tools — what a skill gets to work with.
 *
 * A skill's tools belong to its role, the way its prompt does, so this takes
 * the names as given. The chat's own selection is deliberately not consulted:
 * those switches say what the assistant the writer is talking to may do, and
 * the Director is not that assistant. Reading them here would mean switching
 * off RPG Tools quietly put the Director back to guessing at the outcomes
 * its advice turns on, with nothing to say it had.
 *
 * Skills are the exception, and only because of how deep they already are.
 * Every skill runs inside the turn that called it, sharing its budget and its
 * clock, so a skill reaching a skill is a nesting a model would be choosing the
 * depth of. SKILL_MAX_DEPTH is where that stops: at the last permitted depth
 * the skills are dropped from the names and everything else is offered as
 * asked. A role naming a skill it cannot have loses that one tool, not its
 * turn.
 *
 * @param {string[]} names - Tool names the skill's role needs
 * @param {number} [depth] - How many skills deep the caller already is. The
 *   turn itself is 0, so a skill's own tools resolve at 1 by default.
 * @returns {import('./registry.js').ToolDefinition[]}
 */
export function getToolDefinitionsFor(names, depth = 1) {
  const asked = names || []
  const allowed = depth < SKILL_MAX_DEPTH ? asked : asked.filter(name => !isSkill(name))
  return toolRegistry.getDefinitionsFor(allowed)
}

/**
 * Whether this name belongs to a skill — a tool whose work is another
 * inference, rather than a lookup or a roll.
 *
 * getToolDefinitionsFor asks, because a skill is the one kind of tool whose
 * cost is another turn of the loop it is already inside. See SKILL_MAX_DEPTH.
 * `use_skill` is in the skills group and is not one: it hands back text, and
 * runs nothing.
 *
 * @param {string} name - Tool name
 * @returns {boolean}
 */
export function isSkill(name) {
  return name !== USE_SKILL && toolRegistry.groupOf(name) === SKILLS_GROUP
}

/**
 * Whether calling this tool hands the turn's reply to it: a skill whose answer
 * is the reply. The turn runs it, puts what it writes in front of the writer
 * as the answer, and ends there — the model that called it does not get the
 * text back to rewrite. See runCompletionLoop in composables/useAIChat.js.
 *
 * @param {string} name - Tool name
 * @returns {boolean}
 */
export function handsOverReply(name) {
  return isSkill(name) && getSkill(name)?.output === 'reply'
}

/**
 * Registered tools arranged into groups, for the settings UI.
 * @returns {import('./registry.js').ToolGroup[]}
 */
export function getToolGroups() {
  return toolRegistry.getGroups(TOOL_GROUP_LABELS)
}

/**
 * Whether the model has a tool by this name: for keeping a skill of the
 * writer's from taking one.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function hasTool(name) {
  return toolRegistry.has(name)
}

/**
 * Execute a tool call
 * @param {import('./registry.js').ToolCall} toolCall - The tool call to execute
 * @param {import('./registry.js').ToolContext} [context] - Execution context
 * @returns {Promise<import('./registry.js').ToolResult>} Tool result
 */
export async function executeTool(toolCall, context) {
  return toolRegistry.execute(toolCall, context)
}

/**
 * Check if any tools are available
 * @returns {boolean} True if tools are registered
 */
export function hasTools() {
  return toolRegistry.hasTools()
}

export { toolRegistry }
