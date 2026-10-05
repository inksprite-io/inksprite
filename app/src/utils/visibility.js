/**
 * @module utils/visibility
 * @description What one chat sees of the project.
 *
 * Two layers, and they are not the same kind of thing.
 *
 * A document's own `hidden` is absolute. It is for what no chat should read —
 * a card's JSON, the prompt it replaces — and nothing a chat says brings it
 * back, nor anything under a folder that has it.
 *
 * Under that, each chat marks documents for itself: **pinned** (its text rides
 * in the project block from the first turn), **shown** (listed, and the model
 * reads it when it wants to), or **hidden** (not there, for this chat). A mark
 * on a folder covers what is under it, and the nearest mark going up the tree
 * decides. So a chat on one character hides the folder all the characters are
 * in and shows its own, and a character imported next week lands hidden in
 * that chat without anybody touching it. A document nothing is marked on is
 * shown, which is what every chat had before there were marks.
 *
 * A pin is a mark like the other two rather than a flag beside them, so that a
 * document can only be in one state in a chat and a pin under a hidden folder
 * is seen.
 */

/** @typedef {import('../types/models.js').Document} TreeDocument */
/** @typedef {import('../types/models.js').Chat} ChatRecord */

/**
 * @typedef {'pinned'|'shown'|'hidden'} ChatMark
 */

/**
 * The marks a chat carries, which is all of it this module reads.
 *
 * @typedef {Pick<ChatRecord, 'pinnedIds'|'shownIds'|'hiddenIds'>} ChatMarks
 */

/** Where each mark is stored on a chat. */
const FIELDS = /** @type {const} */ ({
  pinned: 'pinnedIds',
  shown: 'shownIds',
  hidden: 'hiddenIds',
})

/**
 * The mark a chat put on this document itself, not on a folder above it.
 *
 * @param {ChatMarks|null|undefined} chat
 * @param {string} id
 * @returns {ChatMark|null}
 */
export function markOf(chat, id) {
  if (!chat) return null
  for (const [mark, field] of Object.entries(FIELDS)) {
    if (chat[field]?.includes(id)) return /** @type {ChatMark} */ (mark)
  }
  return null
}

/**
 * Put a mark on a document for a chat, or take it off.
 *
 * Taken off the other two first, so a document is in one state at most. A
 * list left empty is written as absent, so a chat that never marked anything
 * and one that has stopped read the same. Every mark is the writer's: the
 * model has none of its own.
 *
 * @param {ChatMarks|null|undefined} chat
 * @param {string} id
 * @param {ChatMark|null} mark - Null to leave it to the folders above
 * @returns {ChatMarks} The lists, to update the chat with
 */
export function withMark(chat, id, mark) {
  /** @type {ChatMarks} */
  const next = {}
  for (const [name, field] of Object.entries(FIELDS)) {
    const list = (chat?.[field] || []).filter(other => other !== id)
    if (name === mark) list.push(id)
    next[field] = list.length ? list : undefined
  }
  return next
}

/**
 * The chat's marks with a document let go of, wherever its pin came from.
 *
 * A pin of its own comes off. One it takes from a folder above stays the
 * folder's, and the document is marked shown instead: listed, readable, and
 * not carried. Either way the document stays in sight — letting go is not
 * hiding.
 *
 * @param {ChatMarks|null|undefined} chat
 * @param {TreeDocument} document
 * @param {(id: string) => TreeDocument|undefined|null} get - Documents by id
 * @returns {ChatMarks} The three lists, to update the chat with
 */
export function unpinned(chat, document, get) {
  const bare = withMark(chat, document.id, null)
  const byFolder = chatVisibility(bare, get).markFor(document) === 'pinned'
  return byFolder ? withMark(chat, document.id, 'shown') : bare
}

/**
 * How one chat reads a project: whether a document is there for it, and why.
 *
 * Each question walks up to the root at most once — answers are kept for the
 * life of the reader, which is one listing or one tool call. Make a new one
 * when the tree or the chat changes.
 *
 * @param {ChatMarks|null|undefined} chat - Null reads with no marks at all
 * @param {(id: string) => TreeDocument|undefined|null} get - Documents by id
 */
export function chatVisibility(chat, get) {
  /** @type {Map<string, {hidden: boolean, mark: ChatMark|null}>} */
  const known = new Map()

  /**
   * Whether anything from here up is hidden outright, and the nearest mark.
   * @param {TreeDocument} document
   * @returns {{hidden: boolean, mark: ChatMark|null}}
   */
  const settle = document => {
    const had = known.get(document.id)
    if (had) return had

    const parent = document.parentId ? get(document.parentId) : null
    const above = parent ? settle(parent) : { hidden: false, mark: null }
    const found = {
      hidden: Boolean(document.hidden) || above.hidden,
      mark: markOf(chat, document.id) ?? above.mark,
    }
    known.set(document.id, found)
    return found
  }

  return {
    /**
     * Whether the model in this chat may see a document.
     * @param {TreeDocument|null|undefined} document
     */
    sees(document) {
      if (!document) return false
      const { hidden, mark } = settle(document)
      return !hidden && mark !== 'hidden'
    },

    /**
     * Whether a document is out of sight for every chat: its own flag, or a
     * folder's above it.
     * @param {TreeDocument} document
     */
    hiddenEverywhere(document) {
      return settle(document).hidden
    },

    /**
     * The mark that decides for this document in this chat, its own or the
     * nearest folder's. Null when nothing above it is marked.
     * @param {TreeDocument} document
     * @returns {ChatMark|null}
     */
    markFor(document) {
      return settle(document).mark
    },
  }
}
