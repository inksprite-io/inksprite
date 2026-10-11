/**
 * @module ai/profiles
 * @description What a chat is run under: its system prompt, which tools are
 * offered, and the author's note the writer starts from.
 *
 * The prompt belongs to the profile rather than to a library of its own. A
 * prompt without the tools and skills it was written for is half an answer — the
 * Roleplay prompt assumes no tools, the Adventure prompt assumes dice — and two
 * lists to keep in step is one list too many.
 *
 * A profile is a template, not a binding. `createChat` copies its settings onto
 * the chat and nothing reads the profile again — the same rule `createChat`
 * already followed for the prompt, and for the same reason: a writer who
 * changes a setting in one chat has not asked to change it in nine others, and
 * nothing on screen would tell them they had.
 *
 * These ship as source rather than data, like the prompts in `ai/prompts`, so
 * an improvement reaches chats that have not been created yet when the app
 * updates. The writer's own profiles will live in the database beside them; see
 * `.llm/character_cards_design.md`.
 *
 * Not to be confused with the AI preset (`stores/aiPresetStore.js`), which is
 * the provider and the model. A profile says how a chat is run; a preset says
 * what runs it.
 */

import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  DEFAULT_ROLEPLAY_NSFW_PROMPT,
  ROLEPLAY_COMPACTION_PROMPT,
  DEFAULT_ROLEPLAY_NOTE,
  DEFAULT_ROLEPLAY_NSFW_NOTE,
} from '@/ai/prompts/index.js'

/**
 * The settings a profile stamps onto a chat. Every field is one the chat
 * already has, so applying a profile is an object spread and nothing downstream
 * learns a new word.
 *
 * @typedef {Object} ProfileSettings
 * @property {string} prompt - The system prompt, sent ahead of the conversation
 * @property {string[]} [disabledTools]
 * @property {string[]} [disabledToolGroups]
 * @property {boolean} [projectContextEnabled]
 * @property {string} [rules] - The author's note a chat on this profile starts
 *   with: standing instructions, sent in the writer's latest message ahead of
 *   what they said. See `renderAuthorsNote` in ai/context/build.js.
 * @property {Record<string, {prompt?: string}>} [skills] - What each skill runs
 *   under in a chat on this profile, keyed by skill name. An override rather
 *   than a copy: a skill absent here reads the wording its own file has, and
 *   keeps picking up improvements to it. See `skillPrompt` in ai/skills.
 *
 * @typedef {Object} ChatProfile
 * @property {string} id - Stable identifier, prefixed so it cannot collide with a stored profile
 * @property {string} name - Display name
 * @property {string} [description] - One line, for the picker; the built-ins have one
 * @property {ProfileSettings} settings
 * @property {boolean} [nsfw] - Written for explicit content: offered, in place
 *   of its general counterpart, only once the writer switches NSFW profiles on
 *   in the settings. See composables/useProfiles.js.
 * @property {string} [generalId] - For an NSFW one, that counterpart: the same
 *   thing without the opt-ins
 */

export const CHAT_PROFILE_ID = 'builtin_profile_chat'
export const ROLEPLAY_PROFILE_ID = 'builtin_profile_roleplay'
export const ROLEPLAY_NSFW_PROFILE_ID = 'builtin_profile_roleplay_nsfw'
export const BLANK_PROFILE_ID = 'builtin_profile_blank'

/**
 * Every group of tools the app has, by the ids `TOOL_GROUP_LABELS` names
 * them — written out rather than imported: a profile is data, and
 * `ai/tools/index.js` registers every tool in the app as a side effect of
 * being loaded. A server's tools are not among them; a server reaches only the
 * profiles it lists.
 */
const ALL_TOOL_GROUPS = ['documents', 'rpg', 'skills']

/**
 * What both roleplay profiles run with besides their words.
 *
 * Cards are written for a model with no tools, and a tool schema in context
 * pulls the voice toward the assistant register it was written to get away
 * from. A starting position, not a principle — the oracle is the first one
 * worth trying again.
 *
 * And what a played-out scene is made of is the scenes and the lines, not what
 * was decided and what is left to do. See ai/skills/compact.
 */
const ROLEPLAY_SETTINGS = {
  disabledToolGroups: [...ALL_TOOL_GROUPS],
  skills: { compact: { prompt: ROLEPLAY_COMPACTION_PROMPT } },
}

