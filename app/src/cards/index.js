/**
 * @module cards
 * @description Character cards and lorebooks, read into the project as
 * documents.
 *
 * Cards are SillyTavern's — V1, V2 and V3, as PNG or JSON — and they come in
 * because the people who write them have already done, by hand and at volume,
 * the work of turning traits into behaviours. A good card is a page of example
 * dialogue rather than a page of adjectives.
 *
 * - **png** - The card hidden in a PNG's text chunks
 * - **card** - A card or a book as one shape, whatever version it arrived as
 * - **write** - That shape, written into the project as documents
 * - **macros** - `{{char}}` and `{{user}}`, filled in for the chat that plays a card
 * - **chat** - A card folder read back out of the tree, for a chat to run on
 * - **transcript** - A SillyTavern chat file, read into a chat's worth of messages
 *
 * Reading is pure — `png`, `card`, `macros` and `transcript` touch no store — and `write`
 * is the one part that has the tree in its hands.
 *
 * Design: `.llm/character_cards_design.md`.
 *
 * @example
 * import { cardFromPng } from '@/cards/png.js'
 * import { shapeOf, readCard } from '@/cards/card.js'
 * import { writeCard } from '@/cards/write.js'
 *
 * const value = cardFromPng(await file.arrayBuffer())
 * if (shapeOf(value) === 'card') await writeCard(storyId, readCard(value))
 */

export { textChunks, cardFromPng } from './png.js'
export { shapeOf, readCard, readLorebook, undecorate } from './card.js'
export { namesOf, substitute, storedPassage } from './macros.js'
export { writeCard, writeLorebook, SIDECAR_TITLE } from './write.js'
