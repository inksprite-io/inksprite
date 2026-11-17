/**
 * @module ai/tools/choice
 * @description Which of the model's tools a profile, or a chat, has on: one
 * rule for every group there is, the app's own (documents, RPG, skills), the
 * web, Python and each MCP server alike. See `.llm/tools_design.md`.
 *
 * A choice names what is off rather than what is on, so a group added later,
 * a server connected tomorrow or web search set up, is on wherever nothing
 * said otherwise: nobody adds a thing in order to go and switch it on. A
 * profile written to offer only some groups names those instead
 * (`onlyToolGroups`), and anything added later stays off in it: Blank, which
 * offers none, and Roleplay, which offers the documents alone. A tool is on
 * when its group is, and while tools are on at all: switched off as a whole
 * (`toolsOff`), every group keeps its own switch, for when they are back on.
 *
 * Inside a group, what a profile says is only of the documents and the
 * skills. The documents go by what the model does with them, not tool by
 * tool: it reads them, edits them, comments on them (`DOCUMENT_ROWS`), and
 * since nothing is edited or commented on unread, reading is on wherever
 * either is. A skill is on or off by its name. Every other tool is switched
 * for the whole app, where it is kept with whatever it is a tool of (the web
 * search's, a server's): see ./everywhere.js.
 *
 * A profile holds a choice, and a chat started on it a copy, which is the
 * chat's from then on (ai/profiles). A switch in a chat changes the chat and
 * its profile alike, so the next chat on it starts with what was switched
 * (`useChatSettings`). Whether a group can be offered at all, the web without
 * a service or Python outside the desktop app, is not the choice's to say;
 * see `getEnabledToolDefinitions` in ./index.js.
 */

/**
 * @typedef {Object} ToolChoice
 * @property {string[]} [disabledTools] - Tools off, by name: the documents'
 *   of a row that is off, every one of them, and the skills that are off.
 *   Any other name is from before the rest were switched for the whole app,
 *   and says nothing
 * @property {string[]} [disabledToolGroups] - Groups off, by id
 * @property {string[]} [onlyToolGroups] - The groups that may be on at all,
 *   for a choice that offers only some. Absent means every group.
 * @property {true} [toolsOff] - Every tool off, whatever each is switched to
 */

/**
 * @param {string[]|undefined} list
 * @param {string} item
 * @param {boolean} present
 * @returns {string[]}
 */
const toggled = (list, item, present) => {
  const others = (list || []).filter(one => one !== item)
  return present ? [...others, item] : others
}

/**
 * Whether every tool is off, whatever each is switched to.
 *
 * @param {ToolChoice|null|undefined} choice
 * @returns {boolean}
 */
export function toolsSwitchedOff(choice) {
  return choice?.toolsOff === true
}

/**
 * Whether a group is switched on: its own switch, which tools switched off
 * as a whole leave as it is.
 *
 * @param {ToolChoice|null|undefined} choice
 * @param {string} group
 * @returns {boolean}
 */
export function groupOn(choice, group) {
  const only = choice?.onlyToolGroups
  if (Array.isArray(only) && !only.includes(group)) return false
  return !(choice?.disabledToolGroups || []).includes(group)
}

/** The documents' group, whose tools go by row. */
export const DOCUMENTS_GROUP = 'documents'

/** The skills' group, each switched by its name. */
export const SKILLS_GROUP = 'skills'

/**
 * What the model does with the documents, and the tools that are each: the
 * rows a profile switches. Reading is first, since the others need it.
 *
 * @type {ReadonlyArray<{id: 'read'|'edit'|'comment', label: string, tools: readonly string[]}>}
 */
