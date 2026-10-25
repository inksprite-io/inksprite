/**
 * @module editor/format
 * @description What the formatting buttons over a selection offer: the marks
 * on the selected text, the style of the blocks it is in, and whether they
 * are quoted or listed, with the commands that change each.
 *
 * A mark is toggled as its key toggles it: taken off where any of the
 * selection has it, put on otherwise. A style is the kind of text block —
 * normal text, a heading, a code block — and one replaces another. Quotes and
 * lists hold blocks rather than being them, so each is on or off around the
 * style: off lifts the selected blocks out of the nearest one, and a list of
 * the other kind becomes this kind. There is no underline, which markdown
 * cannot write (see `editor/schema`).
 */

import { setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { liftListItem, wrapInList } from 'prosemirror-schema-list'
import { liftTarget } from 'prosemirror-transform'
import { schema } from './schema.js'
import { canLink } from './links.js'

/**
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-model').NodeType} NodeType
 * @typedef {import('prosemirror-model').NodeRange} NodeRange
 */

/**
 * @typedef {Object} Format
 * @property {string} id
 * @property {string} label
 * @property {string} [keys] - Its binding, as ProseMirror writes one
 */

const { link } = schema.marks
const { paragraph, heading, code_block, blockquote, bullet_list, ordered_list, list_item } =
  schema.nodes

/** The marks, in the order the menu lists them. @type {readonly Format[]} */
export const MARKS = Object.freeze([
  { id: 'strong', label: 'Bold', keys: 'Mod-b' },
  { id: 'em', label: 'Italic', keys: 'Mod-i' },
  { id: 'strikethrough', label: 'Strikethrough', keys: 'Mod-Shift-s' },
  { id: 'code', label: 'Code', keys: 'Mod-e' },
])

/** The styles a text block can have. @type {readonly (Format & {type: NodeType, attrs?: {level: number}})[]} */
export const STYLES = Object.freeze([
  { id: 'paragraph', label: 'Normal text', keys: 'Mod-Alt-0', type: paragraph },
  ...[1, 2, 3, 4, 5, 6].map(level => ({
    id: `heading${level}`,
    label: `Heading ${level}`,
    keys: `Mod-Alt-${level}`,
    type: heading,
    attrs: { level },
  })),
  { id: 'code_block', label: 'Code block', keys: 'Mod-Alt-c', type: code_block },
])

/** What can hold the blocks, each on or off. @type {readonly (Format & {type: NodeType})[]} */
export const WRAPPERS = Object.freeze([
  { id: 'blockquote', label: 'Quote', keys: 'Mod-Shift-b', type: blockquote },
  { id: 'bullet_list', label: 'Bulleted list', keys: 'Mod-Shift-8', type: bullet_list },
  { id: 'ordered_list', label: 'Numbered list', keys: 'Mod-Shift-7', type: ordered_list },
])

/** The marks taken off by `clearFormatting`: not links, comments or suggestions. */
const TEXT_MARKS = MARKS.map(({ id }) => schema.marks[id])

/**
 * The style of a text block, if it is one of `STYLES`: not a table's cell.
 *
 * @param {import('prosemirror-model').Node} node
 * @returns {string|null}
 */
function styleOf(node) {
  if (node.type === heading) return `heading${node.attrs.level}`
  return node.type === paragraph || node.type === code_block ? node.type.name : null
}

/**
 * The style the text blocks the selection is in share, or null where they
 * differ or have none.
 *
 * @param {EditorState} state
 * @returns {string|null}
 */
export function styleAt(state) {
  const { from, to } = state.selection
  /** @type {string|null|undefined} */
  let style
  state.doc.nodesBetween(from, to, node => {
    if (style === null) return false
    if (!node.isTextblock) return true
    const own = styleOf(node)
    style = style === undefined || style === own ? own : null
    return false
  })
  return style ?? null
}

/**
 * The selected blocks' range in the nearest node around them that `holds`.
 *
 * @param {EditorState} state
 * @param {(node: import('prosemirror-model').Node) => boolean} holds
 * @returns {NodeRange|null}
 */
function rangeIn(state, holds) {
  const { $from, $to } = state.selection
  return $from.blockRange($to, holds)
}

/** @param {EditorState} state */
const quoteRange = state => rangeIn(state, node => node.type === blockquote)

/** @param {EditorState} state */
const listRange = state =>
  rangeIn(state, node => node.type === bullet_list || node.type === ordered_list)

/**
 * Quote the selected blocks, or lift them out of the quote they are in.
 *
 * @type {Command}
 */
export const toggleQuote = (state, dispatch) => {
  const range = quoteRange(state)
  if (!range) return wrapIn(blockquote)(state, dispatch)
  const target = liftTarget(range)
  if (target === null) return false
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView())
  return true
}

