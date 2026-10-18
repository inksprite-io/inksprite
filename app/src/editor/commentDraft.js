/**
 * @module editor/commentDraft
 * @description The passage a new comment is being written on, while it is
 * written somewhere else: in the Comments tab, beside the text.
 *
 * The passage has no mark yet, since the comment may never be made, but it
 * has to follow the text as a mark would while the writer looks away to
 * write: typing before it moves it, and deleting it takes the draft with it.
 * So it is a range in the editor's state, mapped through every transaction,
 * and tinted in the text as an open field's passage is.
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Transaction} Transaction
 * @typedef {{from: number, to: number}} DraftRange
 */

/** @type {PluginKey<DraftRange|null>} */
export const draftKey = new PluginKey('commentDraft')

/**
 * The plugin that keeps the range. Set or cleared by a transaction's meta
 * (`withDraft`); otherwise mapped, and gone once its words are.
 *
 * @returns {Plugin<DraftRange|null>}
 */
export function commentDraftPlugin() {
  return new Plugin({
    key: draftKey,
    state: {
      init: () => null,
      apply(tr, held) {
        const asked = tr.getMeta(draftKey)
        if (asked !== undefined) return asked
        if (!held || !tr.docChanged) return held
        const from = tr.mapping.map(held.from, 1)
        const to = tr.mapping.map(held.to, -1)
        return from < to ? { from, to } : null
      },
    },
    props: {
      decorations(state) {
        const held = draftKey.getState(state)
        return held
          ? DecorationSet.create(state.doc, [
              Decoration.inline(held.from, held.to, { class: 'field-target' }),
            ])
          : null
      },
    },
  })
}

/**
 * The passage a new comment is being written on, or null.
 *
 * @param {EditorState} state
 * @returns {DraftRange|null}
 */
export const draftRange = state => draftKey.getState(state) ?? null

/**
 * A transaction that sets the passage, or with null clears it.
 *
 * @param {Transaction} tr
 * @param {DraftRange|null} range
 * @returns {Transaction}
 */
export const withDraft = (tr, range) => tr.setMeta(draftKey, range)
