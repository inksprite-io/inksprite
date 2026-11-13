/**
 * @module composables/useToolChoices
 * @description Gives every profile and chat, once, the web, Python and MCP
 * servers as their own tools' switches (ai/tools/choice.js), from the lists
 * that said before: web search's profiles, Python's, and each server's, and
 * a chat's own choice of each where it made one. See `.llm/tools_design.md`.
 *
 * Each says what is off, as the rest of a choice does. A group a profile or
 * chat had on stays on; one it had off is switched off; and in a profile that
 * offers only some groups (Roleplay, Blank), and the chats on it, one it had
 * on joins the ones it offers. Nothing is taken off, so a second device
 * giving the same chats the same lists changes nothing, and a device that
 * hasn't yet does no harm to what the first wrote.
 *
 * A group that isn't there to be offered on this device is left alone, so
 * that, set up later, it is on wherever nothing said otherwise, as anything
 * added is: the web without a service chosen, and Python where it can't run.
 * The old fields and lists are left as they were, for an app from before.
 */

import { useApplicationState } from './useApplicationState.js'
import { useProfiles } from './useProfiles.js'
import { useMcpServers } from './useMcpServers.js'
import { useWebSearch } from './useWebSearch.js'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { useChatsStore } from '@/stores/chatsStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { storage } from '@/storage/index.js'
import { BUILT_IN_PROFILES, DEFAULT_PROFILE_ID } from '@/ai/profiles/index.js'
import { groupOn } from '@/ai/tools/choice.js'
import { WEB_GROUP } from '@/ai/tools/web.js'
import { PYTHON_GROUP, pythonOffered } from '@/ai/tools/python.js'
import { serverGroup } from '@/mcp/names.js'

/** @typedef {import('@/ai/tools/choice.js').ToolChoice} ToolChoice */

/** The app's own groups from before, which a choice already said of. */
const OWN_GROUPS = ['documents', 'rpg', 'skills']

/**
 * What the old lists said of each group, for a holder on a profile.
 *
 * @typedef {Object} Lists
 * @property {string[]|null} web - The profiles that searched; null where no
 *   service is chosen
 * @property {string[]|null} python - The profiles that ran Python; null where
 *   it can't run here
 * @property {Array<{id: string, profiles: string[]}>} servers
 */

/**
 * The groups a profile or chat had on and off by the old lists, by group.
 *
 * @param {{web?: boolean, python?: boolean, mcpServers?: string[]}} holder -
 *   A chat, with its own choices; a profile has none
 * @param {string} profileId - The profile it was on, resolved
 * @param {Lists} lists
 * @returns {Map<string, boolean>}
 */
function legacyGroups(holder, profileId, lists) {
  /** @type {Map<string, boolean>} */
  const on = new Map()
  if (lists.web) {
    on.set(WEB_GROUP, typeof holder.web === 'boolean' ? holder.web : lists.web.includes(profileId))
  }
  if (lists.python) {
    on.set(
      PYTHON_GROUP,
      typeof holder.python === 'boolean' ? holder.python : lists.python.includes(profileId)
    )
  }
  for (const server of lists.servers) {
    on.set(
      serverGroup(server.id),
      Array.isArray(holder.mcpServers)
        ? holder.mcpServers.includes(server.id)
        : server.profiles.includes(profileId)
    )
  }
  return on
}

/**
 * What to write on a choice for the groups the old lists said of: those off
 * among its groups off, and, where it offers only some, those on among the
 * ones it offers. Null where that changes nothing.
 *
 * @param {ToolChoice} choice - As it stands
 * @param {Map<string, boolean>} legacy
 * @param {string[]|undefined} offers - The groups its profile offers, where
 *   it offers only some
 * @returns {ToolChoice|null}
 */
export function givenChoice(choice, legacy, offers) {
  const disabled = new Set(choice.disabledToolGroups || [])
  const before = disabled.size
  const only = Array.isArray(choice.onlyToolGroups)
    ? new Set(choice.onlyToolGroups)
    : offers
      ? new Set(OWN_GROUPS.filter(group => groupOn(choice, group)))
      : null
  const offered = only ? only.size : 0
  for (const [group, on] of legacy) {
    if (!on) disabled.add(group)
    else if (only) only.add(group)
  }
  /** @type {ToolChoice} */
  const changes = {}
  if (disabled.size !== before) changes.disabledToolGroups = [...disabled]
  if (only && (only.size !== offered || !Array.isArray(choice.onlyToolGroups))) {
    changes.onlyToolGroups = [...only]
  }
  return Object.keys(changes).length > 0 ? changes : null
}

/**
 * The old lists as this device has them.
 *
 * @returns {Lists}
 */
function readLists() {
  const app = useApplicationState()
  const setup = useWebSearch().setup.value
  return {
    web: setup?.service ? setup.profiles || [] : null,
    python: pythonOffered() ? (app.pythonProfiles.value ?? [DEFAULT_PROFILE_ID]) : null,
    servers: useMcpServers()
      .servers.value.filter(server => server.url)
      .map(server => ({ id: server.id, profiles: server.profiles || [] })),
  }
}

/**
 * Give every profile and chat its web, Python and servers as switches of
 * its own, once on this device.
 *
 * @returns {Promise<void>}
 */
export async function giveToolChoices() {
  const app = useApplicationState()
  if (app.toolsGiven.value) return
  const profiles = useProfiles()
  await Promise.all([profiles.ready(), useMcpServers().ready(), useWebSearch().ready()])
  try {
    const lists = readLists()

    // The built-ins, beside them, and the writer's own, in their settings.
    for (const builtIn of BUILT_IN_PROFILES) {
      const settings = { ...builtIn.settings, ...app.builtInProfiles.value[builtIn.id] }
      const changes = givenChoice(
        settings,
        legacyGroups({}, builtIn.id, lists),
        settings.onlyToolGroups
      )
      if (changes) app.setBuiltInProfile(builtIn.id, changes)
    }
    const stored = useChatProfileStore()
    for (const profile of stored.getAllProfiles()) {
      /** @type {ToolChoice} */
      const settings = profile.settings || {}
      const changes = givenChoice(
        settings,
        legacyGroups({}, profile.id, lists),
        settings.onlyToolGroups
      )
      if (changes) stored.updateProfile(profile.id, /** @type {any} */ ({ settings: changes }))
    }

    // Each chat by the profile it ran on: its own where that is there still,
    // and its project's default otherwise.
    const stories = useStoriesStore()
    /** @param {any} chat */
    const forChat = chat => {
      const profile =
        profiles.getProfile(chat.profileId) ??
        profiles.getProfile(stories.getStory(chat.storyId)?.options?.profileId) ??
        profiles.getProfile(profiles.chatDefaultId())
      const profileId = profile?.id ?? DEFAULT_PROFILE_ID
      return givenChoice(
        chat,
        legacyGroups(chat, profileId, lists),
        profile?.settings?.onlyToolGroups
      )
    }
    const chats = useChatsStore()
    let given = 0
    for (const chat of chats.chats.values()) {
      const changes = forChat(chat)
      if (!changes) continue
      chats.updateChat(chat.id, changes)
      given++
    }
    given += await storage.updateEach('chats', chat =>
      chats.chats.has(chat.id) ? null : forChat(chat)
    )
    app.setToolsGiven(true)
    console.log(`Gave ${given} chats their web, Python and servers as tools`)
  } catch (error) {
    console.error('Failed to give chats their web, Python and servers as tools:', error)
  }
}
