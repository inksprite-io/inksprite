/**
 * @module composables/useComments
 * @description The comments in a project, for the list in the sidebar and
 * the comment under the line: each document that has any, in outline order,
 * with its open comments where its text has them — the editor's, for a
 * document open in it, so the list keeps up with typing — its stale ones,
 * whose passages were deleted, and its resolved ones; and what the writer
 * does with one: go to it, write it, answer it, change what they said,
 * resolve it, open it again, and delete it or one of its replies. On the
 * desktop a new comment is written in the list too, on a passage the editor
 * holds for it (`commentDraft`), in its place among its document's comments.
 *
 * A comment is a marker in the text and a thread on the document's row (see
 * `editor/comments.js`). A thread is placed while its marker is in the text.
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
  newCommentId,
  newPost,
  newThread,
  placeThread,
  plainPassage,
  threadState,
  withoutComment,
} from '@/editor/comments.js'
import { replaceChanged } from '@/editor/state.js'
import { draftRange, withDraft } from '@/editor/commentDraft.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { isRepository } from '@/source/tree.js'

/** @typedef {import('@/editor/comments.js').CommentEntry} CommentEntry */
/** @typedef {import('@/types/models.js').CommentThread} CommentThread */
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
 * A new comment being written in the Comments tab, on a passage of a
 * document open in the editor: which document, and the words, for the list
 * to show. Where the passage is stays in the editor's state, which follows
 * the text (see `editor/commentDraft.js`). One at a time, app-wide.
 *
 * @typedef {{documentId: string, passage: string}} CommentDraft
 */

/** @type {import('vue').Ref<CommentDraft|null>} */
const draft = ref(null)

/** The new comment being written, for the list and the editor to read. */
export const commentDraft = readonly(draft)

/**
 * Begin a new comment on a passage, to be written in the list. The editor
 * has put the range in its state.
 *
 * @param {string} documentId
 * @param {string} passage - The words, as they read
 */
export const startDraft = (documentId, passage) => {
  draft.value = { documentId, passage }
}

/**
 * Forget the new comment, as the editor does once its passage is gone. The
 * range in the editor's state goes with it there.
 */
export const dropDraft = () => {
  draft.value = null
}

/**
 * Asked to answer a comment, from the text: counted, so that the list gives
 * the current comment's reply field the focus each time it is asked.
 */
const replyAsked = ref(0)

/** How many times a reply has been asked for: the list watches it. */
export const replyRequest = readonly(replyAsked)

/**
 * Answer a comment in the list: it is made current, and its reply field asked
 * to take the focus.
 *
 * @param {string} documentId
 * @param {string} id
 */
