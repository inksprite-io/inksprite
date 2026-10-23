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
 * that character's card and puts the same pins and instructions on it.
 */

import { useChats } from './useChats.js'
import { useProfiles } from './useProfiles.js'
import { cardsNamed, readCardChat } from '@/cards/chat.js'
import { substitute } from '@/cards/macros.js'

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
   * @returns {Partial<import('@/types/models.js').Chat>}
   */
  function settingsFrom(card) {
    /** @type {Partial<import('@/types/models.js').Chat>} */
    const settings = {}
    if (card.pinnedIds.length > 0) settings.pinnedIds = card.pinnedIds
    // The other characters, out of sight. See `readCardChat`.
    if (card.hiddenIds.length > 0) settings.hiddenIds = card.hiddenIds
    if (card.shownIds.length > 0) settings.shownIds = card.shownIds

    // The card's own instructions, as it wrote them, beside the profile's
    // rather than mixed into them: the chat sends them after its system prompt
    // and its author's note, each turn, and saving the chat to its profile
    // takes the writer's changes and leaves the card's behind. See
    // `withOriginal`.
    if (card.systemPrompt) settings.roleplayPrompt = card.systemPrompt
    if (card.rules) settings.postHistory = card.rules

    return settings
  }

  /**
   * Start a chat on a card.
   *
   * The names go on the chat, and are what the card's macros become in what
   * its model reads; the card's documents keep saying `{{char}}` and
   * `{{user}}`. See `cards/macros.js`.
   *
   * @param {import('@/cards/chat.js').CardChat} card
   * @param {Object} options
   * @param {string} options.userName - The writer's name in this chat
   * @param {number} [options.greeting] - Which greeting opens it; the first by default
   * @returns {Promise<import('@/types/models.js').Chat>}
   */
  async function start(card, { userName, greeting = 0 }) {
    const chat = chatsApi.createChat(card.title, profilesApi.roleplayDefaultId())
    if (!chat) throw new Error('Could not start a chat on this card.')

    const names = { char: card.name, user: userName.trim() }
    const settings = {
      ...settingsFrom(card),
      userName: names.user,
      characterName: names.char,
    }
    chatsApi.updateChat(chat.id, settings)

    // The opening turn is most of why cards work: it sets voice, tense, length
    // and formatting by example before anything has been asked. It is an
    // ordinary message, so the writer can edit it, retry it or delete it — and
    // it is the chat's, so it reads with the names in, as everything said in
    // the chat after it will.
    const opening = card.greetings[greeting] ?? card.greetings[0]
    if (opening?.content?.trim()) {
      chatsApi.addMessage(chat.id, 'assistant', substitute(opening.content, names))
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
   * The Author's Note the chat carried from ST stays in its author's note,
   * after the profile's, where the import put it.
   *
   * @param {string} chatId
   * @param {string} character - The name they spoke under
   * @returns {Promise<{card: import('@/cards/chat.js').CardChat|null, named: number}>}
   *   The card it is now on, or null if it is on none, and how many cards
   *   in the project are that character
   */
  async function attach(chatId, character) {
    const found = await cardsNamed(storyId, character)
    const named = found.length
    if (named !== 1) return { card: null, named }

    const card = await readCardChat(storyId, found[0].id)
    if (!card) return { card: null, named }

    const settings = settingsFrom(card)
    if (Object.keys(settings).length > 0) chatsApi.updateChat(chatId, settings)

    return { card, named }
  }

  /**
   * The name the writer went by in the chat they were in most recently that
   * had one, for the next chat on a card to start from.
   *
   * @returns {string} Empty when no chat in this project has one
   */
  function lastUserName() {
    // Most recent first already.
    return chatsApi.chats.value.find(chat => chat.userName?.trim())?.userName || ''
  }

  return { read, start, attach, lastUserName }
}
