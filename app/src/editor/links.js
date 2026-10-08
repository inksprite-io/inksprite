/**
 * @module editor/links
 * @description Links in a document: making one, changing or removing it, and
 * opening it, the way Google Docs does.
 *
 * Mod-K links the selection, or changes the link the caret is in; with
 * nothing selected it puts in a new link, words and all. A click in a link
 * puts the caret there like a click anywhere, and the editor shows the link
 * beside it (see `LinkPopover.vue`); Mod-click opens it. A link pasted over a
 * selection links the selection, and one pasted on its own goes in as a link.
 *
 * The commands are the state's; the keys, the clicks and the paste are a view
 * plugin's, since what they do next — show a field, open a page — is the
 * editor component's to do.
 */

import { Plugin, TextSelection } from 'prosemirror-state'
import { keydownHandler } from 'prosemirror-keymap'
import { schema } from './schema.js'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('prosemirror-model').ResolvedPos} ResolvedPos
 * @typedef {import('prosemirror-view').EditorView} EditorView
 */

/**
 * A link in the document: where it starts and ends, and where it goes.
 *
 * @typedef {Object} LinkRange
 * @property {number} from
 * @property {number} to
 * @property {string} href
 */

const { link } = schema.marks

/** A pasted link: the whole of the text one web or mail address. */
const PASTED_LINK = /^(https?:\/\/|mailto:)\S+$/i

/**
 * The link the position is in, or against at either end.
 *
 * @param {ResolvedPos} $pos
 * @returns {LinkRange|null}
 */
export function linkAround($pos) {
  const { parent } = $pos
  let index = $pos.index()
  let mark = index < parent.childCount ? link.isInSet(parent.child(index).marks) : null
  if (!mark && $pos.textOffset === 0 && index > 0) {
    index -= 1
    mark = link.isInSet(parent.child(index).marks)
  }
  if (!mark) return null

  let first = index
  let last = index
  while (first > 0 && mark.isInSet(parent.child(first - 1).marks)) first -= 1
  while (last < parent.childCount - 1 && mark.isInSet(parent.child(last + 1).marks)) last += 1
  let from = $pos.start()
  for (let at = 0; at < first; at++) from += parent.child(at).nodeSize
  let to = from
  for (let at = first; at <= last; at++) to += parent.child(at).nodeSize
  return { from, to, href: mark.attrs.href }
}

/**
 * Whether a link can go where the selection is: not in a code block.
 *
 * @param {EditorState} state
 */
export function canLink(state) {
  const { $from } = state.selection
  return $from.parent.inlineContent && $from.parent.type.allowsMarkType(link)
}

/**
 * Link the selection to `href`, or the link the caret is in. With nothing
 * selected and no link there, `text` goes in as the link's words, or the
 * address itself without any. The caret ends up after the link.
 *
 * @param {string} href
 * @param {string} [text]
 * @returns {Command}
 */
export function setLink(href, text = '') {
  return (state, dispatch) => {
    if (!href || !canLink(state)) return false
    const { selection } = state
    let { from, to } = selection
    const around = selection.empty ? linkAround(selection.$from) : null
    if (around) ({ from, to } = around)
    if (dispatch) {
      const tr = state.tr
      if (from === to) {
        const words = text || href
        tr.insertText(words, from)
        to = from + words.length
      }
      // A link replaces any other on the same text.
      tr.addMark(from, to, link.create({ href }))
      dispatch(tr.setSelection(TextSelection.create(tr.doc, to)).scrollIntoView())
    }
    return true
  }
}

/**
 * Take the link off the selection, or off the whole of the link the caret is
 * in. The words stay.
 *
 * @type {Command}
 */
export const removeLink = (state, dispatch) => {
  const { selection } = state
  let { from, to } = selection
  if (selection.empty) {
    const around = linkAround(selection.$from)
    if (!around) return false
    ;({ from, to } = around)
  } else if (!state.doc.rangeHasMark(from, to, link)) {
    return false
  }
  if (dispatch) dispatch(state.tr.removeMark(from, to, link).scrollIntoView())
  return true
}

/**
 * An address as typed made into one a link can have: a bare domain is a web
 * page, a bare email address is mail, and anything with a scheme stays as it
 * is. `localhost:3000` has no scheme; a port is not one.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeHref(input) {
  const href = input.trim()
  if (!href || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(href) || /^[#/]/.test(href)) return href
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(href)) return `mailto:${href}`
  return `https://${href}`
}

/**
 * A link pasted over a selection links it; on its own, it goes in as a link.
 * Not in code, and on its own only as text: a link copied from a page comes
 * with its own words as HTML, and the editor's paste keeps those.
 *
 * @param {EditorView} view
 * @param {ClipboardEvent} event
 * @returns {boolean}
 */
function pasteLink(view, event) {
  const href = event.clipboardData?.getData('text/plain').trim() ?? ''
  const { state } = view
  const { selection } = state
  if (!PASTED_LINK.test(href) || !(selection instanceof TextSelection) || !canLink(state)) {
    return false
  }
  if (selection.$from.marks().some(mark => mark.type.spec.code)) return false
  if (selection.empty && event.clipboardData?.types.includes('text/html')) return false
  // A new link even against one already there, which Mod-K would change.
  const { from } = selection
  const tr = selection.empty ? state.tr.insertText(href) : state.tr
  const to = selection.empty ? from + href.length : selection.to
  tr.addMark(from, to, link.create({ href })).setSelection(TextSelection.create(tr.doc, to))
  view.dispatch(tr.scrollIntoView())
  return true
}

/**
 * What the editor does about links, for a view.
 *
 * @param {Object} options
 * @param {() => void} options.edit - Show the field for the link at the
 *   selection: Mod-K
 * @param {(href: string) => void} options.open - Open a link: Mod-click
 * @param {(view: EditorView) => void} options.update - The caret may have
 *   moved into a link or out of one, or the editor taken or lost the focus
 * @returns {Plugin}
 */
export function links({ edit, open, update }) {
  return new Plugin({
    props: {
      handleKeyDown: keydownHandler({
        'Mod-k': state => {
          if (!canLink(state)) return false
          edit()
          return true
        },
      }),
      handleClick(view, _pos, event) {
        if (!(event.metaKey || event.ctrlKey)) return false
        const target = /** @type {Element|null} */ (event.target)
        const anchor = target?.closest?.('a[href]')
        if (!anchor || !view.dom.contains(anchor)) return false
        open(anchor.getAttribute('href') || '')
        return true
      },
      handlePaste: pasteLink,
      handleDOMEvents: {
        focus: view => {
          update(view)
          return false
        },
        blur: view => {
          update(view)
          return false
        },
      },
    },
    view: view => {
      update(view)
      return { update }
    },
  })
}
