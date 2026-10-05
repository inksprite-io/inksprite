/**
 * @module stores/migrations/profiles
 * @description The prompt library becomes chat profiles.
 *
 * A prompt was a piece of text a chat could be pointed at, and everything else
 * about how a chat runs lived on the chat. A profile is all of it in one place:
 * the prompt, and the roles that run under it. So every saved prompt becomes a
 * profile whose prompt it is, and every chat that named a prompt names that
 * profile instead.
 *
 * The saved prompt keeps its id, which makes the chat side a copy rather than a
 * lookup, and makes the way back obvious if there has to be one. The `aiPrompts`
 * table is left where it is — Dexie carries it, and a table nobody reads costs
 * nothing next to a conversion nobody can undo.
 */

import { BUILT_IN_PROFILES } from '@/ai/profiles/index.js'
import { DEFAULT_PROFILE_ID } from '@/ai/profiles/index.js'

/**
 * The built-in profile that was built around a given built-in prompt.
 *
 * The profiles used to name a prompt; now they carry one. A chat pointed at
 * `builtin_adventure` was asking for the Adventure profile in everything but
 * name, so that is what it gets.
 *
 * @param {string} promptId
 * @returns {string|null}
 */
function builtInFor(promptId) {
  if (typeof promptId !== 'string' || !promptId.startsWith('builtin_')) return null
  const suffix = promptId.slice('builtin_'.length)
  const profile = BUILT_IN_PROFILES.find(one => one.id === `builtin_profile_${suffix}`)
  return profile ? profile.id : DEFAULT_PROFILE_ID
}

/**
 * One saved prompt as the profile it becomes.
 *
 * @param {any} prompt - An `aiPrompts` row
 * @returns {any} A `chatProfiles` row
 */
function profileFrom(prompt) {
  return {
    id: prompt.id,
    name: prompt.name || 'Untitled',
    settings: { prompt: prompt.content || '' },
    version: 1,
    deleted: !!prompt.deleted,
    deletedAt: prompt.deletedAt ?? null,
    created: prompt.created || Date.now(),
    updated: prompt.updated || Date.now(),
  }
}

/**
 * The profiles a library of saved prompts becomes.
 *
 * @param {any[]} prompts - `aiPrompts` rows
 * @returns {{profiles: any[]}}
 */
export function promptsToProfiles(prompts) {
  return { profiles: (prompts || []).filter(Boolean).map(profileFrom) }
}

/**
 * Chats, pointed at profiles rather than prompts.
 *
 * A chat that named a saved prompt names the profile that prompt became, which
 * has the same id. One that named a built-in names the profile built around it.
 * One that named nothing still names nothing, and falls back the way it always
 * did — to whatever its project starts chats on.
 *
 * `promptId` stays on the row. Nothing reads it, and it is the only record of
 * what the chat was pointed at before this ran.
 *
 * @param {any[]} chats
 * @returns {{chats: any[], converted: number}}
 */
export function chatsToProfiles(chats) {
  let converted = 0

  const out = (chats || []).filter(Boolean).map(chat => {
    if (chat.profileId || !chat.promptId) return chat

    const profileId = builtInFor(chat.promptId) || chat.promptId
    converted++
    return { ...chat, profileId }
  })

  return { chats: out, converted }
}

/**
 * The project's default, which named a prompt for the same reason a chat did.
 *
 * @param {any[]} stories
 * @returns {{stories: any[], converted: number}}
 */
export function storiesToProfiles(stories) {
  let converted = 0

  const out = (stories || []).filter(Boolean).map(story => {
    const promptId = story.options?.promptId
    if (story.options?.profileId || !promptId) return story

    converted++
    return {
      ...story,
      options: { ...story.options, profileId: builtInFor(promptId) || promptId },
    }
  })

  return { stories: out, converted }
}
