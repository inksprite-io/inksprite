/**
 * @module composables/useComments
 * @description The writer's comments in a project, for the list in the
 * sidebar: each document that holds any, in outline order, with its comments
 * as they stand — the editor's, for a document open in it, so the list keeps
 * up with typing — and the two things the list does with one: go to it, and
 * resolve it.
 *
 * Going to a comment makes it the current one, which is app-wide so that the
 * list and the editor agree on it: the editor scrolls to it and marks it, and
 * may only take that up once the document it is in has opened. The caret in
 * a comment in the text makes it current too, and the list shows which.
 */

import { computed, readonly, ref } from 'vue'
import { useDocuments } from './useDocuments.js'
import { useEditor } from './useEditor.js'
import {
  commentRanges,
  commentsInDoc,
  commentsInMarkdown,
  findComments,
} from '@/editor/comments.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { isRepository } from '@/source/tree.js'

/** @typedef {import('@/editor/comments.js').CommentEntry} CommentEntry */
/** @typedef {import('prosemirror-model').Node} Node */

/**
 * The comment gone to last. `seq` counts the goings, so going to the same
 * comment again is asked again: the writer has scrolled away since.
 *
 * @typedef {{documentId: string, id: string, seq: number}} CurrentComment
 */

/** @type {import('vue').Ref<CurrentComment|null>} */
const current = ref(null)
let goings = 0
/** The going an editor has taken up: each is taken once, by the view it was for. */
let takenUp = 0

/** The comment gone to last, for the editor and the list to read. */
export const currentComment = readonly(current)

/**
 * Make a comment the current one, which the editor showing its document
 * scrolls to and marks.
 *
 * @param {string} documentId
 * @param {string} id
 */
export const goToComment = (documentId, id) => {
  current.value = { documentId, id, seq: ++goings }
}

/**
 * The current comment, if it was gone to in this document and no view has
 * scrolled to it yet. Asked by the editor when the comment changes and when
 * it opens a document, which is how a comment in a document that was not
 * showing is reached; a view opening on a tab the writer comes back to later
 * finds it taken, and stays where the writer left it.
 *
 * @param {string} documentId
 * @returns {CurrentComment|null}
 */
export const takeUpComment = documentId => {
  const going = current.value
  if (!going || going.documentId !== documentId || going.seq === takenUp) return null
  takenUp = going.seq
  return going
}

/**
 * Let the current comment go, when the writer has moved on from it in the
 * text. Only that document's: another's stays current.
 *
 * @param {string} documentId
 */
export const leaveComment = documentId => {
  if (current.value?.documentId === documentId) current.value = null
}

/**
 * A document's comments, worked out once for each version of it: an editor
 * document is immutable, and markdown is kept beside what it was read from.
 * Most keystrokes change one document, and the list asks after them all.
 */
/** @type {WeakMap<Node, CommentEntry[]>} */
const fromDocs = new WeakMap()
/** @type {Map<string, {content: string, entries: CommentEntry[]}>} */
const fromText = new Map()

/** @param {Node} doc */
const ofDoc = doc => {
  let entries = fromDocs.get(doc)
  if (!entries) fromDocs.set(doc, (entries = commentsInDoc(doc)))
  return entries
}

/**
 * @param {string} documentId
 * @param {string} content
 */
const ofText = (documentId, content) => {
  const held = fromText.get(documentId)
  if (held?.content === content) return held.entries
  const entries = commentsInMarkdown(content)
  fromText.set(documentId, { content, entries })
  return entries
}

/**
 * One document's comments, for the list.
 *
 * @typedef {Object} CommentGroup
 * @property {string} documentId
 * @property {string} path
 * @property {CommentEntry[]} comments
 */

/**
 * @param {string} storyId
 */
export function useComments(storyId) {
  const api = useDocuments(storyId)
  const editor = useEditor()

  /** The text documents, in the outline's order. A repository is code, and holds none. */
  const textIds = computed(() => {
    /** @type {string[]} */
    const ids = []
    const walk = (/** @type {string} */ parentId) => {
      for (const child of api.childrenOf(parentId)) {
        if (child.type === 'text') ids.push(child.id)
        else if (child.type === 'folder' && !isRepository(child)) walk(child.id)
      }
    }
    walk(rootIdFor(storyId))
    return ids
  })

  /**
   * A document's comments as it stands: the editor's state, or the text the
   * editor holds for a plain one, or the store's.
   *
   * @param {string} documentId
   * @returns {CommentEntry[]}
   */
  const commentsOf = documentId => {
    const state = editor.stateOf(documentId)
    if (state) return ofDoc(state.doc)
    const content = editor.holds(documentId)
      ? editor.markdown(documentId)
      : api.get(documentId)?.content || ''
    return ofText(documentId, content)
  }

  /** @type {import('vue').ComputedRef<CommentGroup[]>} */
  const groups = computed(() =>
    textIds.value.flatMap(documentId => {
      const comments = commentsOf(documentId)
      return comments.length ? [{ documentId, path: api.pathOf(documentId), comments }] : []
    })
  )

  /**
   * Take a comment off and leave its passage.
   *
   * In a document open in the editor this is a change to its state, which
   * leaves the caret and the scroll where they are and is undone in the
   * editor as well. Elsewhere it is the markup taken out of the text.
   *
   * @param {string} documentId
   * @param {string} id
   */
  const resolve = (documentId, id) => {
    const resolved = editor.stateOf(documentId)
      ? resolveInEditor(documentId, id)
      : resolveInText(documentId, id)
    if (resolved) leaveComment(documentId)
  }

  /**
   * @param {string} documentId
   * @param {string} id
   * @returns {boolean} Whether the comment was there
   */
  const resolveInEditor = (documentId, id) => {
    const state = /** @type {import('prosemirror-state').EditorState} */ (
      editor.stateOf(documentId)
    )
    const type = state.schema.marks.comment
    const ranges = commentRanges(state.doc).filter(range => range.id === id)
    if (ranges.length === 0) return false

    const tr = state.tr
    for (const range of ranges) tr.removeMark(range.from, range.to, type)
    editor.dispatch(documentId, tr)
    return true
  }

  /**
   * @param {string} documentId
   * @param {string} id
   * @returns {boolean} Whether the comment was there
   */
  const resolveInText = (documentId, id) => {
    const before = api.currentContent(documentId)
    let after = before
    for (const found of findComments(before)) {
      if (found.id === id) after = after.replace(found.markup, () => found.text)
    }
    if (after === before) return false

    api.setContent(documentId, after)
    return true
  }

  return { groups, current: currentComment, goTo: goToComment, resolve }
}
