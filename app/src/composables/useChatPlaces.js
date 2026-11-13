/**
 * @module composables/useChatPlaces
 * @description Where the writer was in each chat they left, so a chat's tab
 * brought forward again opens there rather than at its end.
 *
 * A place is the turn at the top of the screen and how far into it the
 * screen began. A chat left at its end has no place kept, and opens at its
 * end, which is where a reply that came in meanwhile is. Kept in memory for
 * the page: a chat opened after a reload opens at its end, as it always has.
 */

/**
 * @typedef {Object} ChatPlace
 * @property {string} turnId - The turn at the top of the screen
 * @property {number} offset - How far into it the screen began, in pixels
 */

/** @type {Map<string, ChatPlace>} */
const places = new Map()

/**
 * Keep where the writer was in a chat, or forget it with none.
 *
 * @param {string} chatId
 * @param {ChatPlace|null} place
 */
export function keepPlace(chatId, place) {
  if (place) places.set(chatId, place)
  else places.delete(chatId)
}

/**
 * Where the writer was in a chat, if they left it anywhere but its end.
 *
 * @param {string} chatId
 * @returns {ChatPlace|null}
 */
export function placeIn(chatId) {
  return places.get(chatId) ?? null
}
