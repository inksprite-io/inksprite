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
 * A suggestion is listed among them, in the text's order, as Docs lists
 * them: its thread is on the row too, and its place is the change itself,
 * marks holding its id (see `editor/suggestions.js`). The writer accepts or
 * rejects it where a comment is resolved. In a document open in the editor
 * that is a change to its state, which undoing takes back, and the thread
 * is open again once its marks are.
 *
 * What the writer does to a comment or a suggestion is noted, for Mod-Z in
 * the Comments tab to take back and Shift-Mod-Z to do again, while what it
 * changed is as it left it (`undo`, `redo`).
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
  commentsGone,
  commentsInDoc,
  commentsInMarkdown,
  newCommentId,
  newPost,
  newThread,
  placeThread,
  plainPassage,
  sameThread,
  threadState,
  withoutComment,
} from '@/editor/comments.js'
import { replaceChanged } from '@/editor/state.js'
import { closeHistory, undo, undoDepth } from 'prosemirror-history'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { settling, suggestionEntries } from '@/editor/suggestions.js'
import { holdsSuggestions } from '@/editor/suggestionText.js'
import { draftRange, withDraft } from '@/editor/commentDraft.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { isRepository } from '@/source/tree.js'
import { byMe, isMine, peopleOf } from '@/cloud/people.js'

/** @typedef {import('@/editor/comments.js').CommentEntry} CommentEntry */
/** @typedef {import('@/types/models.js').CommentThread} CommentThread */
/** @typedef {import('prosemirror-model').Node} Node */
/** @typedef {import('prosemirror-state').Transaction} Transaction */

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
 * Something the writer did to a comment or a suggestion, for Mod-Z in the
 * Comments tab to take back and Shift-Mod-Z to do again: there the focus is
 * not in the text, whose own undo would take it back. Each is taken back
 * only while what it changed is as it left it.
 *
 * @typedef {Object} Done
 * @property {string} storyId - The project it was done in
 * @property {() => boolean} undo - Take it back, if it still can be
 * @property {() => boolean} redo - Do it again, if it still can be
 */

/** What has been done, the last last. @type {Done[]} */
const done = []
/** What has been taken back, the last taken back last. @type {Done[]} */
const undone = []

/**
 * Note something done. Doing anything new leaves nothing to do again.
 *
 * @param {Done} did
 */
const noteDone = did => {
  done.push(did)
  undone.length = 0
}

/**
 * Take back the last thing done in a project that still can be, or do again
 * the last taken back. One that no longer can be is forgotten.
 *
 * @param {Done[]} from
 * @param {Done[]} to
 * @param {'undo'|'redo'} how
 * @param {string} storyId
 * @returns {boolean} Whether anything was
 */
const replay = (from, to, how, storyId) => {
  for (let at = from.length - 1; at >= 0; at--) {
    const did = from[at]
    if (did.storyId !== storyId) continue
    from.splice(at, 1)
    if (did[how]()) {
      to.push(did)
      return true
    }
  }
  return false
}

/** Forget everything done, as a test starts. */
export const forgetDone = () => {
  done.length = 0
  undone.length = 0
}

/**
 * A comment's place, or a suggestion's with what it changes, and where it
 * starts in an editor document.
 *
 * @typedef {CommentEntry & {from?: number, change?: {out: string, in: string}}} PlacedEntry
 */

/**
 * A document's comments and suggestions, worked out once for each version of
 * it: an editor document is immutable, and markdown is kept beside what it
 * was read from. Most keystrokes change one document, and the list asks
 * after them all.
 */
/** @type {WeakMap<Node, PlacedEntry[]>} */
const fromDocs = new WeakMap()
/** @type {Map<string, {content: string, entries: PlacedEntry[]}>} */
const fromText = new Map()

/**
 * The comments and suggestions in an editor document, in the order they
 * start.
 *
 * @param {Node} doc
 * @returns {PlacedEntry[]}
 */
const placedIn = doc => {
  const suggested = suggestionEntries(doc).map(({ id, from, change }) => ({
    id,
    from,
    passage: change.out || change.in,
    change,
  }))
  /** @type {Map<string, number>} */
  const starts = new Map()
  for (const range of commentRanges(doc))
    if (!starts.has(range.id)) starts.set(range.id, range.from)
  const commented = commentsInDoc(doc).map(entry => ({ ...entry, from: starts.get(entry.id) }))
  if (suggested.length === 0) return commented
  return [...commented, ...suggested].sort((a, b) => (a.from ?? 0) - (b.from ?? 0))
}

