/**
 * @module cards/write
 * @description A card, written into the project as documents.
 *
 * The half of the import that touches the tree. What arrives is already one
 * shape whatever file it came out of — see `./card.js` — so this has no idea
 * which version it is writing, and a lorebook on its own is the same code with
 * the character half not running.
 *
 * A card is a folder of ordinary documents rather than one blob, because a blob
 * is invisible to search, uneditable in the editor, and would need a viewer of
 * its own. As documents, every tool the app already has works on it, and the
 * question of how to edit a card answers itself.
 *
 * Design: `.llm/character_cards_design.md`.
 */

import { useDocuments } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useFilesStore } from '@/stores/filesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { parseMarkdown, serializeMarkdown, settleMarkdown } from '@/editor/markdown.js'
import { laysOut } from '@/editor/size.js'
import { substitute, uncomment, undecorate } from './card.js'

/** @typedef {import('./card.js').Card} Card */
/** @typedef {import('./card.js').LoreEntry} LoreEntry */

/** What the sidecar is called, and what it holds. */
export const SIDECAR_TITLE = '.card.json'

/**
 * What an import left behind.
 *
 * @typedef {Object} Written
 * @property {string} folderId - The folder the card became, or the one document
 *   an import that had only one to write
 * @property {string} title - What it ended up called
 * @property {string[]} pinnedIds - What a chat on this card should pin: the
 *   documents that have to be in context from the first turn
 * @property {string[]} greetingIds - The greetings, in the card's own order
 * @property {number} documents - How many were written, sidecar included
 * @property {string} [note] - A line about what was written, for the writer,
 *   when a count would not say it: that a PDF had no text in it
 */

/**
 * Write a card into the project.
 *
 * @param {string} storyId
 * @param {Card} card
 * @param {Object} [options]
 * @param {string} [options.parentId] - Where to put it; the project root otherwise
 * @param {string} [options.userName] - What `{{user}}` becomes
 * @param {boolean} [options.useSystemPrompt] - Keep the card's prompt override as
 *   a document of its own. Off by default: most cards that carry one are
 *   carrying an ST preset's scaffolding rather than anything about the
 *   character, and it is in the sidecar either way.
 * @param {Blob} [options.portrait] - The image the card came in, kept as a file
 *   in its folder. It is what the card looks like where people browse for
 *   them, and a model that can see it may as well.
 * @returns {Promise<Written>}
 */
export async function writeCard(
  storyId,
  card,
  { parentId, userName = 'You', useSystemPrompt = false, portrait } = {}
) {
  const api = useDocuments(storyId)
  await api.init()
  const store = useDocumentsStore()

  const parent = parentId || rootIdFor(storyId)
  const folder = store.createDocument({
    storyId,
    parentId: parent,
    type: 'folder',
    title: api.uniqueTitle(parent, card.title),
    kind: 'card',
  })

  const filled = await fillCard(storyId, folder.id, card, { userName, useSystemPrompt, portrait })
  return { folderId: folder.id, title: folder.title, ...filled, documents: filled.documents + 1 }
}

/**
 * Write a card into a folder again, over what was there.
 *
 * For a card imported once and wanted fresh — under another name for
 * `{{user}}`, or with the edits since taken back. The folder stays, with its
 * title and its place, so a chat started on it still knows what it was on;
 * what is in it goes and is written again from the card. The portrait the
 * card arrived in is kept, unless another is given.
 *
 * @param {string} storyId
 * @param {string} folderId - A card folder
 * @param {Card} card
 * @param {Object} [options]
 * @param {string} [options.userName] - What `{{user}}` becomes
 * @param {boolean} [options.useSystemPrompt]
 * @param {Blob} [options.portrait] - The image to keep; the one there already otherwise
 * @returns {Promise<Written>}
 * @throws {Error} When the folder is not a card's
 */
export async function reimportCard(
  storyId,
  folderId,
  card,
  { userName = 'You', useSystemPrompt = false, portrait } = {}
) {
  const api = useDocuments(storyId)
  await api.init()
  const folder = api.get(folderId)
  if (!folder || folder.type !== 'folder' || folder.kind !== 'card') {
    throw new Error('Only a card folder can be re-imported.')
  }

  const children = api.childrenOf(folderId)
  const kept =
    portrait ||
    (await useFilesStore().getFile(children.find(child => child.kind === 'portrait')?.id || '')) ||
    undefined
  for (const child of children) api.remove(child.id)

  const filled = await fillCard(storyId, folderId, card, {
    userName,
    useSystemPrompt,
    portrait: kept,
  })
  return { folderId, title: folder.title, ...filled, documents: filled.documents }
}

