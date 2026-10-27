/**
 * @module composables/useTreeHistory
 * @description Undo and redo for what the writer does in a project's
 * outline: making a document or a folder, renaming one, moving one, deleting
 * one.
 *
 * Command-Z in the outline takes the last of these back, and Shift-Command-Z
 * does it again, as Finder does with files. Only what the writer does in the
 * outline is kept: what a model, an import or sync does to the tree is not
 * theirs to take back with a key, and the editor keeps the text's own
 * history.
 *
 * A step is taken back only from where it left things. A document renamed,
 * moved or deleted since is not put back over what happened after: the step
 * is let go of, and the key does nothing. A delete is taken back out of the
 * trash, so a delete is kept only where deletes go there.
 *
 * Taking back the making of a document deletes it, with whatever was written
 * in it since. It goes to the trash, and comes back out of it on a redo.
 *
 * One history per project, for as long as the page is open.
 */

import { shallowRef } from 'vue'
import { useDocuments } from '@/composables/useDocuments.js'
import { useDocumentsStore } from '@/stores/documentsStore'

/** How many steps are kept to take back. */
export const LIMIT = 100

const isMac = /Mac|iP(hone|ad|od)/.test(
  (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || ''
)

/**
 * Whether a key is undo or redo: Command-Z and Shift-Command-Z on a Mac,
 * Control-Z and Control-Y or Shift-Control-Z elsewhere.
 *
 * @param {KeyboardEvent} event
 * @returns {'undo'|'redo'|null}
 */
export function undoKeyOf(event) {
  const command = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!command || event.altKey) return null
  const key = event.key?.toLowerCase()
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !isMac && !event.shiftKey) return 'redo'
  return null
}

/**
 * @typedef {Object} Step
 * @property {'Create'|'Duplicate'|'Rename'|'Move'|'Delete'} verb - What the writer did
 * @property {string} documentId - What it was done to
 * @property {string} title - What it was called when it was done, for when it has gone since
 * @property {() => boolean} undo - Take it back, unless something since is in the way
 * @property {() => boolean} redo - Do it again, likewise
 */

/**
 * Where a document is: its folder, its name, and the folder's documents in
 * their order, itself among them.
 *
 * @typedef {Object} Place
 * @property {string} parentId
 * @property {string} title
 * @property {string[]} order
 */

/**
 * Each project's history, kept with its documents' instance and gone with it.
 * @type {WeakMap<object, ReturnType<typeof makeHistory>>}
 */
const histories = new WeakMap()

/**
 * @param {ReturnType<typeof useDocuments>} api - The project's documents
 */