export const DOCUMENT_ROWS = [
  {
    id: 'read',
    label: 'Read',
    tools: [
      'list_documents',
      'read_document',
      'describe_document',
      'search_documents',
      'explore_documents',
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    tools: [
      'create_document',
      'create_folder',
      'update_document',
      'edit_document',
      'append_document',
      'move_document',
      'delete_document',
    ],
  },
  {
    id: 'comment',
    label: 'Comment',
    tools: ['list_comments', 'add_comment', 'reply_comment', 'resolve_comment'],
  },
]

/** The row a document tool is in. @param {string} name */
const rowOf = name => DOCUMENT_ROWS.find(row => row.tools.includes(name))

/**
 * Whether a row of the documents is switched on: its own switch, whatever
 * its group's. Off only when every tool in it is named off, so a choice from
 * before, with one of them off, has the row on and that tool back. Editing
 * and commenting are off wherever reading is.
 *
 * @param {ToolChoice|null|undefined} choice
 * @param {'read'|'edit'|'comment'} id
 * @returns {boolean}
 */
export function rowOn(choice, id) {
  const off = choice?.disabledTools || []
  /** @param {string} one */
  const named = one =>
    !DOCUMENT_ROWS.find(row => row.id === one)?.tools.every(name => off.includes(name))
  return named(id) && (id === 'read' || named('read'))
}

/**
 * What switching a row of the documents writes on a choice. Editing and
 * commenting switch reading on with them, and reading switched off takes
 * them with it.
 *
 * @param {ToolChoice|null|undefined} choice
 * @param {'read'|'edit'|'comment'} id
 * @param {boolean} on
 * @returns {ToolChoice}
 */
export function switchRow(choice, id, on) {
  const switched =
    id === 'read' ? (on ? ['read'] : ['read', 'edit', 'comment']) : on ? [id, 'read'] : [id]
  const names = DOCUMENT_ROWS.filter(row => switched.includes(row.id)).flatMap(row => row.tools)
  const others = (choice?.disabledTools || []).filter(name => !names.includes(name))
  return { disabledTools: on ? others : [...others, ...names] }
}

/**
 * Whether a tool is on in a choice: tools are, its group is, and for a
 * document its row, for a skill its own name. Any other is on wherever its
 * group is: it is switched for the whole app (./everywhere.js).
 *
 * @param {ToolChoice|null|undefined} choice
 * @param {string} name
 * @param {string|undefined} group - The tool's; undefined for one in none
 * @returns {boolean}
 */
export function toolOn(choice, name, group) {
  if (toolsSwitchedOff(choice)) return false
  if (group !== undefined && !groupOn(choice, group)) return false
  if (group === DOCUMENTS_GROUP) {
    const row = rowOf(name)
    return !row || rowOn(choice, row.id)
  }
  if (group === SKILLS_GROUP) return !(choice?.disabledTools || []).includes(name)
  return true
}

/**
 * What switching groups writes on a choice. Their tools' own switches are
 * left as they were, so they come back as they were with them.
 *
 * @param {ToolChoice|null|undefined} choice
 * @param {string[]} groups
 * @param {boolean} on
 * @returns {ToolChoice}
 */
export function switchGroups(choice, groups, on) {
  let disabled = choice?.disabledToolGroups || []
  let only = choice?.onlyToolGroups
  for (const group of groups) {
    disabled = toggled(disabled, group, !on)
    if (Array.isArray(only)) only = toggled(only, group, on)
  }
  return Array.isArray(only)
    ? { disabledToolGroups: disabled, onlyToolGroups: only }
    : { disabledToolGroups: disabled }
}

/**
 * What switching a skill writes on a choice. Its group's switch is left as
 * it is: a skill in a group that is off stays off either way.
 *
 * @param {ToolChoice|null|undefined} choice
 * @param {string} name
 * @param {boolean} on
 * @returns {ToolChoice}
 */
export function switchTool(choice, name, on) {
  return { disabledTools: toggled(choice?.disabledTools, name, !on) }
}

/**
 * A choice as it stands, to copy: onto a chat from its profile, or onto a
 * profile from a chat. Only what it holds, so a copy of one that offers
 * every group goes on offering every group.
 *
 * @param {ToolChoice|null|undefined} choice
 * @returns {ToolChoice}
 */
export function copyChoice(choice) {
  /** @type {ToolChoice} */
  const copy = {
    disabledTools: [...(choice?.disabledTools || [])],
    disabledToolGroups: [...(choice?.disabledToolGroups || [])],
  }
  if (Array.isArray(choice?.onlyToolGroups)) copy.onlyToolGroups = [...choice.onlyToolGroups]
  if (toolsSwitchedOff(choice)) copy.toolsOff = true
  return copy
}