/**
 * Make a list of the selected blocks; lift them out of the list of this kind
 * they are in, a level, as Shift-Tab does; or make the list of the other kind
 * one of this.
 *
 * @param {NodeType} type - `bullet_list` or `ordered_list`
 * @returns {Command}
 */
export function toggleList(type) {
  return (state, dispatch) => {
    const range = listRange(state)
    if (!range) return wrapInList(type)(state, dispatch)
    if (range.parent.type === type) return liftListItem(list_item)(state, dispatch)
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(range.$from.before(range.depth), type).scrollIntoView())
    }
    return true
  }
}

/**
 * Take the text's marks off the selection: bold, italic, strikethrough and
 * code. Links, comments and suggestions stay.
 *
 * @type {Command}
 */
export const clearFormatting = (state, dispatch) => {
  const { ranges } = state.selection
  const marked = ranges.some(({ $from, $to }) =>
    TEXT_MARKS.some(type => state.doc.rangeHasMark($from.pos, $to.pos, type))
  )
  if (!marked) return false
  if (dispatch) {
    const tr = state.tr
    for (const { $from, $to } of ranges) {
      for (const type of TEXT_MARKS) tr.removeMark($from.pos, $to.pos, type)
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** Every format's command, by its id. @type {Record<string, Command>} */
const COMMANDS = {
  ...Object.fromEntries(MARKS.map(({ id }) => [id, toggleMark(schema.marks[id])])),
  ...Object.fromEntries(
    STYLES.map(({ id, type, attrs }) => [id, setBlockType(type, attrs ?? null)])
  ),
  blockquote: toggleQuote,
  bullet_list: toggleList(bullet_list),
  ordered_list: toggleList(ordered_list),
  clear: clearFormatting,
}

/**
 * The command for a format, by its id in `MARKS`, `STYLES` or `WRAPPERS`, or
 * `clear`.
 *
 * @param {string} id
 * @returns {Command}
 */
export function formatCommand(id) {
  return COMMANDS[id] ?? (() => false)
}

/**
 * @typedef {Object} Formatting
 * @property {Record<string, boolean>} on - The marks the selection has, and
 *   the quote and the kind of list it is in
 * @property {Record<string, boolean>} can - What applies here: in a code
 *   block no mark, in a table's cell no style
 * @property {string|null} style - The style its blocks share
 */

/**
 * What the selection has, and what can be done to it, for the buttons.
 *
 * @param {EditorState} state
 * @returns {Formatting}
 */
export function formattingAt(state) {
  const { from, to } = state.selection
  const style = styleAt(state)
  const list = listRange(state)?.parent.type
  /** @type {Record<string, boolean>} */
  const on = {
    link: state.doc.rangeHasMark(from, to, link),
    blockquote: !!quoteRange(state),
    bullet_list: list === bullet_list,
    ordered_list: list === ordered_list,
  }
  for (const { id } of MARKS) on[id] = state.doc.rangeHasMark(from, to, schema.marks[id])
  /** @type {Record<string, boolean>} */
  const can = { link: canLink(state) }
  for (const id of Object.keys(COMMANDS)) can[id] = COMMANDS[id](state)
  // Already the style, it is still one the blocks can have.
  if (style) can[style] = true
  return { on, can, style }
}

/**
 * Whether the blocks can have a style: a table's cells have none.
 *
 * @param {Formatting} formatting
 * @returns {boolean}
 */
export function hasStyles(formatting) {
  return formatting.style !== null || STYLES.some(({ id }) => formatting.can[id])
}
