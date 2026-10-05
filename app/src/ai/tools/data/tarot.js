/**
 * @module ai/tools/data/tarot
 * @description The seventy-eight cards of a tarot deck, under the names the
 * Rider–Waite–Smith deck gives them — the names a reader reaches for, and the
 * ones a model has read the most about.
 *
 * The Minor Arcana are built rather than listed: fifty-six lines that differ
 * only by suit and rank are fifty-six chances to misspell one.
 */

/** @type {readonly string[]} */
export const MAJOR_ARCANA = Object.freeze([
  'The Fool',
  'The Magician',
  'The High Priestess',
  'The Empress',
  'The Emperor',
  'The Hierophant',
  'The Lovers',
  'The Chariot',
  'Strength',
  'The Hermit',
  'Wheel of Fortune',
  'Justice',
  'The Hanged Man',
  'Death',
  'Temperance',
  'The Devil',
  'The Tower',
  'The Star',
  'The Moon',
  'The Sun',
  'Judgement',
  'The World',
])

/** @type {readonly string[]} */
const SUITS = Object.freeze(['Wands', 'Cups', 'Swords', 'Pentacles'])

/** @type {readonly string[]} */
const RANKS = Object.freeze([
  'Ace',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Page',
  'Knight',
  'Queen',
  'King',
])

/** @type {readonly string[]} */
export const MINOR_ARCANA = Object.freeze(
  SUITS.flatMap(suit => RANKS.map(rank => `${rank} of ${suit}`))
)

/**
 * The whole deck, Major Arcana first.
 * @type {readonly string[]}
 */
export const TAROT_DECK = Object.freeze([...MAJOR_ARCANA, ...MINOR_ARCANA])