/** @type {ChatProfile[]} */
export const BUILT_IN_PROFILES = [
  {
    id: CHAT_PROFILE_ID,
    name: 'Default',
    description: 'Brainstorm and revise, with the run of the project.',
    settings: { prompt: DEFAULT_CHAT_PROMPT },
  },
  {
    id: ROLEPLAY_PROFILE_ID,
    name: 'Roleplay',
    description: 'A scene with one character, in their voice. No tools.',
    settings: {
      ...ROLEPLAY_SETTINGS,
      prompt: DEFAULT_ROLEPLAY_PROMPT,
      rules: DEFAULT_ROLEPLAY_NOTE,
    },
  },
  {
    id: ROLEPLAY_NSFW_PROFILE_ID,
    name: 'Roleplay (NSFW)',
    description: 'Roleplay, with the explicit themes you opt into.',
    nsfw: true,
    generalId: ROLEPLAY_PROFILE_ID,
    settings: {
      ...ROLEPLAY_SETTINGS,
      prompt: DEFAULT_ROLEPLAY_NSFW_PROMPT,
      rules: DEFAULT_ROLEPLAY_NSFW_NOTE,
    },
  },
  {
    id: BLANK_PROFILE_ID,
    name: 'Blank',
    description: 'No system prompt, no tools, no project: the model as it comes.',
    // Nothing between the writer and the model: no system message is sent for
    // an empty prompt, no tool is offered, and the project block stays out.
    settings: {
      prompt: '',
      disabledToolGroups: [...ALL_TOOL_GROUPS],
      projectContextEnabled: false,
    },
  },
]

/**
 * Whether an ID refers to a profile that ships with the app rather than a
 * stored one.
 *
 * @param {string|null|undefined} id - Profile ID to test
 * @returns {boolean} True for built-in IDs
 */
export function isBuiltInProfileId(id) {
  return typeof id === 'string' && id.startsWith('builtin_profile_')
}

/**
 * The built-in profile with this ID, if there is one.
 *
 * @param {string|null|undefined} id - Profile ID to look up
 * @returns {ChatProfile|null} The profile, or null if the ID names none
 */
export function getBuiltInProfile(id) {
  return BUILT_IN_PROFILES.find(profile => profile.id === id) || null
}

/**
 * The profile a new chat is stamped from when nobody has chosen one.
 */
export const DEFAULT_PROFILE_ID = CHAT_PROFILE_ID

/**
 * What to stamp onto a new chat, given the profile it is being started on.
 *
 * Everything but the wording. The prompt and the skills' prompts stay on the
 * profile and are read on every turn, so a chat follows its profile's words;
 * the rest is copied and then the chat's own, which is the rule `createChat`
 * has always followed — a writer who switches a tool off in one chat has not
 * asked to switch it off in nine others.
 *
 * Takes the profile rather than its id because the writer's own live in the
 * database, and this module is the built-ins and nothing else. See
 * `composables/useProfiles.js`.
 *
 * @param {{id: string, settings?: ProfileSettings}|null|undefined} profile
 * @returns {Object} Settings to copy onto the chat
 */
export function settingsForNewChat(profile) {
  const resolved = profile || getBuiltInProfile(DEFAULT_PROFILE_ID)
  // eslint-disable-next-line no-unused-vars
  const { prompt, skills, ...rest } = resolved?.settings || {}
  return { profileId: resolved?.id ?? DEFAULT_PROFILE_ID, ...rest }
}

/**
 * The settings a profile can stamp onto a chat: `ProfileSettings` less the
 * wording, which stays on the profile.
 */
const STAMPED_SETTINGS = [
  'disabledTools',
  'disabledToolGroups',
  'projectContextEnabled',
  'rules',
  // Not a profile's setting: a chat's choice of servers, cleared so the chat
  // follows the servers that list the profile it moves to.
  'mcpServers',
  // Nor this: whether the chat searches the web, cleared so it follows the
  // profile it moves to.
  'web',
]

/**
 * What to write onto a chat being moved to a profile: the profile's settings
 * over the chat's own, with those the profile does not set taken off rather
 * than left over from the one before. Moving from Roleplay to Chat has to put
 * the tools back, and Chat names none.
 *
 * @param {{id: string, settings?: ProfileSettings}|null|undefined} profile
 * @returns {Object} Updates for the chat
 */
export function settingsForProfileSwitch(profile) {
  const cleared = Object.fromEntries(STAMPED_SETTINGS.map(key => [key, undefined]))
  return { ...cleared, ...settingsForNewChat(profile) }
}

/**
 * The author's note a chat runs with, given the profile it runs on.
 *
 * Its own, which the writer may have changed since it was stamped on. Unless
 * that is still, word for word, the note of the profile's NSFW or general
 * counterpart: the settings switch moves a chat across to the counterpart
 * without touching it, and the prompt follows because it is read every turn.
 * The note has to follow with it, or a Roleplay chat switched to NSFW runs
 * without the opt-ins, and switched back keeps them.
 *
 * @param {string|undefined} note - The chat's
 * @param {{id: string}|null|undefined} profile - The one it runs on
 * @returns {string|undefined}
 */
export function noteOnProfile(note, profile) {
  const builtIn = getBuiltInProfile(profile?.id)
  if (!builtIn || !note) return note
  const counterpart = BUILT_IN_PROFILES.find(
    other => other.id === builtIn.generalId || other.generalId === builtIn.id
  )
  return counterpart && note === counterpart.settings.rules ? builtIn.settings.rules : note
}
