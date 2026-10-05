/**
 * @module composables/useEditor
 * @description The open documents. One entry per document open in the editor,
 * app-wide, kept for as long as the document is open.
 *
 * A structured document opens as an `EditorState`, and while it is open that
 * state is the truth: every change — a keystroke, an AI append, an undo — is
 * a transaction dispatched here. A plain document opens as its text, and the
 * text is the truth: what is typed replaces it, and an outside write lands on
 * it as it is, never settled. Either way the store's copy is a projection,
 * serialized on a debounce, on blur, on close, and on `flush()`. `flush()`
 * with no id writes out every open document, and is called before anything
 * reads the store expecting the latest text, the way a backup is taken.
 * Closed, the store's markdown is the truth and writes go there. There is
 * never a moment when both are authoritative for the same document.
 *
 * `useDocuments` owns the routing between the two: a writer that wants to
 * change a document asks it, and it asks here only when the document is open.
 * Nothing else should. `Editor.vue` puts a view in front of a structured
 * document's state and hands transactions back through `dispatch`;
 * `RawMarkdown.vue` puts a field in front of a plain document's text and
 * hands what is typed back through `setText`. The registry is reactive to
 * that extent: a computed over `markdown(id)` follows the document as it
 * changes.
 */

import { shallowReactive } from 'vue'
import {
  createEditorState,
  appendContent as appendTo,
  replaceContent as replaceIn,
} from '@/editor/state.js'
import { appendBlocks, serializeMarkdown } from '@/editor/markdown.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Transaction} Transaction
 *
 * The part of an `EditorView` the state layer talks to.
 * @typedef {Object} View
 * @property {(state: EditorState) => void} updateState
 * @property {() => void} focus
 *
 * A structured document, open.
 * @typedef {Object} DocumentEntry
 * @property {'document'} kind
 * @property {EditorState} state
 * @property {View|null} view - The view showing the state, if one is
 * @property {boolean} dirty - Changed since the store last heard
 * @property {ReturnType<typeof setTimeout>|null} timer - The projection, pending
 * @property {number} scrollTop - Where the view was scrolled to when it last went
 *
 * A plain document, open: its text, as typed.
 * @typedef {Object} TextEntry
 * @property {'text'} kind
 * @property {string} text
 * @property {boolean} dirty
 * @property {ReturnType<typeof setTimeout>|null} timer
 * @property {number} scrollTop
 *
 * @typedef {DocumentEntry|TextEntry} Entry
 */

/** How long typing can go on before the store hears about it, in ms. */
export const PROJECTION_DELAY = 500

/** @type {Map<string, Entry>} */
const entries = shallowReactive(new Map())

/** Drop every open document without writing anything out. For tests. */
export const clearEditor = () => {
  for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer)
  entries.clear()
}

/**
 * A document's body as it stands in its entry.
 * @param {Entry} entry
 * @returns {string}
 */
const contentOf = entry => (entry.kind === 'text' ? entry.text : serializeMarkdown(entry.state.doc))

/**
 * Write one document to the store, if anything has changed since the last
 * time. A document deleted while open has nowhere to be written to; what was
 * typed since the last projection goes with it.
 *
 * @param {string} id
 * @param {Entry} entry
 */
const flushEntry = (id, entry) => {
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
  if (!entry.dirty) return
  entry.dirty = false
  const store = useDocumentsStore()
  if (!store.getDocument(id)) return
  store.updateDocument(id, { content: contentOf(entry) })
}

/**
 * @param {string} id
 * @param {Entry} entry
 */
const markDirty = (id, entry) => {
  entry.dirty = true
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => flushEntry(id, entry), PROJECTION_DELAY)
}

/**
 * A fresh entry of one kind or the other. Shallow: the state is read as a
 * dependency, never proxied.
 *
 * @param {string} markdown
 * @param {boolean} plain
 * @param {number} [scrollTop]
 * @returns {Entry}
 */
const makeEntry = (markdown, plain, scrollTop = 0) =>
  plain
    ? shallowReactive({ kind: 'text', text: markdown, dirty: false, timer: null, scrollTop })
    : shallowReactive({
        kind: 'document',
        state: createEditorState(markdown),
        view: null,
        dirty: false,
        timer: null,
        scrollTop,
      })

/**
 * The registry of documents open in the editor.
 *
 * @returns {{
 *   open: (id: string, markdown: string, plain?: boolean) => EditorState|null,
 *   close: (id: string) => void,
 *   discard: (id: string) => void,
 *   convert: (id: string, plain: boolean) => void,
 *   holds: (id: string|null|undefined) => boolean,
 *   openIds: () => string[],
 *   stateOf: (id: string) => EditorState|null,
 *   attach: (id: string, view: View|null) => void,
 *   rememberScroll: (id: string, top: number) => void,
 *   scrollTop: (id: string) => number,
 *   dispatch: (id: string, tr: Transaction) => void,
 *   setText: (id: string, text: string) => void,
 *   flush: (id?: string) => void,
 *   replaceContent: (id: string, markdown: string) => void,
 *   appendContent: (id: string, markdown: string) => void,
 *   markdown: (id: string) => string,
 *   focus: (id: string) => void,
 * }}
 */
