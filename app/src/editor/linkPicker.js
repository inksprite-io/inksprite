/**
 * @module editor/linkPicker
 * @description `[[` and a name, for a link to another document.
 *
 * Typing `[[` in a paragraph opens a list of the project's documents under
 * the caret, which narrows as a name is typed after it, and a `#` goes on to
 * a document's headings (`[[Cast list#The crew`, or `[[#The crew` for this
 * one's). Enter or Tab puts in the one highlighted as a link, its words the
 * document's name or the heading's, in place of the `[[` and what was typed;
 * Escape puts the list away, leaving the text as typed, until the `[[` is
 * typed again. Not in code, where `[[` is code.
 *
 * The list is the editor component's to show; this says where it is and
 * what has been typed, takes the keys the list needs while it shows, and
 * makes the link.
 */

import { Plugin, TextSelection } from 'prosemirror-state'
import { schema } from './schema.js'
import { canLink } from './links.js'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-view').EditorView} EditorView
 */

/**
 * The `[[` the caret is after, and what has been typed since.
 *
 * @typedef {Object} Picking
 * @property {number} from - Where the `[[` starts
 * @property {number} to - The caret
 * @property {string} query - What follows the `[[`
 */

/** `[[` and a name not yet closed, at the end of the text before the caret. */
const OPENED = /\[\[([^[\]\n￼]*)$/

/**
 * The `[[` the caret is after, if a link can go there.
 *
 * @param {EditorState} state
 * @returns {Picking|null}
 */
export function pickingAt(state) {
  const { selection } = state
  if (!selection.empty || !canLink(state)) return null
  const { $from } = selection
  if ($from.marks().some(mark => mark.type.spec.code)) return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const found = OPENED.exec(before)
  if (!found) return null
  return { from: $from.pos - found[0].length, to: $from.pos, query: found[1] }
}

/**
 * Put a link in place of the `[[` and what was typed after it, the caret
 * after it.
 *
 * @param {EditorView} view
 * @param {Picking} picking
 * @param {{href: string, words: string}} link
 */
export function putLink(view, { from, to }, { href, words }) {
  const { state } = view
  const marks = state.doc
    .resolve(from)
    .marks()
    .filter(mark => mark.type !== schema.marks.link)
  const tr = state.tr.replaceWith(
    from,
    to,
    schema.text(words, [...marks, schema.marks.link.create({ href })])
  )
  const end = from + words.length
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView())
  view.focus()
}

/**
 * The picker, for a view.
 *
 * @param {Object} options
 * @param {(view: EditorView, picking: Picking|null) => void} options.update -
 *   The `[[` the caret is after, or none: the list shows or goes
 * @param {(key: 'up'|'down'|'pick') => boolean} options.key - A key the list
 *   takes while it shows; false when it showed nothing to take it
 * @returns {Plugin}
 */
export function linkPicker({ update, key: take }) {
  /** Where the `[[` Escape put the list away for starts, while it lasts. */
  let dismissed = /** @type {number|null} */ (null)
  /** @param {EditorView} view */
  const picking = view => {
    const at = pickingAt(view.state)
    if (!at || at.from !== dismissed) dismissed = null
    return at && view.hasFocus() && at.from !== dismissed ? at : null
  }
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const at = picking(view)
        if (!at || event.metaKey || event.ctrlKey || event.altKey) return false
        if (event.key === 'Escape') {
          dismissed = at.from
          update(view, null)
          return true
        }
        const key =
          event.key === 'ArrowDown'
            ? 'down'
            : event.key === 'ArrowUp'
              ? 'up'
              : event.key === 'Enter' || event.key === 'Tab'
                ? 'pick'
                : null
        return key !== null && take(key)
      },
      handleDOMEvents: {
        blur: view => {
          update(view, null)
          return false
        },
        focus: view => {
          update(view, picking(view))
          return false
        },
      },
    },
    view: view => {
      update(view, picking(view))
      return { update: next => update(next, picking(next)) }
    },
  })
}