const makeHistory = api => {
  const store = useDocumentsStore()

  /** What can be taken back, the last done last. @type {import('vue').ShallowRef<Step[]>} */
  const done = shallowRef([])
  /** What was taken back and can be done again, the last taken back last. @type {import('vue').ShallowRef<Step[]>} */
  const undone = shallowRef([])

  /** @param {Step} step */
  const push = step => {
    done.value = [...done.value.slice(1 - LIMIT), step]
    undone.value = []
  }

  /** @param {string} documentId */
  const inTrash = documentId => !!store.getTrashedDocument(documentId)?.trashed

  /**
   * What the document a step was taken on is called now, or was last.
   * @param {Step} step
   */
  const titleOf = step => {
    const document = api.get(step.documentId) || store.getTrashedDocument(step.documentId)
    return document ? api.displayTitle(document) : step.title || 'Untitled'
  }

  /**
   * What a step reads as, as Finder's Edit menu says it: `Rename “Notes”`.
   * @param {Step} step
   */
  const labelOf = step => `${step.verb} “${titleOf(step)}”`

  /**
   * A document has been made: a new one, or a copy. Taking it back deletes it.
   * @param {string} documentId
   * @param {'Create'|'Duplicate'} [verb]
   */
  const created = (documentId, verb = 'Create') =>
    push({
      verb,
      documentId,
      title: api.editableTitle(documentId),
      undo: () => {
        if (!api.get(documentId)) return false
        api.trash(documentId)
        return true
      },
      redo: () => {
        if (!inTrash(documentId)) return false
        api.restore(documentId)
        return true
      },
    })

  /**
   * Put a document's name back from one to another, if it still has the one.
   * @param {string} documentId
   * @param {string} from
   * @param {string} to
   */
  const retitle = (documentId, from, to) =>
    !!api.get(documentId) && api.editableTitle(documentId) === from && api.rename(documentId, to)

  /**
   * Rename a document, as `useDocuments.rename` does, and keep the step.
   * @param {string} documentId
   * @param {string} title
   * @returns {boolean} Whether it was renamed
   */
  const rename = (documentId, title) => {
    const from = api.editableTitle(documentId)
    if (!api.rename(documentId, title)) return false
    // The project's own name can come out numbered.
    const to = api.editableTitle(documentId)
    if (to !== from) {
      push({
        verb: 'Rename',
        documentId,
        title: from,
        undo: () => retitle(documentId, to, from),
        redo: () => retitle(documentId, from, to),
      })
    }
    return true
  }

  /**
   * Move a document to the trash, and keep the step. Without the trash a
   * delete is for good, and is not this.
   * @param {string} documentId
   */
  const trash = documentId => {
    const title = api.editableTitle(documentId)
    api.trash(documentId)
    push({
      verb: 'Delete',
      documentId,
      title,
      undo: () => {
        if (!inTrash(documentId)) return false
        api.restore(documentId)
        return true
      },
      redo: () => {
        if (!api.get(documentId)) return false
        api.trash(documentId)
        return true
      },
    })
  }

  /**
   * @param {string} documentId
   * @returns {Place|null}
   */
  const placeOf = documentId => {
    const document = api.get(documentId)
    if (!document?.parentId) return null
    return {
      parentId: document.parentId,
      title: document.title,
      order: api.childrenOf(document.parentId).map(child => child.id),
    }
  }

  /**
   * @param {Place} a
   * @param {Place} b
   */
  const samePlace = (a, b) =>
    a.parentId === b.parentId &&
    a.title === b.title &&
    a.order.length === b.order.length &&
    a.order.every((id, at) => id === b.order[at])

  /**
   * Put a document back where it was, if it is still where it was put and
   * what it was in is still there: into that folder, or the document it was
   * taken out of, among what is still there in the order they had, and under
   * its name, unless something there has taken it since.
   * @param {string} documentId
   * @param {Place} now - Where it was put
   * @param {Place} then - Where it goes back to
   */
  const replace = (documentId, now, then) => {
    const document = api.get(documentId)
    if (!document || document.parentId !== now.parentId || document.title !== now.title) {
      return false
    }
    if (!api.get(then.parentId)) return false
    api.keepingLinks(() => {
      const there = api
        .childrenOf(then.parentId)
        .map(child => child.id)
        .filter(id => id !== documentId)
      const order = then.order.filter(id => id === documentId || there.includes(id))
      api.reorder(then.parentId, [...order, ...there.filter(id => !order.includes(id))])
      if (api.get(documentId)?.title !== then.title) api.rename(documentId, then.title)
    })
    return api.get(documentId)?.parentId === then.parentId
  }

  /**
   * Where the document being dragged started from: a drag is several writes,
   * one for each folder it touches, and one step.
   * @type {{documentId: string, from: Place}|null}
   */
  let moving = null

  /**
   * A drag has begun.
   * @param {string} documentId
   */
  const beginMove = documentId => {
    const from = placeOf(documentId)
    moving = from ? { documentId, from } : null
  }

  /**
   * The drag is over. A step is kept if it changed anything: the document's
   * folder, its name, or where it is among the rest.
   */
  const endMove = () => {
    const start = moving
    moving = null
    if (!start) return
    const { documentId, from } = start
    const to = placeOf(documentId)
    if (!to || samePlace(from, to)) return
    push({
      verb: 'Move',
      documentId,
      title: from.title,
      undo: () => replace(documentId, to, from),
      redo: () => replace(documentId, from, to),
    })
  }

  /**
   * The drag went out of the outline, into the text or a chat, to link the
   * document there: whatever it moved on the way goes back, and no step is
   * kept.
   */
  const cancelMove = () => {
    const start = moving
    moving = null
    if (!start) return
    const to = placeOf(start.documentId)
    if (to && !samePlace(start.from, to)) replace(start.documentId, to, start.from)
  }

  /**
   * Take a step from one list, try it, and put it on the other if it went.
   * One that cannot be taken is let go of.
   * @param {import('vue').ShallowRef<Step[]>} from
   * @param {import('vue').ShallowRef<Step[]>} to
   * @param {'undo'|'redo'} way
   * @returns {{documentId: string, done: boolean}|null} Null with nothing to take
   */
  const take = (from, to, way) => {
    const step = from.value.at(-1)
    if (!step) return null
    from.value = from.value.slice(0, -1)
    const done = step[way]()
    if (done) to.value = [...to.value, step]
    return { documentId: step.documentId, done }
  }

  return {
    /** The step an undo would take back, if any. */
    nextUndo: () => done.value.at(-1) ?? null,
    /** The step a redo would do again, if any. */
    nextRedo: () => undone.value.at(-1) ?? null,
    labelOf,
    created,
    rename,
    trash,
    beginMove,
    endMove,
    cancelMove,
    undo: () => take(done, undone, 'undo'),
    redo: () => take(undone, done, 'redo'),
  }
}

/**
 * The outline's history for a project.
 * @param {string} storyId
 */
export function useTreeHistory(storyId) {
  const api = useDocuments(storyId)
  let history = histories.get(api)
  if (!history) {
    history = makeHistory(api)
    histories.set(api, history)
  }
  return history
}
