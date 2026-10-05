/**
 * @module ai/tools/registry
 * @description Tool registry for managing AI tools that can be called by the model.
 * Tools are registered with their OpenAI-format definitions and execute functions.
 */

/**
 * Tool definition in OpenAI format
 * @typedef {Object} ToolDefinition
 * @property {'function'} type - Tool type (always 'function')
 * @property {Object} function - Function definition
 * @property {string} function.name - Function name
 * @property {string} function.description - Function description
 * @property {Object} function.parameters - JSON Schema for parameters
 */

/**
 * Tool call from the model
 * @typedef {Object} ToolCall
 * @property {string} id - Unique call ID
 * @property {'function'} type - Call type (always 'function')
 * @property {Object} function - Function call details
 * @property {string} function.name - Function name
 * @property {string} function.arguments - JSON string of arguments
 */

/**
 * Tool execution result
 * @typedef {Object} ToolResult
 * @property {string} tool_call_id - The ID of the tool call this responds to
 * @property {string} content - JSON string result
 * @property {any} [result] - What the tool returned, before it was serialized.
 *   For callers that need a field out of it and should not have to parse back
 *   what was just stringified. Absent when the call never reached the tool.
 */

/**
 * Context passed to tool execution
 * @typedef {Object} ToolContext
 * @property {string} [storyId] - Current story ID
 * @property {string} [documentId] - The document the editor is showing
 * @property {string} [chatId] - Current chat ID
 * @property {boolean} [propose] - Whether a tool that would change a document
 *   proposes the change to the writer instead of making it. The chat's
 *   setting, read by whoever runs the turn.
 * @property {import('../../types/models.js').DocumentEdit[]} [edits] - Where a tool
 *   that changes a document records what it changed, for the turn to keep.
 *   Absent when nobody is keeping a record, and the tool writes anyway.
 * @property {() => import('../../types/models.js').Message[]} [conversation] -
 *   The chat's messages, for `read_document` to say a read still in view is
 *   unchanged rather than send it again. Supplied for the chat's own turn only:
 *   a skill reads the conversation as a transcript, without its calls, so a
 *   read above is not in front of it.
 * @property {() => string[]} [loadedSkills] - The skills this chat has loaded
 *   and not dropped, for `use_skill` to say one already is rather than send it
 *   twice. Supplied by whoever is running the turn, which has the chat.
 * @property {(name: string) => string} [promptFor] - What a skill runs under in
 *   this chat: the profile's wording when it has one, and the skill's own
 *   otherwise. Supplied by whoever is running the turn, for the same reason
 *   `consult` is — a skill should not have to know which profile it is in.
 *   Absent outside a turn, and a skill falls back to its own prompt.
 * @property {(systemPrompt: string, toolNames?: string[], options?: {roles?: import('../context/build.js').TranscriptRoles, overrides?: import('../defaults.js').AISettingsOverrides, onContent?: (said: string) => void, onReasoning?: (thinking: string) => void, before?: string, past?: number, edits?: import('../../types/models.js').DocumentEdit[]}) => Promise<string>} [consult] -
 *   Run another inference over this same conversation under a different system
 *   prompt, and return what it said. Supplied by whoever is running the turn; a
 *   skill reaches its model through this rather than importing one. Absent when
 *   nothing is running a turn, which is why skills check for it. `toolNames`
 *   names the tools the skill's role needs; the caller resolves them and runs
 *   the loop. `roles` names the two voices in the conversation it is about to
 *   read, which it reads as a transcript, and `overrides` how its request is
 *   sampled. `onContent` and `onReasoning` are for a caller showing the answer
 *   and the work as they arrive.
 *   `before` and `past` say how much of the conversation it reads: the caller
 *   sets `before` when the consultation is itself a message in the chat, and a
 *   summary sets `past` to read the few turns it was put above as well. How
 *   deep the consultation runs is not the skill's to say: the loop counts that.
 *   `edits` is the turn's record of what its tools changed, handed on so a
 *   skill's writes are recorded with the turn's.
 * @property {AbortSignal} [signal] - Aborted when the call is stopped: its
 *   time is up, or the turn it is part of was stopped. A tool with something
 *   slow to wait on — a request, a server — hands it on; one that doesn't is
 *   given up on all the same, and whatever it does after goes unread. A
 *   skill's `consult` carries it already.
 */

/**
 * Registered tool
 * @typedef {Object} RegisteredTool
 * @property {ToolDefinition} definition - OpenAI-format tool definition
 * @property {(args: Object, context?: ToolContext) => Promise<Object>} execute - Execute function
 * @property {string} group - Group id this tool belongs to
 * @property {number} [timeoutMs] - How long this tool may take, when the caller's
 *   default is wrong for it. A skill runs an inference, not a lookup.
 */

/**
 * A group of related tools, toggled together in the UI.
 * @typedef {Object} ToolGroup
 * @property {string} id - Stable id, stored on chats that disable the group
 * @property {string} label - Display name
 * @property {ToolDefinition[]} definitions - Members, in registration order
 */

