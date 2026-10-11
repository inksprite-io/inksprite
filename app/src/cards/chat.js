/**
 * @module cards/chat
 * @description A card folder read back out of the tree, for starting a chat on.
 *
 * Import and "Chat with…" are not the same moment. A card is imported once and
 * played weeks later, by which time the file it came from is gone and the
 * writer has renamed half of it. So nothing is remembered from the import:
 * what a chat needs is worked out from the documents, by their `kind`.
 *
 * That is what `kind` is for. The titles belong to the writer — rename
 * `Description` to `Who she is`, drag it into a subfolder, and this still
 * finds it.
 *
 * Design: `.llm/character_cards_design.md`.
 */

import { useDocuments } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { readCard } from './card.js'
import { SHELF_KINDS } from './write.js'

/**
 * What a card folder has in it that a chat cares about.
 *
 * @typedef {Object} CardChat
 * @property {string} title - The card's, and the chat's
 * @property {string} name - The character's: what `{{char}}` becomes in a chat
 *   on the card. See `characterOf`.
 * @property {string[]} pinnedIds - What rides in the project block from turn one
 * @property {string[]} hiddenIds - What a chat on this card hides: the shelf the
 *   other characters are on, when the card is on one
 * @property {string[]} shownIds - What it shows under that: the card itself
 * @property {Greeting[]} greetings - In the card's own order; the first is its `first_mes`
 * @property {string} rules - The card's post-history instructions, as written:
 *   what a chat on it puts in its author's note, `{{original}}` and all
 * @property {string} systemPrompt - Overrides the chat's prompt, when the card had one
 *   and the writer kept it
 *
 * @typedef {Object} Greeting
 * @property {string} id
 * @property {string} title
 * @property {string} content
 */

/** The documents that have to be in context before the model says anything. */
const PINNED_KINDS = new Set([
  'description',
  'personality',
  'scenario',
  'examples',
  'lore-constant',
])

/**
 * Whether this folder came from a card, and so has a chat to start.
 *
 * @param {any} document
 * @returns {boolean}
 */
export function isCard(document) {
  return document?.type === 'folder' && document?.kind === 'card'
}

/**
 * Who a card folder is: the character's name.
 *
 * The one in the sidecar, which is the character's own, what `{{char}}` meant
 * to the card's author, and what ST put on every message they sent. The
 * folder's title is the writer's to change, and on a scenario card it never was
 * the character's name. A card with no sidecar — deleted, or a card made here
 * by hand — goes by its title.
 *
 * @param {ReturnType<typeof useDocuments>} api
 * @param {any} folder - A card folder
 * @returns {string}
 */
function characterOf(api, folder) {
  const sidecar = api.childrenOf(folder.id).find(child => child.kind === 'sidecar')
  try {
    if (sidecar?.content) return readCard(JSON.parse(sidecar.content)).name
  } catch {
    // A sidecar the writer has been editing. The title will do.
  }
  return folder.title
}

/**
 * The card folders in this project that are a character of this name.
 *
 * For a chat that arrives knowing only who it was with; see `./transcript.js`.
 * By the name in the sidecar; see `characterOf`.
 *
 * All of them, rather than the first: two cards for one name is a question,
 * and which was meant is not something to guess at.
 *
 * @param {string} storyId
 * @param {string} name
 * @returns {Promise<any[]>} Card folders, in tree order
 */
export async function cardsNamed(storyId, name) {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return []

  const api = useDocuments(storyId)
  await api.init()

  /** @type {any[]} */
  const found = []
  const walk = (/** @type {string} */ id) => {
    for (const child of api.childrenOf(id)) {
      if (isCard(child)) {
        if (characterOf(api, child).trim().toLowerCase() === wanted) found.push(child)
      } else if (child.type === 'folder') {
        walk(child.id)
      }
    }
  }
  walk(rootIdFor(storyId))

  return found
}

/**
 * Read a card folder for everything starting a chat on it needs.
 *
 * Everything under the folder, however deep, because the writer may have
 * tidied it into subfolders. Hidden documents are read here on purpose: the
 * post-history instructions and the system prompt are hidden precisely so they do not also arrive
 * through the project block, and this is the route they were hidden for.
 *
 * @param {string} storyId
 * @param {string} folderId
 * @returns {Promise<CardChat|null>} Null if that is not a card folder
 */
export async function readCardChat(storyId, folderId) {
  const api = useDocuments(storyId)
  await api.init()

  const folder = api.get(folderId)
  if (!isCard(folder)) return null

  /** @type {any[]} */
  const documents = []
  const walk = (/** @type {string} */ id) => {
    for (const child of api.childrenOf(id)) {
      documents.push(child)
      if (child.type === 'folder') walk(child.id)
    }
  }
  walk(folderId)

  const of = (/** @type {string} */ kind) => documents.filter(document => document.kind === kind)
  const textOf = (/** @type {string} */ kind) => of(kind)[0]?.content?.trim() || ''

  // The shelf every character is on, when this one is on it: hidden, and this
  // card shown under it, so a chat on one character sees no other — including
  // one imported after the chat started. A card somewhere else hides nothing.
  let shelf = api.get(folder.parentId)
  while (shelf && shelf.kind !== SHELF_KINDS.characters) shelf = api.get(shelf.parentId)

  return {
    title: folder.title,
    name: characterOf(api, folder),
    hiddenIds: shelf ? [shelf.id] : [],
    shownIds: shelf ? [folder.id] : [],
    pinnedIds: documents
      .filter(document => document.type === 'text' && PINNED_KINDS.has(document.kind))
      .map(document => document.id),
    // In the order the import wrote them, which is the card's own: `first_mes`
    // and then its alternates. Order rather than title, because `Greeting 2` is
    // a name the writer may well have changed.
    greetings: of('greeting')
      .sort((a, b) => a.order - b.order)
      .map(document => ({ id: document.id, title: document.title, content: document.content })),
    rules: textOf('rules'),
    systemPrompt: textOf('system-prompt'),
  }
}