/**
 * The documents a card is made of, written into a folder.
 *
 * @param {string} storyId
 * @param {string} folderId
 * @param {Card} card
 * @param {Object} options
 * @param {string} options.userName
 * @param {boolean} options.useSystemPrompt
 * @param {Blob} [options.portrait]
 * @returns {Promise<Pick<Written, 'pinnedIds'|'greetingIds'|'documents'>>} The
 *   count is of what this wrote: the folder is not counted here
 */
async function fillCard(storyId, folderId, card, { userName, useSystemPrompt, portrait }) {
  const store = useDocumentsStore()
  const folder = { id: folderId }

  const names = { char: card.name, user: userName }
  // Settled as well as substituted: a card is text written from outside, and
  // what the editor would serialize is the form everything else in the project
  // is stored in. Without it the first time the writer opens one of these and
  // closes it again rewrites the whole document. See `editor/markdown.js`.
  const say = (/** @type {string} */ value) => settleMarkdown(substitute(uncomment(value), names))

  /** @type {string[]} */
  const pinnedIds = []
  let documents = 0

  /**
   * One of the card's fields, when it has one. A field with nothing in it gets
   * no document: most cards have no `personality` separate from the
   * description, and an empty stub is one more line in the listing for the
   * model to read past.
   */
  const field = (
    /** @type {string} */ title,
    /** @type {string} */ kind,
    value,
    { pin = true, hidden = false } = {}
  ) => {
    const content = say(value)
    if (!content) return
    const made = store.createDocument({
      storyId,
      parentId: folder.id,
      type: 'text',
      title,
      content,
      kind,
      hidden,
    })
    documents++
    if (pin) pinnedIds.push(made.id)
  }

  // These two are instructions to a chat rather than things to know about the
  // character. They are documents like the rest, so the writer can read and
  // edit them and a chat started next week can find them; hidden, because the
  // model is not meant to read them as part of the project. A chat started on
  // the card takes one as its prompt and the other into its author's note —
  // see `overOriginal` — and after that they are the chat's to change.
  if (useSystemPrompt)
    field('System Prompt', 'system-prompt', card.systemPrompt, { pin: false, hidden: true })
  field("Author's Note", 'rules', card.rules, { pin: false, hidden: true })

  field('Description', 'description', card.description)
  field('Personality', 'personality', card.personality)
  field('Scenario', 'scenario', card.scenario)
  field('Example Dialogue', 'examples', card.examples)

  // The greetings are not context. The first is seeded as the chat's opening
  // message, which is most of why cards work at all, and the rest are what the
  // dialog that starts a chat offers instead. They are documents so that they
  // survive and can be edited; they are not pinned, because a greeting in
  // context as well as in the conversation is the same words twice.
  /** @type {string[]} */
  const greetingIds = []
  card.greetings.forEach((greeting, at) => {
    const made = store.createDocument({
      storyId,
      parentId: folder.id,
      type: 'text',
      title: at === 0 ? 'Greeting' : `Greeting ${at + 1}`,
      content: say(greeting),
      kind: 'greeting',
    })
    greetingIds.push(made.id)
    documents++
  })

  if (card.lore.length > 0) {
    const written = writeLore(store, storyId, folder.id, card.lore, names)
    pinnedIds.push(...written.pinnedIds)
    documents += written.documents
  }

  documents += writeSidecar(store, storyId, folder.id, card.raw)
  if (portrait) documents += await writePortrait(store, storyId, folder.id, portrait)

  return { pinnedIds, greetingIds, documents }
}

/**
 * The image a card arrived in, kept as a file beside its documents.
 *
 * Not hidden: it costs a thousand tokens on a model that can see it and
 * nothing on one that cannot, and a chat on the card can let it go like
 * anything else in the folder. The sidecar holds the card's JSON and this
 * holds its pixels; between them the card round-trips.
 *
 * @param {ReturnType<typeof useDocumentsStore>} store
 * @param {string} storyId
 * @param {string} folderId
 * @param {Blob} portrait
 * @returns {Promise<number>} How many documents this wrote
 */
