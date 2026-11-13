/**
 * @module ai/profiles
 * @description What a chat is run under: its system prompt, which tools are
 * offered, and the author's note the writer starts from.
 *
 * The prompt belongs to the profile rather than to a library of its own. A
 * prompt without the tools and skills it was written for is half an answer — the
 * Roleplay prompt asks for none, the Adventure prompt assumes dice — and two
 * lists to keep in step is one list too many.
 *
 * A profile is a template, not a binding. `createChat` copies its settings onto
 * the chat and nothing reads the profile again — the same rule `createChat`
 * already followed for the prompt, and for the same reason: a writer who
 * changes a setting in one chat has not asked to change it in nine others, and
 * nothing on screen would tell them they had.
 *
 * The prompt is the exception in one direction only. It is read from the
 * profile every turn, so a chat keeps up with its profile's words, until the
 * writer changes it in the chat: then the chat keeps its own (`Chat.prompt`).
 * The Save beside it, and beside the author's note, in the chat's settings,
 * is how a change of those reaches the profile.
 *
 * A skill's wording is the profile's: reworded in Settings › Skills, it is
 * changed on the profile the chat showing runs on, and every chat on it reads
 * it. A chat given wording of its own before that (`Chat.skills`) keeps it
 * until the skill is changed on its profile from it.
 *
 * The model and the tools are the exception the other way. A chat keeps the
 * model it was started on, how hard the model thinks, whether its edits wait
 * and which tools it has, and only the writer changes them; a change in a
 * chat also goes to the profile, so the next chat on it starts there
 * (`useChatSettings`). A chat already going never changes because another
 * one did. See `.llm/ai_setup_design.md` and `.llm/tools_design.md`.
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
import { KEPT_OPENING } from '@/ai/compaction.js'

/**
 * The settings a profile stamps onto a chat. Every field is one the chat
 * already has, so applying a profile is an object spread and nothing downstream
 * learns a new word.
 *
 * @typedef {Object} ProfileSettings
 * @property {string} prompt - The system prompt, sent ahead of the conversation
 * @property {string[]} [disabledTools] - Its chats' tools off, by name. See
 *   ai/tools/choice.js, with the two below.
 * @property {string[]} [disabledToolGroups] - Its chats' groups of tools off
 * @property {true} [toolsOff] - Its chats' tools off as a whole, each switch
 *   kept as it is
 * @property {string[]} [onlyToolGroups] - The groups its chats may have on at
 *   all, for one that offers only some: anything added later stays off.
 *   Absent means every group.
 * @property {string} [rules] - The author's note a chat on this profile starts
 *   with: standing instructions, sent in the writer's latest message ahead of
 *   what they said. See `renderAuthorsNote` in ai/context/build.js.
 * @property {Record<string, {prompt?: string}>} [skills] - What each skill runs
 *   under in a chat on this profile, keyed by skill name. An override rather
 *   than a copy: a skill absent here reads the wording its own file has, and
 *   keeps picking up improvements to it. See `skillPrompt` in ai/skills.
 * @property {number} [keptOpening] - How many messages at the top of a chat on
 *   it a summary leaves standing. Absent means one. Not the writer's to set,
 *   and read from the profile, never copied onto a chat. See ai/compaction.js.
 * @property {string} [presetId] - Legacy: the preset its chats started on,
 *   before a model's settings were found by the model. Read once, to give the
 *   profile that model (composables/useChatPresets.js), and never written.
 * @property {string} [providerId] - The connection a chat on this profile
 *   starts on, with `model`: the last picked in a chat on it. Absent on one
 *   never picked on, whose chats start on what new chats start on.
 * @property {string} [model] - The model a chat on this profile starts on.
 * @property {string|null} [reasoningEffort] - How hard the model thinks in a
 *   chat started on it, as last picked in one. Absent means the app's.
 * @property {'auto'|'ask'} [applyEdits] - Whether a chat started on it has its
 *   edits wait for the writer, as last picked in one. Absent means the app's
 *   choice from before chats had their own.
 *
 * @typedef {Object} ChatProfile
 * @property {string} id - Stable identifier, prefixed so it cannot collide with a stored profile
 * @property {string} name - Display name
 * @property {ProfileSettings} settings
 * @property {boolean} [nsfw] - Written for explicit content: offered, in place
 *   of its general counterpart, only once the writer switches NSFW profiles on
 *   in the settings. See composables/useProfiles.js.
 * @property {boolean} [roleplay] - Part of the Roleplay extension: offered only
 *   while it is on. A chat already on one runs on it either way. See extensions/.
 * @property {string} [generalId] - For an NSFW one, that counterpart: the same
 *   thing without the opt-ins
 */

