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
 * when its group is and it isn't named off, and while tools are on at all:
 * switched off as a whole (`toolsOff`), every group and tool keeps its own
 * switch, for when they are back on.
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
 * @property {string[]} [disabledTools] - Tools off, by name
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

/**
 * Whether a tool is on: tools are, its group is, and it is not off by name.
 *
 * @param {ToolChoice|null|undefined} choice
 * @param {string} name
 * @param {string|undefined} group - The tool's; undefined for one in none
 * @returns {boolean}
 */
export function toolOn(choice, name, group) {
  if (toolsSwitchedOff(choice)) return false
  if (group !== undefined && !groupOn(choice, group)) return false
  return !(choice?.disabledTools || []).includes(name)
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
 * What switching a tool writes on a choice. Its group's switch is left as it
 * is: a tool in a group that is off stays off either way.
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