async function writePortrait(store, storyId, folderId, portrait) {
  const made = store.createDocument({
    storyId,
    parentId: folderId,
    type: 'file',
    title: 'Portrait',
    kind: 'portrait',
    mime: portrait.type || 'image/png',
    size: portrait.size,
  })
  await useFilesStore().putFile(made.id, storyId, portrait)
  return 1
}

/**
 * Write a markdown file in as one document.
 *
 * The plainest import there is, and the reason "Import" is not "Import a card":
 * a file of prose is a document, and the tree is made of documents. Titled
 * after the file rather than after a heading inside it — a heading is the
 * writer's text and eating it to make a name is a decision the importer has no
 * business taking. One too long for the editor to lay out comes in plain, as
 * the text it is: see editor/size.
 *
 * @param {string} storyId
 * @param {string} title
 * @param {string} content
 * @param {Object} [options]
 * @param {string} [options.parentId]
 * @returns {Promise<Written>}
 */
export async function writeMarkdown(storyId, title, content, { parentId } = {}) {
  const api = useDocuments(storyId)
  await api.init()
  const store = useDocumentsStore()

  const parent = parentId || rootIdFor(storyId)
  const doc = parseMarkdown(content)
  const plain = !laysOut(doc)
  const made = store.createDocument({
    storyId,
    parentId: parent,
    type: 'text',
    title: api.uniqueTitle(parent, title || 'Untitled'),
    plain,
    content: plain ? content : serializeMarkdown(doc),
  })

  return {
    folderId: made.id,
    title: made.title,
    pinnedIds: [],
    greetingIds: [],
    documents: 1,
  }
}

/**
 * Write a lorebook that arrived on its own.
 *
 * A world several characters are played in, rather than one character's notes.
 * The same documents, with no card around them.
 *
 * @param {string} storyId
 * @param {{name: string, entries: LoreEntry[], raw: any}} book
 * @param {Object} [options]
 * @param {string} [options.parentId]
 * @param {string} [options.title] - Overrides the book's own name
 * @returns {Promise<Written>}
 */
export async function writeLorebook(storyId, book, { parentId, title } = {}) {
  const api = useDocuments(storyId)
  await api.init()
  const store = useDocumentsStore()

  const parent = parentId || rootIdFor(storyId)
  const folder = store.createDocument({
    storyId,
    parentId: parent,
    type: 'folder',
    title: api.uniqueTitle(parent, title || book.name || 'Lore'),
    kind: 'lore',
  })

  // No names to put in: a book that arrived on its own has no character, so a
  // macro in one has nothing to become and is left to the writer to see.
  const written = writeLore(store, storyId, folder.id, book.entries, null, {
    into: folder.id,
  })
  const sidecar = writeSidecar(store, storyId, folder.id, book.raw)

  return {
    folderId: folder.id,
    title: folder.title,
    pinnedIds: written.pinnedIds,
    greetingIds: [],
    documents: 1 + written.documents + sidecar,
  }
}

/**
 * The entries, one document each.
 *
 * Under a `Lore` folder of its own when this is a card, because a character's
 * own documents and the world's background are two different things to look
 * at. A book that arrived alone is already in its folder and goes straight in.
 *
 * Keys go on the first line of the body rather than in the summary. The summary
 * rides in the project block on every turn, so what goes in it is paid for by
 * every turn of every chat for the life of the project; a body is paid for once
 * by a turn that opens the document. A key list is long, mostly inflections,
 * and earns nothing on a turn that is not looking for that entry — and in the
 * body `search_documents` still matches it, since that reads titles and
 * content.
 *
 * The summary is left empty. It should be a sentence about what the entry says,
 * and writing that needs a model; an importer inventing one would be putting
 * words in the entry's mouth.
 *
 * @param {ReturnType<typeof useDocumentsStore>} store
 * @param {string} storyId
 * @param {string} folderId - The card's folder, or the book's own
 * @param {LoreEntry[]} entries
 * @param {{char: string, user: string}|null} names - What the macros become, when there are names for them
 * @param {{into?: string}} [options] - Write straight into `into` rather than a `Lore` folder
 * @returns {{pinnedIds: string[], documents: number}}
 */