/** @param {Node} doc */
const ofDoc = doc => {
  let entries = fromDocs.get(doc)
  if (!entries) fromDocs.set(doc, (entries = placedIn(doc)))
  return entries
}

/**
 * Markdown with suggestions is read as a document, since only the parser
 * tells their marks; without, its comments are found in the text.
 *
 * @param {string} documentId
 * @param {string} content
 */
const ofText = (documentId, content) => {
  const held = fromText.get(documentId)
  if (held?.content === content) return held.entries
  const entries = holdsSuggestions(content)
    ? placedIn(parseMarkdown(content))
    : commentsInMarkdown(content)
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
 * @property {{out: string, in: string}} [change] - A suggestion's: what it
 *   takes out and puts in, as it reads now, or as it last read
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
   * Where a document's comments and suggestions are in its text as it
   * stands: the editor's state, or the text the editor holds for a plain
   * one, or the store's.
   *
   * @param {string} documentId
   * @returns {PlacedEntry[]}
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
        ...(entry.change ? { change: entry.change } : {}),
      })),
      stale: [],
      resolved: [],
      draftAt: drafting ? draftPlace(documentId, placed) : null,
    }
    for (const [id, thread] of Object.entries(threads)) {
      if (on.has(id)) continue
      const state = threadState(thread, false)
      // A suggestion's change as it last read: what it took out, and put in.
      const change = thread.suggestion && { out: thread.quote, in: thread.suggestion.text }
      const passage = change ? change.out || change.in : plainPassage(thread.quote)
      const listed = { id, passage, thread, state, ...(change ? { change } : {}) }
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
   * @param {PlacedEntry[]} placed - The open comments and suggestions, in the text's order
   * @returns {number}
   */
  const draftPlace = (documentId, placed) => {
    const state = editor.stateOf(documentId)
    const range = state ? draftRange(state) : null
    if (!state || !range) return 0
    return placed.filter(entry => (entry.from ?? 0) < range.from).length
  }

  /** @type {import('vue').ComputedRef<CommentGroup[]>} */
  const groups = computed(() =>
    textIds.value.flatMap(documentId => {
      const group = groupOf(documentId)
      return group ? [group] : []
    })
  )

  /** The last change made here to a document open in the editor, for `noted`. */
  let lastChange = /** @type {Transaction|null} */ (null)

  /**
   * Change a document open in the editor from here. Changing a preview's text
   * is keeping it, as writing in it is.
   *
   * @param {string} documentId
   * @param {Transaction} tr
   */
  const change = (documentId, tr) => {
    lastChange = tr
    editor.dispatch(documentId, tr)
    api.keep(documentId)
  }

  /**
   * A document's threads as they are, a copy of its own to be put back.
   *
   * @param {string} documentId
   * @returns {Record<string, CommentThread>}
   */
  const threadsNow = documentId => JSON.parse(JSON.stringify(api.threadsOf(documentId) ?? {}))

  /**
   * What doing something changed, to take it back: the threads it changed,
   * as they were and as it left them, and the text, in an editor document
   * the change it made there, and in another what it said before and after.
   *
   * @typedef {Object} Taken
   * @property {Record<string, CommentThread>} threads
   * @property {Record<string, CommentThread>} after
   * @property {string[]} ids - The threads it changed
   * @property {Transaction|null} tr
   * @property {number} depth - How many steps the editor's history had after it
   * @property {{before: string, after: string}|null} content
   */

  /**
   * Do something to a document's comments, and note it to be taken back from
   * the Comments tab (see `undo`) and done again. Taken back, its threads
   * are as they were, and its text: in an editor document by its undo
   * history where the change went into it, so that the step taken is the
   * one Mod-Z in the text would take, and otherwise by the change undone
   * outside it; in another by putting back what it said. Each only while it
   * is as this left it.
   *
   * @param {string} documentId
   * @param {() => boolean} act - Does it, saying whether it did
   * @returns {boolean} Whether it did
   */
  const noted = (documentId, act) => {
    /** @type {Taken} */
    let taken
    const run = () => {
      const state = editor.stateOf(documentId)
      const threads = threadsNow(documentId)
      const content = state ? null : api.currentContent(documentId)
      lastChange = null
      if (!act()) return false
      const after = threadsNow(documentId)
      const ids = [...new Set([...Object.keys(threads), ...Object.keys(after)])].filter(
        id => JSON.stringify(threads[id]) !== JSON.stringify(after[id])
      )
      const now = content === null ? null : api.currentContent(documentId)
      taken = {
        threads,
        after,
        ids,
        tr: state && lastChange?.docChanged ? lastChange : null,
        depth: state ? undoDepth(editor.stateOf(documentId)) : 0,
        content:
          content !== null && now !== null && now !== content
            ? { before: content, after: now }
            : null,
      }
      return true
    }
    if (!run()) return false
    noteDone({ storyId, undo: () => takeBack(documentId, taken), redo: run })
    return true
  }

  /**
   * @param {string} documentId
   * @param {Taken} taken
   * @returns {boolean} Whether it could be taken back
   */
  const takeBack = (documentId, taken) => {
    const current = api.threadsOf(documentId) ?? {}
    if (!taken.ids.every(id => sameThread(current[id], taken.after[id]))) return false
    const state = editor.stateOf(documentId)
    const { tr, content } = taken
    // The text as it left it, though another change and its undoing may lie
    // between; through the history, with the step it made the last there.
    if (tr && !state?.doc.eq(tr.doc)) return false
    const inHistory = tr?.getMeta('addToHistory') !== false
    if (tr && state && inHistory && undoDepth(state) !== taken.depth) return false
    if (content && api.currentContent(documentId) !== content.after) return false
    // The threads first, so the text's save finds them as they were.
    const threads = { ...current }
    for (const id of taken.ids) {
      if (taken.threads[id]) threads[id] = taken.threads[id]
      else delete threads[id]
    }
    api.setThreads(documentId, threads)
    if (tr && state) {
      if (inHistory) undo(state, next => change(documentId, next))
      else {
        const back = state.tr
        for (let i = tr.steps.length - 1; i >= 0; i--) back.step(tr.steps[i].invert(tr.docs[i]))
        change(documentId, back.setMeta('addToHistory', false))
      }
    } else if (content) api.editContent(documentId, content.before)
    return true
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
    putThread(documentId, id, newThread(byMe(newPost('writer', text)), quote))

  /**
   * The writer's answer, after what has been said.
   *
   * @param {string} documentId
   * @param {string} id
   * @param {string} text
   */
  const reply = (documentId, id, text) =>
    noted(documentId, () => {
      const thread = threadOf(documentId, id)
      if (!thread || !text.trim()) return false
      const post = byMe(newPost('writer', text))
      putThread(documentId, id, { ...thread, posts: [...thread.posts, post] })
      return true
    })

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
  const editPost = (documentId, id, index, text) =>
    noted(documentId, () => {
      const thread = threadOf(documentId, id)
      const post = thread?.posts[index]
      if (!thread || !post || !isMine(post, peopleOf(storyId)) || !text.trim()) return false
      const edited = { ...byMe(newPost('writer', text)), created: post.created, edited: Date.now() }
      const posts = thread.posts.map((each, at) => (at === index ? edited : each))
      putThread(documentId, id, { ...thread, posts })
      return true
    })

  /**
   * Resolve a comment: its marker off the text, its passage left, its thread
   * kept, resolved. In a document open in the editor the marker comes off in
   * a change to its state, which leaves the caret and the scroll where they
   * are, and undoing it there opens the comment again.
   *
   * @param {string} documentId
   * @param {string} id
   */
  const resolve = (documentId, id) =>
    noted(documentId, () => {
      const thread = threadOf(documentId, id)
      if (!thread) return false
      // The thread first, so the text's save finds it resolved and leaves it.
      putThread(documentId, id, { ...thread, status: 'resolved' })
      if (editor.stateOf(documentId)) offInEditor(documentId, id)
      else {
        const before = api.currentContent(documentId)
        const after = withoutComment(before, id)
        if (after !== before) api.setContent(documentId, after)
      }
      leaveComment(documentId)
      return true
    })

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
    // A step of its own in the history, which undoing from the list takes back.
    const tr = closeHistory(state.tr)
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
  const reopen = (documentId, id) =>
    noted(documentId, () => {
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
    })

  /**
   * Delete a comment, thread and marker: open, stale or resolved. In a
   * document open in the editor the marker comes off outside the undo
   * history, since undone there it would come back with no thread to show;
   * undone from the list, the two come back together.
   *
   * @param {string} documentId
   * @param {string} id
   */
  const remove = (documentId, id) => noted(documentId, () => removing(documentId, id))

  /**
   * @param {string} documentId
   * @param {string} id
   * @returns {boolean} Whether there was a comment to delete
   */
  const removing = (documentId, id) => {
    if (!threadOf(documentId, id)) return false
    putThread(documentId, id, null)
    if (editor.stateOf(documentId)) offInEditor(documentId, id, false)
    else {
      const before = api.currentContent(documentId)
      const after = withoutComment(before, id)
      if (after !== before) api.setContent(documentId, after)
    }
    leaveComment(documentId)
    return true
  }

  /**
   * Accept a suggestion or reject it: its change made, or its marks and what
   * it would have put in taken away. Its thread is kept, resolved, saying
   * which and when, for the model to be told. Accepting resolves the comments
   * whose passages it takes out, as an edit does. In a document open in the
   * editor it is a change to its state, which undoing takes back, the thread
   * open again with its marks.
   *
   * @param {string} documentId
   * @param {string} id
   * @param {boolean} accepted
   * @returns {boolean} Whether it was there to settle
   */
  const settle = (documentId, id, accepted) => {
    const thread = threadOf(documentId, id)
    if (!thread?.suggestion) return false
    const state = editor.stateOf(documentId)
    const before = state ? state.doc : parseMarkdown(api.currentContent(documentId))
    const steps = settling(before, id, accepted)
    // Its marks are its place: with none in the text it has been settled.
    if (!steps.docChanged) return false
    // The threads first, so the text's save finds them settled and leaves them.
    const threads = { ...api.threadsOf(documentId) }
    const suggestion = { ...thread.suggestion, settled: accepted ? 'accepted' : 'rejected' }
    threads[id] = {
      ...thread,
      status: 'resolved',
      suggestion: { ...suggestion, settledAt: Date.now() },
    }
    for (const gone of commentsGone(before, steps.doc)) {
      if (threads[gone] && !threads[gone].suggestion) {
        threads[gone] = { ...threads[gone], status: 'resolved' }
      }
    }
    api.setThreads(documentId, threads)
    if (state) {
      // A step of its own in the history, which undoing from the list takes back.
      const tr = closeHistory(state.tr)
      for (const step of steps.steps) tr.step(step)
      change(documentId, tr)
    } else api.setContent(documentId, serializeMarkdown(steps.doc))
    leaveComment(documentId)
    return true
  }

  /**
   * @param {string} documentId
   * @param {string} id
   */
  const accept = (documentId, id) => noted(documentId, () => settle(documentId, id, true))

  /**
   * @param {string} documentId
   * @param {string} id
   */
  const reject = (documentId, id) => noted(documentId, () => settle(documentId, id, false))

  /**
   * Delete one post: the first is the comment, and deletes it whole; any
   * other is a reply, and goes alone. A suggestion's posts are all replies:
   * the change is what it says.
   *
   * @param {string} documentId
   * @param {string} id
   * @param {number} index
   */
  const deletePost = (documentId, id, index) =>
    noted(documentId, () => {
      const thread = threadOf(documentId, id)
      if (!thread || !thread.posts[index]) return false
      if (index === 0 && !thread.suggestion) return removing(documentId, id)
      putThread(documentId, id, { ...thread, posts: thread.posts.filter((_, at) => at !== index) })
      return true
    })

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
    accept,
    reject,
    draft: commentDraft,
    addDraft,
    cancelDraft,
    replyRequest,
    /** Take back the last thing done to a comment or a suggestion here. */
    undo: () => replay(done, undone, 'undo', storyId),
    /** Do again the last thing taken back. */
    redo: () => replay(undone, done, 'redo', storyId),
  }
}