export const CHAT_PROFILE_ID = 'builtin_profile_chat'
export const ROLEPLAY_PROFILE_ID = 'builtin_profile_roleplay'
export const ROLEPLAY_NSFW_PROFILE_ID = 'builtin_profile_roleplay_nsfw'
export const BLANK_PROFILE_ID = 'builtin_profile_blank'

/**
 * What both roleplay profiles run with besides their words.
 *
 * The documents, which the prompt has the model read once, up front: the
 * writer's persona, whatever of a lorebook bears on the story, and the card
 * where its chat did not open with it attached (composables/useCardChat.js).
 * A read stays where it was made in the conversation, under the cache; and a
 * world's worth of entries is more than a turn can carry, so a lorebook is
 * pulled from, not pushed.
 *
 * Nothing else, the web, Python and the writer's servers included, and
 * whatever comes after them: a tool schema in context pulls the voice toward
 * the assistant register a card was written to get away from, so the dice
 * and the skills are the writer's to switch on. The groups are named by the
 * ids `TOOL_GROUP_LABELS` gives them, written out rather than imported: a
 * profile is data, and `ai/tools/index.js` registers every tool in the app as
 * a side effect of being loaded.
 *
 * The groups it had off before it offered only some stay off, for an app
 * from before that reads them alone.
 *
 * And what a played-out scene is made of is the scenes and the lines, not what
 * was decided and what is left to do. See ai/skills/compact.
 *
 * A summary leaves the first two messages standing, which is how a scene
 * opens however it was started. See `KEPT_OPENING` in ai/compaction.js.
 */
const ROLEPLAY_SETTINGS = {
  onlyToolGroups: ['documents'],
  disabledToolGroups: ['rpg', 'skills', 'experimental'],
  skills: { compact: { prompt: ROLEPLAY_COMPACTION_PROMPT } },
  keptOpening: 2,
}

/** @type {ChatProfile[]} */
export const BUILT_IN_PROFILES = [
  {
    id: CHAT_PROFILE_ID,
    name: 'Default',
    settings: { prompt: DEFAULT_CHAT_PROMPT },
  },
  {
    id: ROLEPLAY_PROFILE_ID,
    name: 'Roleplay',
    roleplay: true,
    settings: {
      ...ROLEPLAY_SETTINGS,
      prompt: DEFAULT_ROLEPLAY_PROMPT,
      rules: DEFAULT_ROLEPLAY_NOTE,
    },
  },
  {
    id: ROLEPLAY_NSFW_PROFILE_ID,
    name: 'Roleplay (NSFW)',
    roleplay: true,
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
    // Nothing between the writer and the model: no system message is sent for
    // an empty prompt, no tool is offered, whatever is added later, and with
    // no document tools the project block stays out. The groups it had off
    // before stay off, for an app from before that reads them alone.
    settings: {
      prompt: '',
      onlyToolGroups: [],
      disabledToolGroups: ['documents', 'rpg', 'skills', 'experimental'],
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
 * Everything but the wording, which stays on the profile and is read on
 * every turn, so a chat follows its profile's words. The rest is copied and
 * then the chat's own, the model with it: a writer who switches a tool off,
 * or the model, in one chat has not asked to do it in nine others.
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
  // A legacy preset id goes no further: a chat names its model.
  // eslint-disable-next-line no-unused-vars
  const { prompt, skills, presetId, keptOpening, ...rest } = resolved?.settings || {}
  return { profileId: resolved?.id ?? DEFAULT_PROFILE_ID, ...rest }
}

/**
 * How many messages at the top of a chat on this profile a summary leaves
 * standing.
 *
 * @param {{settings?: ProfileSettings}|null|undefined} profile
 * @returns {number}
 */
export function keptOpeningOf(profile) {
  const kept = profile?.settings?.keptOpening
  return typeof kept === 'number' && kept >= KEPT_OPENING ? kept : KEPT_OPENING
}

/**
 * The settings a profile can stamp onto a chat: `ProfileSettings`, the
 * wording among them, which a chat moved to another profile reads from it.
 */
const STAMPED_SETTINGS = [
  // The chat's own wording, cleared so it reads the profile it moves to.
  'prompt',
  'skills',
  // The model it runs on, how hard it thinks and whether edits wait: the new
  // profile's, as a chat started on it would have them.
  'providerId',
  'model',
  'reasoningEffort',
  'applyEdits',
  'disabledTools',
  'disabledToolGroups',
  'onlyToolGroups',
  'toolsOff',
  'rules',
  // Legacy: a chat's choice of servers, the web and Python, from before its
  // tools said. Cleared, as nothing reads them now.
  'mcpServers',
  'web',
  'python',
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