function writeLore(store, storyId, folderId, entries, names, { into } = {}) {
  const say = (/** @type {string} */ value) =>
    names ? substitute(uncomment(value), names) : uncomment(value)
  let documents = 0
  let parentId = into

  if (!parentId) {
    parentId = store.createDocument({
      storyId,
      parentId: folderId,
      type: 'folder',
      title: 'Lore',
      kind: 'lore',
    }).id
    documents++
  }

  /** @type {string[]} */
  const pinnedIds = []

  for (const entry of entries) {
    const keys = entry.keys.length > 0 ? `${entry.keys.join(', ')}\n\n` : ''
    const made = store.createDocument({
      storyId,
      parentId,
      type: 'text',
      // A title is a title, not markdown — settling one would escape the
      // punctuation an author put in it.
      title: say(undecorate(entry.title)),
      content: settleMarkdown(say(`${keys}${entry.content}`)),
      // `constant` is not retrieval at all — it is a statement that this
      // paragraph is always in context, which is what a pin is. It goes in the
      // kind rather than only into what this call returns, because a chat
      // started on this card next week cannot ask the file what it said.
      kind: entry.constant ? 'lore-constant' : 'lore-entry',
    })
    documents++
    if (entry.constant) pinnedIds.push(made.id)
  }

  return { pinnedIds, documents }
}

/**
 * The card exactly as it arrived, kept so an export loses nothing.
 *
 * `hidden`, which already means kept from the model and out of reach of its
 * tools, and `plain` so it is stored as written rather than settled to what the
 * editor can show. It still appears in the tree, dimmed — the writer can see
 * what the import wrote, open it, and delete it. A sidecar nobody can find is a
 * file that rots.
 *
 * @param {ReturnType<typeof useDocumentsStore>} store
 * @param {string} storyId
 * @param {string} folderId
 * @param {any} raw
 * @returns {number} How many documents this wrote
 */
function writeSidecar(store, storyId, folderId, raw) {
  if (!raw) return 0
  store.createDocument({
    storyId,
    parentId: folderId,
    type: 'text',
    title: SIDECAR_TITLE,
    content: JSON.stringify(raw, null, 2),
    kind: 'sidecar',
    hidden: true,
    plain: true,
  })
  return 1
}

/**
 * The kinds on the folders imports are shelved in.
 */
export const SHELF_KINDS = /** @type {const} */ ({
  cards: 'cards',
  characters: 'card-characters',
  lorebooks: 'card-lorebooks',
})

/** What a shelf is called when it has to be made. */
const SHELF_TITLES = { cards: 'Cards', characters: 'Characters', lorebooks: 'Lorebooks' }

/**
 * The folder an import of this kind is shelved in, made if there is none.
 *
 * `Cards/Characters` and `Cards/Lorebooks`, so that a character imported later
 * lands where every chat on another character already hides them — see
 * utils/visibility.js — and a lorebook, which is a world several characters
 * can be played in, lands somewhere nobody hides by default. Under `Cards/`
 * so that a novel's own `Characters` folder is never the one hidden.
 *
 * Found by kind wherever the writer has moved it and whatever they have
 * renamed it to.
 *
 * @param {string} storyId
 * @param {'characters'|'lorebooks'} which
 * @returns {Promise<string>} The folder's id
 */
export async function shelfFor(storyId, which) {
  const api = useDocuments(storyId)
  await api.init()
  const store = useDocumentsStore()

  /**
   * @param {string} kind
   * @returns {any}
   */
  const find = kind => {
    /** @param {string} id @returns {any} */
    const walk = id => {
      for (const child of api.childrenOf(id)) {
        if (child.type !== 'folder') continue
        if (child.kind === kind) return child
        const below = walk(child.id)
        if (below) return below
      }
      return null
    }
    return walk(rootIdFor(storyId))
  }

  const had = find(SHELF_KINDS[which])
  if (had) return had.id

  /**
   * @param {string} parentId
   * @param {keyof typeof SHELF_KINDS} name
   */
  const make = (parentId, name) =>
    store.createDocument({
      storyId,
      parentId,
      type: 'folder',
      title: api.uniqueTitle(parentId, SHELF_TITLES[name]),
      kind: SHELF_KINDS[name],
    })

  const cards = find(SHELF_KINDS.cards) || make(rootIdFor(storyId), 'cards')
  return make(cards.id, which).id
}
