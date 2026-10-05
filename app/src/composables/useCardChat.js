/**
 * @module composables/useCardChat
 * @description Starting a chat on an imported card.
 *
 * This is where the pieces meet: the Roleplay profile says how the chat runs,
 * the card's own documents say who is in it, and the greeting goes in as the
 * first thing said. None of it is new machinery — a chat stamped from a
 * profile, a few pins, and a message — which is the point. "Chat with
 * Seraphina" is a profile being applied, not a feature of cards.
 *
 * A chat imported from SillyTavern gets here the other way round: it has its
 * messages already and no idea who it was with beyond a name. `attach` finds
 * that character's card and puts the same pins and author's note on it.
 */

import { useChats } from './useChats.js'
import { useProfiles } from './useProfiles.js'
import { cardsNamed, readCardChat } from '@/cards/chat.js'
import { overOriginal } from '@/cards/card.js'
import { ROLEPLAY_PROFILE_ID } from '@/ai/profiles/index.js'

/**
 * @param {string} storyId
 */
export function useCardChat(storyId) {
  const chatsApi = useChats(storyId)
  const profilesApi = useProfiles()

  /**
   * What a card folder offers, or null if it is not one.
   *
   * @param {string} folderId
   * @returns {Promise<import('@/cards/chat.js').CardChat|null>}
   */
  const read = folderId => readCardChat(storyId, folderId)

  /**
   * What a card puts on a chat that runs on it.
   *
   * @param {import('@/cards/chat.js').CardChat} card
   * @param {string} [note] - The author's note the chat would have without the
   *   card: its profile's
   * @returns {Partial<import('@/types/models.js').Chat>}
   */
  function settingsFrom(card, note = '') {
    /** @type {Partial<import('@/types/models.js').Chat>} */
    const settings = {}
    if (card.pinnedIds.length > 0) settings.pinnedIds = card.pinnedIds
    // The other characters, out of sight. See `readCardChat`.
    if (card.hiddenIds.length > 0) settings.hiddenIds = card.hiddenIds
    if (card.shownIds.length > 0) settings.shownIds = card.shownIds

    // The card's post-history instructions over the profile's note: in place
    // of it, unless they say `{{original}}`, which is where it goes. Two whole
    // sets of instructions a few lines from generation is an argument the
    // model has to settle instead of writing.
    if (card.rules) settings.rules = overOriginal(card.rules, note) || undefined

    // A card's system prompt becomes a profile of the writer's own, named for
    // the card, so it is in the library beside every other and they can edit
    // it. The alternative is a prompt that exists on one chat and cannot be
    // found. It starts from the Roleplay profile, so the tools it assumes are
    // off stay off.
    if (card.systemPrompt) {
      const roleplay = profilesApi.getProfile(ROLEPLAY_PROFILE_ID)
      settings.profileId = profilesApi.saveProfile(card.title, {
        ...roleplay?.settings,
        prompt: overOriginal(card.systemPrompt, roleplay?.settings?.prompt),
      }).id
    }

    return settings
  }

  /**
   * Start a chat on a card.
   *
   * @param {import('@/cards/chat.js').CardChat} card
   * @param {Object} [options]
   * @param {number} [options.greeting] - Which greeting opens it; the first by default
   * @returns {Promise<import('@/types/models.js').Chat>}
   */
  async function start(card, { greeting = 0 } = {}) {
    const chat = chatsApi.createChat(card.title, ROLEPLAY_PROFILE_ID)
    if (!chat) throw new Error('Could not start a chat on this card.')

    const settings = settingsFrom(card, chat.rules)
    if (Object.keys(settings).length > 0) chatsApi.updateChat(chat.id, settings)

    // The opening turn is most of why cards work: it sets voice, tense, length
    // and formatting by example before anything has been asked. It is an
    // ordinary message, so the writer can edit it, retry it or delete it.
    const opening = card.greetings[greeting] ?? card.greetings[0]
    if (opening?.content?.trim()) {
      chatsApi.addMessage(chat.id, 'assistant', opening.content)
    }

    // As stored now, with what the card put on it: an update is a new record,
    // and the one created above has none of it.
    return chatsApi.getChatById(chat.id) || chat
  }

  /**
   * Put a chat that already exists onto the card for its character.
   *
   * For a chat imported from SillyTavern, which is a transcript and knows who
   * it was with by name only. Without this it is a conversation with nobody in
   * it: the history is there, and the description, the scenario and the
   * examples that made the character answer the way they did are not.
   *
   * Only when exactly one card in the project is that character. With none
   * there is nothing to pin, and with two there is no telling which.
   *
   * @param {string} chatId
   * @param {string} character - The name they spoke under
   * @param {Object} [options]
   * @param {string} [options.note] - The chat's own Author's Note from ST,
   *   which goes after what the card puts in the author's note rather than
   *   being replaced by it: it says where the scene has got to, not how a turn
   *   is written
   * @returns {Promise<import('@/cards/chat.js').CardChat|null>} The card it
   *   is now on, or null if it is on none
   */
  async function attach(chatId, character, { note = '' } = {}) {
    const found = await cardsNamed(storyId, character)
    if (found.length !== 1) return null

    const card = await readCardChat(storyId, found[0].id)
    if (!card) return null

    // Over the Roleplay profile's note, which is what the import stamped the
    // chat from; the Author's Note it carried goes back after it.
    const profileNote = profilesApi.getProfile(ROLEPLAY_PROFILE_ID)?.settings?.rules
    const settings = settingsFrom(card, profileNote)
    if (settings.rules && note) settings.rules = `${settings.rules}\n\n${note}`
    if (Object.keys(settings).length > 0) chatsApi.updateChat(chatId, settings)

    return card
  }

  return { read, start, attach }
}