/**
 * Tool registry for managing AI tools
 */
class ToolRegistry {
  constructor() {
    /** @type {Map<string, RegisteredTool>} */
    this.tools = new Map()
  }

  /**
   * Register a tool
   * @param {string} name - Tool name
   * @param {ToolDefinition} definition - OpenAI-format tool definition
   * @param {(args: Object, context?: ToolContext) => Promise<Object>} execute - Execute function
   * @param {string} group - Group id (see TOOL_GROUP_LABELS in ./index.js)
   * @param {number} [timeoutMs] - Override the caller's default time limit
   */
  register(name, definition, execute, group, timeoutMs) {
    this.tools.set(name, { definition, execute, group, timeoutMs })
  }

  /**
   * Take a tool away. For the ones that come and go while the app runs: the
   * writer's own skills, as their library changes.
   *
   * @param {string} name - Tool name
   * @returns {boolean} Whether there was one to take away
   */
  unregister(name) {
    return this.tools.delete(name)
  }

  /**
   * Whether a tool is registered under this name.
   * @param {string} name - Tool name
   * @returns {boolean}
   */
  has(name) {
    return this.tools.has(name)
  }

  /**
   * How long this tool may take, if it has said.
   * @param {string} name - Tool name
   * @returns {number|undefined} Milliseconds, or undefined to use the caller's default
   */
  timeoutFor(name) {
    return this.tools.get(name)?.timeoutMs
  }

  /**
   * The group a tool was registered in.
   * @param {string} name - Tool name
   * @returns {string|undefined} The group id, or undefined if nothing is registered under that name
   */
  groupOf(name) {
    return this.tools.get(name)?.group
  }

  /**
   * Get all tool definitions for API requests
   * @returns {ToolDefinition[]} Array of tool definitions
   */
  getDefinitions() {
    return Array.from(this.tools.values()).map(tool => tool.definition)
  }

  /**
   * Tool definitions minus anything the caller has switched off.
   *
   * Both lists name what is *withheld* rather than what is allowed, so a tool
   * registered later reaches existing chats instead of going silently missing.
   * A disabled group withholds its members even if they were never named
   * individually — which is the point of the group.
   *
   * @param {{disabledTools?: string[], disabledGroups?: string[]}} [selection]
   * @returns {ToolDefinition[]}
   */
  getEnabledDefinitions(selection = {}) {
    const tools = new Set(selection.disabledTools || [])
    const groups = new Set(selection.disabledGroups || [])
    return Array.from(this.tools.entries())
      .filter(([name, tool]) => !tools.has(name) && !groups.has(tool.group))
      .map(([, tool]) => tool.definition)
  }

  /**
   * Definitions for a named set of tools.
   *
   * For a caller that wants particular tools rather than everything on offer —
   * a skill, which asks for the few its role needs by name. Nothing is
   * withheld here: what a skill may reach for is the skill's own business, and
   * the selection a chat carries is about the assistant the writer is talking
   * to.
   *
   * A name that matches nothing is dropped rather than raised, so a skill
   * naming a tool that has since been renamed loses that tool instead of
   * failing the turn that called it.
   *
   * @param {string[]} names - Tool names, in the order they should be offered
   * @returns {ToolDefinition[]}
   */
  getDefinitionsFor(names) {
    return (names || [])
      .map(name => this.tools.get(name))
      .filter(tool => Boolean(tool))
      .map(tool => tool.definition)
  }

  /**
   * Registered tools by group, for building a grouped UI.
   * @param {Record<string, string>} labels - group id to display name
   * @returns {ToolGroup[]} Groups in the order their labels are declared
   */
  getGroups(labels) {
    return Object.entries(labels)
      .map(([id, label]) => ({
        id,
        label,
        definitions: Array.from(this.tools.values())
          .filter(tool => tool.group === id)
          .map(tool => tool.definition),
      }))
      .filter(group => group.definitions.length > 0)
  }

  /**
   * Execute a tool call
   * @param {ToolCall} toolCall - The tool call to execute
   * @param {ToolContext} [context] - Execution context
   * @returns {Promise<ToolResult>} Tool result
   */
  async execute(toolCall, context = {}) {
    const name = toolCall.function.name
    const tool = this.tools.get(name)

    if (!tool) {
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: `Unknown tool: ${name}` }),
      }
    }

    try {
      const args = JSON.parse(toolCall.function.arguments)
      const result = await tool.execute(args, context)
      return {
        tool_call_id: toolCall.id,
        // Text is sent as it is: a server's tool answers in prose, which
        // quoted as a JSON string would reach the model as one long line.
        content: typeof result === 'string' ? result : JSON.stringify(result),
        result,
      }
    } catch (error) {
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: error.message }),
      }
    }
  }

  /**
   * Check if registry has any tools
   * @returns {boolean} True if tools are registered
   */
  hasTools() {
    return this.tools.size > 0
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry()