export function useEditor() {
  /**
   * Turn an open document from one kind into the other, keeping what was
   * typed. Written through at once: a plain document made structured reads
   * differently from here on, and the store should say so.
   *
   * @param {string} id
   * @param {boolean} plain
   */
  const convert = (id, plain) => {
    const held = entries.get(id)
    if (!held || (held.kind === 'text') === plain) return
    if (held.timer) clearTimeout(held.timer)
    const entry = makeEntry(contentOf(held), plain, held.scrollTop)
    entry.dirty = true
    entries.set(id, entry)
    flushEntry(id, entry)
  }

  /**
   * Open a document. From here until `close` or `discard`, the entry is the
   * truth for it. A document already open is resumed as it stands — what was
   * typed, what can be undone — and the markdown offered is ignored; one
   * open as the other kind is turned into this one.
   *
   * @param {string} id
   * @param {string} markdown - What the store holds
   * @param {boolean} [plain] - As text, rather than as a structured document
   * @returns {EditorState|null} The state, for a structured document
   */
  const open = (id, markdown, plain = false) => {
    if (entries.has(id)) {
      convert(id, plain)
    } else {
      entries.set(id, makeEntry(markdown, plain))
    }
    return stateOf(id)
  }

  /**
   * Close a document, writing it out, and forget its entry.
   * @param {string} id
   */
  const close = id => {
    const entry = entries.get(id)
    if (!entry) return
    flushEntry(id, entry)
    entries.delete(id)
  }

  /**
   * Forget a document without writing it out: it has been deleted, and its
   * entry has nowhere to go.
   * @param {string} id
   */
  const discard = id => {
    const entry = entries.get(id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entries.delete(id)
  }

  /**
   * Whether the document is open.
   * @param {string|null|undefined} id
   * @returns {boolean}
   */
  const holds = id => !!id && entries.has(id)

  /** The documents open, in the order they were opened. */
  const openIds = () => [...entries.keys()]

  /**
   * A structured document's state; null for a plain one, or one not open.
   * @param {string} id
   * @returns {EditorState|null}
   */
  const stateOf = id => {
    const entry = entries.get(id)
    return entry?.kind === 'document' ? entry.state : null
  }

  /**
   * The view showing a structured document's state, so a dispatched
   * transaction reaches it. Null when the view goes and the document stays
   * open.
   * @param {string} id
   * @param {View|null} view
   */
  const attach = (id, view) => {
    const entry = entries.get(id)
    if (entry?.kind === 'document') entry.view = view
  }

  /**
   * Where a document's view was scrolled to, kept for the next view over it,
   * so a tab comes back where it was left.
   * @param {string} id
   * @param {number} top
   */
  const rememberScroll = (id, top) => {
    const entry = entries.get(id)
    if (entry) entry.scrollTop = top
  }

  /**
   * @param {string} id
   * @returns {number}
   */
  const scrollTop = id => entries.get(id)?.scrollTop ?? 0

  /**
   * Apply a transaction to a structured document. Every change to one comes
   * through here, from the view and from the document API alike.
   *
   * @param {string} id
   * @param {Transaction} tr
   */
  const dispatch = (id, tr) => {
    const entry = entries.get(id)
    if (entry?.kind !== 'document') return
    const next = entry.state.apply(tr)
    entry.state = next
    entry.view?.updateState(next)
    if (tr.docChanged) markDirty(id, entry)
  }

  /**
   * What a plain document's field now holds. Every keystroke comes through
   * here, and the store hears after a pause.
   *
   * @param {string} id
   * @param {string} text
   */
  const setText = (id, text) => {
    const entry = entries.get(id)
    if (entry?.kind !== 'text' || entry.text === text) return
    entry.text = text
    markDirty(id, entry)
  }

  /**
   * Write a document to the store, or with no id every open document. Called
   * on the debounce, and by anyone about to read the store.
   * @param {string} [id]
   */
  const flush = id => {
    if (id != null) {
      const entry = entries.get(id)
      if (entry) flushEntry(id, entry)
      return
    }
    for (const [key, entry] of entries) flushEntry(key, entry)
  }

  /**
   * Replace an open document's content. Written through at once: this is a
   * discrete event, and whoever asked is about to read the store. A plain
   * document takes the text as it is.
   * @param {string} id
   * @param {string} markdown
   */
  const replaceContent = (id, markdown) => {
    const entry = entries.get(id)
    if (!entry) return
    if (entry.kind === 'text') {
      entry.text = markdown
      entry.dirty = true
    } else {
      dispatch(id, replaceIn(entry.state, markdown))
    }
    flush(id)
  }

  /**
   * Add blocks at the end of an open document. Written through at once.
   * @param {string} id
   * @param {string} markdown
   */
  const appendContent = (id, markdown) => {
    const entry = entries.get(id)
    if (!entry) return
    if (entry.kind === 'text') {
      entry.text = appendBlocks(entry.text, markdown)
      entry.dirty = true
    } else {
      dispatch(id, appendTo(entry.state, markdown))
    }
    flush(id)
  }

  /**
   * An open document as markdown, whether or not it has been flushed.
   * @param {string} id
   * @returns {string}
   */
  const markdown = id => {
    const entry = entries.get(id)
    return entry ? contentOf(entry) : ''
  }

  /** @param {string} id */
  const focus = id => {
    const entry = entries.get(id)
    if (entry?.kind === 'document') entry.view?.focus()
  }

  return {
    open,
    close,
    discard,
    convert,
    holds,
    openIds,
    stateOf,
    attach,
    rememberScroll,
    scrollTop,
    dispatch,
    setText,
    flush,
    replaceContent,
    appendContent,
    markdown,
    focus,
  }
}