export const askReply = (documentId, id) => {
  goToComment(documentId, id)
  replyAsked.value++
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
 * A comment as the list shows it: its passage, its thread, and how it stands.
 *
 * @typedef {Object} ListedComment
 * @property {string} id
 * @property {string} passage - As it reads now, or as it last read
 * @property {CommentThread} thread
 * @property {'open'|'stale'|'resolved'} state
 */

/**
 * One document's comments, for the list: those on its text in the order the
 * text has them, then the stale ones, then the resolved ones.
 *
 * @typedef {Object} CommentGroup
 * @property {string} documentId
 * @property {string} path
 * @property {ListedComment[]} comments - The open ones, on the text
 * @property {ListedComment[]} stale - Open, with their passages gone
 * @property {ListedComment[]} resolved
 * @property {number|null} draftAt - Where among `comments` a new comment being
 *   written on this document goes, by where its passage is; null for none
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
   * Where a document's comments are in its text as it stands: the editor's
   * state, or the text the editor holds for a plain one, or the store's.
   *
   * @param {string} documentId
   * @returns {CommentEntry[]}
   */
  const placesOf = documentId => {
    const state = editor.stateOf(documentId)
    if (state) return ofDoc(state.doc)
    const content = editor.holds(documentId)
      ? editor.markdown(documentId)
      : api.get(documentId)?.content || ''
    return ofText(documentId, content)
  }

  /**
   * A document's comments, by how they stand. A marker with no thread is
   * not a comment: pasted from elsewhere, or typed.
   *
   * @param {string} documentId
   * @returns {CommentGroup|null} Null for a document with none
   */
  const groupOf = documentId => {
    const drafting = draft.value?.documentId === documentId
    const threads = api.threadsOf(documentId) || (drafting ? {} : null)
    if (!threads) return null
    const placed = placesOf(documentId).filter(entry => threads[entry.id])
    const on = new Set(placed.map(entry => entry.id))
    /** @type {CommentGroup} */
    const group = {
      documentId,
      path: api.pathOf(documentId),
      comments: placed.map(entry => ({
        id: entry.id,
        passage: entry.passage,
        thread: threads[entry.id],
        state: 'open',
      })),
      stale: [],
      resolved: [],
      draftAt: drafting ? draftPlace(documentId, placed) : null,
    }
    for (const [id, thread] of Object.entries(threads)) {
      if (on.has(id)) continue
      const state = threadState(thread, false)
      const listed = { id, passage: plainPassage(thread.quote), thread, state }
      if (state === 'stale') group.stale.push(listed)
      else if (state === 'resolved') group.resolved.push(listed)
    }
    return group
  }

  /**
   * Where a new comment goes among a document's open comments, in the order
   * of the text: after those whose passages start before its passage does.
   *
   * @param {string} documentId
   * @param {CommentEntry[]} placed - The open comments, in the text's order
   * @returns {number}
   */
  const draftPlace = (documentId, placed) => {
    const state = editor.stateOf(documentId)
    const range = state ? draftRange(state) : null
    if (!state || !range) return 0
    const before = new Set(
      commentRanges(state.doc)
        .filter(run => run.from < range.from)
        .map(run => run.id)
    )
    return placed.filter(entry => before.has(entry.id)).length
  }

  /** @type {import('vue').ComputedRef<CommentGroup[]>} */
  const groups = computed(() =>
    textIds.value.flatMap(documentId => {
      const group = groupOf(documentId)
      return group ? [group] : []
    })
  )

  /**
   * Change a document open in the editor from here. Changing a preview's text
   * is keeping it, as writing in it is.
   *
   * @param {string} documentId
   * @param {import('prosemirror-state').Transaction} tr
   */
  const change = (documentId, tr) => {
    editor.dispatch(documentId, tr)
    api.keep(documentId)
  }

  /**
   * Make the new comment: its thread, with what was said, and its marker on
   * the passage where the editor has it now. Outside the undo history, as a
   * comment made under the line was: undone, it would leave its thread with
   * nothing to be on. The comment is current once made.
   *
   * @param {string} text
   * @returns {string|null} Its id; null when there was nothing to make it on
   */
  const addDraft = text => {
    const held = draft.value
    const state = held ? editor.stateOf(held.documentId) : null
    const range = state ? draftRange(state) : null
    draft.value = null
    if (!held || !state || !range || !text.trim()) return null
    const id = newCommentId()
    begin(held.documentId, id, text, state.doc.textBetween(range.from, range.to))
    const type = state.schema.marks.comment
    const tr = withDraft(state.tr.addMark(range.from, range.to, type.create({ id })), null)
    change(held.documentId, tr.setMeta('addToHistory', false))
    goToComment(held.documentId, id)
    return id
  }

  /** Drop the new comment, and its passage's tint in the editor. */
  const cancelDraft = () => {
    const held = draft.value
    draft.value = null
    const state = held ? editor.stateOf(held.documentId) : null
    if (state && draftRange(state)) editor.dispatch(held.documentId, withDraft(state.tr, null))
  }

  /**
   * A comment's thread, as the row has it.
   *
   * @param {string} documentId
   * @param {string} id
   * @returns {CommentThread|null}
   */
  const threadOf = (documentId, id) => api.threadsOf(documentId)?.[id] || null

  /**
   * Put one thread in place of the one there, or take it away.
   *
   * @param {string} documentId
   * @param {string} id
   * @param {CommentThread|null} thread
   */
  const putThread = (documentId, id, thread) => {
    const threads = { ...api.threadsOf(documentId) }
    if (thread) threads[id] = thread
    else delete threads[id]
    api.setThreads(documentId, threads)
  }

  /**
   * The thread for a comment the writer has just made on a passage, whose
   * marker the editor puts on the text.
   *
   * @param {string} documentId
   * @param {string} id
   * @param {string} text - What they said
   * @param {string} quote - The passage
   */
  const begin = (documentId, id, text, quote) =>
    putThread(documentId, id, newThread(newPost('writer', text), quote))

  /**
   * The writer's answer, after what has been said.
   *
   * @param {string} documentId
   * @param {string} id
   * @param {string} text
   */
  const reply = (documentId, id, text) => {
    const thread = threadOf(documentId, id)
    if (!thread || !text.trim()) return
    putThread(documentId, id, { ...thread, posts: [...thread.posts, newPost('writer', text)] })
  }

  /**
   * Change what the writer said in one of their posts, any of them: the
   * model reads what it says now, and a rewind of a reply that came after it
   * leaves the thread as the writer has it.
   *
   * @param {string} documentId
   * @param {string} id
   * @param {number} index - Which post
   * @param {string} text
   */
  const editPost = (documentId, id, index, text) => {
    const thread = threadOf(documentId, id)
    const post = thread?.posts[index]
    if (!thread || post?.author !== 'writer' || !text.trim()) return
    const edited = { ...newPost('writer', text), created: post.created, edited: Date.now() }
    const posts = thread.posts.map((each, at) => (at === index ? edited : each))
    putThread(documentId, id, { ...thread, posts })
  }

  /**
   * Resolve a comment: its marker off the text, its passage left, its thread
   * kept, resolved. In a document open in the editor the marker comes off in
   * a change to its state, which leaves the caret and the scroll where they
   * are, and undoing it there opens the comment again.
   *
   * @param {string} documentId
   * @param {string} id
   */
  const resolve = (documentId, id) => {
    const thread = threadOf(documentId, id)
    if (!thread) return
    // The thread first, so the text's save finds it resolved and leaves it.
    putThread(documentId, id, { ...thread, status: 'resolved' })
    if (editor.stateOf(documentId)) offInEditor(documentId, id)
    else {
      const before = api.currentContent(documentId)
      const after = withoutComment(before, id)
      if (after !== before) api.setContent(documentId, after)
    }
    leaveComment(documentId)
  }

  /**
   * @param {string} documentId
   * @param {string} id
   * @param {boolean} [undoable] - Whether undoing in the editor puts it back
   */
  const offInEditor = (documentId, id, undoable = true) => {
    const state = /** @type {import('prosemirror-state').EditorState} */ (
      editor.stateOf(documentId)
    )
    // This comment's mark alone: another comment on the same words stays.
    const mark = state.schema.marks.comment.create({ id })
    const ranges = commentRanges(state.doc).filter(range => range.id === id)
    if (ranges.length === 0) return
    const tr = state.tr
    for (const range of ranges) tr.removeMark(range.from, range.to, mark)
    change(documentId, undoable ? tr : tr.setMeta('addToHistory', false))
  }

  /**
   * Open a resolved comment again, on its passage: where its words are once,
   * or once among repeats by the words that were around them.
   *
   * @param {string} documentId
   * @param {string} id
   * @returns {boolean} Whether it found its passage; it stays resolved otherwise
   */
  const reopen = (documentId, id) => {
    const thread = threadOf(documentId, id)
    if (!thread) return false
    const placed = placeThread(api.currentContent(documentId), id, thread)
    if (placed === null) return false
    putThread(documentId, id, { ...thread, status: 'open' })
    const state = editor.stateOf(documentId)
    if (state) {
      // Outside the undo history, as a new comment's marker is: undone, the
      // thread would be left open with nothing to be on.
      const tr = replaceChanged(state, placed)
      if (tr) change(documentId, tr.setMeta('addToHistory', false))
    } else api.setContent(documentId, placed)
    return true
  }

  /**
   * Delete a comment for good, thread and marker: open, stale or resolved.
   * In a document open in the editor the marker comes off outside the undo
   * history, since undone it would come back with no thread to show.
   *
   * @param {string} documentId
   * @param {string} id
   */
  const remove = (documentId, id) => {
    if (!threadOf(documentId, id)) return
    putThread(documentId, id, null)
    if (editor.stateOf(documentId)) offInEditor(documentId, id, false)
    else {
      const before = api.currentContent(documentId)
      const after = withoutComment(before, id)
      if (after !== before) api.setContent(documentId, after)
    }
    leaveComment(documentId)
  }

  /**
   * Delete one post: the first is the comment, and deletes it whole; any
   * other is a reply, and goes alone.
   *
   * @param {string} documentId
   * @param {string} id
   * @param {number} index
   */
  const deletePost = (documentId, id, index) => {
    const thread = threadOf(documentId, id)
    if (!thread || !thread.posts[index]) return
    if (index === 0) {
      remove(documentId, id)
      return
    }
    putThread(documentId, id, { ...thread, posts: thread.posts.filter((_, at) => at !== index) })
  }

  return {
    groups,
    current: currentComment,
    goTo: goToComment,
    leave: leaveComment,
    threadOf,
    begin,
    reply,
    editPost,
    resolve,
    reopen,
    remove,
    deletePost,
    draft: commentDraft,
    addDraft,
    cancelDraft,
    replyRequest,
  }
}
