/**
 * @module editor/streaming
 * @description Text the model is still writing into a call that adds to the
 * end of a document, shown at the end of it as it arrives.
 *
 * Shown, not written. Until the call runs the document is as it was: the
 * text is drawn after the last block by a widget, so none of it is saved,
 * synced, kept in a version, counted, checked for spelling or undone, and
 * what the writer types goes in above it. When the call runs, the tool's
 * append puts the same blocks there and the preview comes off in the same
 * task, so nothing on the page moves. A call stopped, refused or failed takes
 * its preview with it, since nothing was written.
 *
 * Which previews a document shows is this plugin's state, changed by a
 * transaction as one starts and ends. The text goes around the state, since
 * it changes a token at a time: `setPreviewText` hands it to the widgets
 * showing it, which redraw now and then, and only from the first block that
 * changed.
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { DOMSerializer } from 'prosemirror-model'
import { schema } from './schema.js'
import { parseMarkdown } from './markdown.js'
import { insertedWhole } from './suggestions.js'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Transaction} Transaction
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('prosemirror-view').EditorView} EditorView
 *
 * One call's text, shown at the end of a document.
 * @typedef {Object} Preview
 * @property {string} id - The call's, for as long as it is being written
 * @property {boolean} suggested - It will be suggested rather than made,
 *   and is shown as a suggestion that puts it in
 */

export const streamingKey = new PluginKey('streaming')

/** The id a previewed suggestion's marks carry: no suggestion's. */
const PREVIEW_ID = 'streaming'

/** How often a preview is redrawn at most, in ms. */
export const DRAW_INTERVAL = 50

/**
 * The previews shown in a document, in the order they started.
 *
 * @returns {Plugin<Preview[]>}
 */
export function streamingPlugin() {
  return new Plugin({
    key: streamingKey,
    state: {
      init: () => [],
      apply: (tr, previews) => {
        const meta = tr.getMeta(streamingKey)
        if (meta?.start) return [...previews.filter(each => each.id !== meta.start.id), meta.start]
        if (meta?.end) return previews.filter(each => each.id !== meta.end)
        return previews
      },
    },
    props: {
      decorations: state => {
        const previews = streamingKey.getState(state)
        if (!previews?.length) return null
        const end = state.doc.content.size
        const decorations = previews.map((preview, index) =>
          Decoration.widget(end, view => new Drawer(preview, view).dom, {
            key: `${PREVIEW_ID}-${preview.id}-${preview.suggested}`,
            side: index + 1,
            ignoreSelection: true,
            destroy: dom => drawers.get(/** @type {HTMLElement} */ (dom))?.destroy(),
          })
        )
        // An empty document's one line goes when the first append comes,
        // which replaces it: it goes now, so the text does not drop a line.
        const { doc } = state
        if (doc.childCount === 1 && doc.firstChild?.isTextblock && !doc.firstChild.content.size) {
          decorations.push(
            Decoration.node(0, doc.firstChild.nodeSize, { class: 'streaming-hidden' })
          )
        }
        return DecorationSet.create(doc, decorations)
      },
    },
  })
}

/**
 * The previews a document shows.
 * @param {EditorState} state
 * @returns {Preview[]}
 */
export const previewsOf = state => streamingKey.getState(state) ?? []

/**
 * Start showing a call's text at the end of the document. Null when it is
 * shown already, the same way.
 *
 * @param {EditorState} state
 * @param {Preview} preview
 * @returns {Transaction|null}
 */
export function startPreview(state, preview) {
  const now = previewsOf(state).find(each => each.id === preview.id)
  if (now && now.suggested === preview.suggested) return null
  return state.tr.setMeta(streamingKey, { start: preview }).setMeta('addToHistory', false)
}

/**
 * Stop showing a call's text. Null when it is not shown.
 *
 * @param {EditorState} state
 * @param {string} id
 * @returns {Transaction|null}
 */
export function endPreview(state, id) {
  if (!previewsOf(state).some(each => each.id === id)) return null
  return state.tr.setMeta(streamingKey, { end: id }).setMeta('addToHistory', false)
}

/**
 * Each call's text as far as it has come, and the widgets drawing it.
 * @type {Map<string, {text: string, drawers: Set<Drawer>}>}
 */
const texts = new Map()

/**
 * @param {string} id
 */
const textFor = id => {
  let entry = texts.get(id)
  if (!entry) texts.set(id, (entry = { text: '', drawers: new Set() }))
  return entry
}

/**
 * A call's text as far as it has come, in markdown, for every document
 * showing it to draw.
 *
 * @param {string} id
 * @param {string} markdown
 */
export function setPreviewText(id, markdown) {
  const entry = textFor(id)
  if (entry.text === markdown) return
  entry.text = markdown
  for (const drawer of entry.drawers) drawer.schedule()
}

/**
 * Forget a call's text, once it is shown nowhere.
 * @param {string} id
 */
export function dropPreviewText(id) {
  const entry = texts.get(id)
  if (entry && entry.drawers.size === 0) texts.delete(id)
}

/**
 * The blocks a preview shows for a text: as they would be appended, or as a
 * suggestion that puts them in would show them. Nothing for a text with no
 * words yet, which would otherwise be an empty line.
 *
 * @param {string} markdown
 * @param {boolean} suggested
 * @returns {Node[]}
 */
export function previewBlocks(markdown, suggested) {
  if (!markdown.trim()) return []
  /** @type {Node[]} */
  const blocks = []
  parseMarkdown(markdown).forEach(block =>
    blocks.push(suggested ? insertedWhole(block, PREVIEW_ID) : block)
  )
  return blocks
}

/** @type {DOMSerializer|null} */
let serializer = null

/** @type {WeakMap<HTMLElement, Drawer>} */
const drawers = new WeakMap()

/**
 * A preview's element in one view, kept from draw to draw, and the blocks
 * it shows.
 */
class Drawer {
  /**
   * @param {Preview} preview
   * @param {EditorView} view
   */
  constructor(preview, view) {
    this.preview = preview
    this.dom = view.dom.ownerDocument.createElement('div')
    this.dom.className = 'streaming-text'
    /** @type {Node[]} */
    this.blocks = []
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.timer = null
    drawers.set(this.dom, this)
    textFor(preview.id).drawers.add(this)
    this.draw()
  }

  /** Draw again soon: the text has moved on. */
  schedule() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.draw()
    }, DRAW_INTERVAL)
  }

  /**
   * Draw the text as it is now, keeping the blocks that have not changed.
   * Nothing scrolls to follow it, as nothing does in the chat.
   */
  draw() {
    const text = texts.get(this.preview.id)?.text ?? ''
    const blocks = previewBlocks(text, this.preview.suggested)
    let same = 0
    while (
      same < blocks.length &&
      same < this.blocks.length &&
      blocks[same].eq(this.blocks[same])
    ) {
      same++
    }
    while (this.dom.childNodes.length > same) this.dom.lastChild?.remove()
    serializer ??= DOMSerializer.fromSchema(schema)
    const document = this.dom.ownerDocument
    for (const block of blocks.slice(same)) {
      this.dom.append(serializer.serializeNode(block, { document }))
    }
    this.blocks = blocks
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    texts.get(this.preview.id)?.drawers.delete(this)
    drawers.delete(this.dom)
  }
}
