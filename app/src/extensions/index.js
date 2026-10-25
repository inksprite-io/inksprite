/**
 * @module extensions
 * @description Parts of the app not every writer wants, switched on in
 * Settings › Extensions.
 *
 * An extension is built in: its code ships with the app, and each place that
 * belongs to it asks whether it is on, as the AI's places ask whether the AI
 * is. What it is switched off from stays where it was, for when it is back on.
 *
 * - **Roleplay** - Character cards, the card library and the roleplay chat
 *   profiles. On where roleplay was already in use the first time the app
 *   opened with extensions, and off otherwise.
 * - **Python** - Python the model runs code in, in the desktop app only, in
 *   chats on the profiles its settings list or that switch it on. Off until
 *   switched on: nothing before it was in use. In the `python` preview. See
 *   ai/tools/python.js.
 *
 * Design: `.llm/extensions_design.md`.
 *
 * @example
 * import { useApplicationState } from '@/composables/useApplicationState'
 *
 * const { roleplay } = useApplicationState()
 * if (roleplay.value) items.push(chatWith)
 */

import { storage } from '@/storage/index.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { ROLEPLAY_NSFW_PROFILE_ID, ROLEPLAY_PROFILE_ID } from '@/ai/profiles/index.js'

/**
 * @typedef {Object} Extension
 * @property {string} id - What its switch is kept under
 * @property {string} name
 * @property {() => Promise<boolean>} inUse - Whether this copy of the app
 *   already uses what it holds, which decides its switch the first time
 */

/** The profiles a chat on which is a roleplay. */
const ROLEPLAY_PROFILES = new Set([ROLEPLAY_PROFILE_ID, ROLEPLAY_NSFW_PROFILE_ID])

/**
 * Whether roleplay is already in use here: cards in the library, the NSFW
 * switch on or a profile chosen for character cards, or a chat that is a
 * roleplay, on a Roleplay profile or naming a character as a chat on a card
 * does. Card folders in projects are not looked for, which on desktop would
 * mean reading every project's tree.
 *
 * @returns {Promise<boolean>}
 */
export async function roleplayInUse() {
  const { nsfwProfiles, roleplayProfileId } = useApplicationState()
  if (nsfwProfiles.value || roleplayProfileId.value) return true
  if ((await storage.count('cards')) > 0) return true

  // Every chat in every project, read and left as it is: the change asked for
  // is always none.
  let found = false
  await storage.updateEach('chats', chat => {
    if (ROLEPLAY_PROFILES.has(chat.profileId) || chat.characterName) found = true
    return null
  })
  return found
}

/** @type {Extension[]} */
export const EXTENSIONS = [
  { id: 'roleplay', name: 'Roleplay', inUse: roleplayInUse },
  { id: 'python', name: 'Python', inUse: async () => false },
]

/**
 * Decide the switch of each extension never decided, from whether what it
 * holds is in use here. Once, as the app opens: a new copy of the app has
 * nothing in use, and starts with all of them off.
 *
 * @returns {Promise<void>}
 */
export async function decideExtensions() {
  const { extensionOn, setExtension } = useApplicationState()
  for (const extension of EXTENSIONS) {
    if (extensionOn(extension.id) !== undefined) continue
    try {
      setExtension(extension.id, await extension.inUse())
    } catch (error) {
      console.error(`Failed to decide the ${extension.name} extension:`, error)
    }
  }
}
