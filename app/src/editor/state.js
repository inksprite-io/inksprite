/**
 * @module editor/state
 * @description The editor's state layer: how a document becomes an
 * `EditorState`, what the keys and the typed shortcuts do, and the two
 * transactions an outside writer can ask for.
 *
 * `EditorState` is the open document — doc, selection, undo history, and
 * plugin state as one immutable value — and every change to it is a
 * transaction. Nothing here needs a view, which is why it is tested without
 * one; `Editor.vue` puts an `EditorView` in front of the state, and
 * `useEditor` holds the state and dispatches to it.
 *
 * The keys follow the previous editor's where it had them — Mod-B, Mod-I,
 * Mod-Shift-S, Mod-Alt-1 through 6, Mod-Shift-7 and 8, Mod-Shift-B, Mod-Alt-C
 * — and the reference's for lists: Enter splits an item, Tab and Shift-Tab
 * nest and lift. The typed shortcuts are markdown's own: `# `, `- `, `1. `,
 * `> `, ```` ``` ````, `---`, and `**bold**` as you type.
 */

import { EditorState, Selection, TextSelection } from 'prosemirror-state'
import { history, undo, redo, closeHistory } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import {
  baseKeymap,
  chainCommands,
  exitCode,
  setBlockType,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands'
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list'
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { schema } from './schema.js'
import { parseMarkdown } from './markdown.js'

/**
 * @typedef {import('prosemirror-state').Transaction} Transaction
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('prosemirror-model').MarkType} MarkType
 * @typedef {import('prosemirror-model').Node} Node
 */

const { strong, em, code, strikethrough } = schema.marks
const {
  paragraph,
  heading,
  blockquote,
  bullet_list,
  ordered_list,
  list_item,
  code_block,
  horizontal_rule,
  hard_break,
} = schema.nodes

/** @type {Command} */
const insertHardBreak = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView())
  return true
}

/**
 * The keys, in front of the base keymap. Enter tries the list split first
 * and falls through to a paragraph split; Backspace undoes a typed shortcut
 * before it deletes.
 *
 * @type {Record<string, Command>}
 */
export const keys = {
  'Mod-z': undo,
  'Shift-Mod-z': redo,
  'Mod-y': redo,
  Backspace: undoInputRule,

  'Mod-b': toggleMark(strong),
  'Mod-i': toggleMark(em),
  'Mod-`': toggleMark(code),
  'Mod-Shift-s': toggleMark(strikethrough),

  'Shift-Enter': chainCommands(exitCode, insertHardBreak),
  'Mod-Enter': chainCommands(exitCode, insertHardBreak),

  Enter: splitListItem(list_item),
  Tab: sinkListItem(list_item),
  'Shift-Tab': liftListItem(list_item),
  'Mod-Shift-7': wrapInList(ordered_list),
  'Mod-Shift-8': wrapInList(bullet_list),
  'Mod-Shift-b': wrapIn(blockquote),
  'Mod-Alt-0': setBlockType(paragraph),
  'Mod-Alt-1': setBlockType(heading, { level: 1 }),
  'Mod-Alt-2': setBlockType(heading, { level: 2 }),
  'Mod-Alt-3': setBlockType(heading, { level: 3 }),
  'Mod-Alt-4': setBlockType(heading, { level: 4 }),
  'Mod-Alt-5': setBlockType(heading, { level: 5 }),
  'Mod-Alt-6': setBlockType(heading, { level: 6 }),
  'Mod-Alt-c': setBlockType(code_block),
}

/**
 * `**bold**` as you type. The regexp's first group is the marked span with its
 * delimiters, the second the text inside; the delimiters are dropped and the
 * text takes the mark, and the mark is not stored, so what is typed next is
 * plain.
 *
 * @param {RegExp} regexp
 * @param {MarkType} markType
 * @returns {InputRule}
 */
export function markInputRule(regexp, markType) {
  return new InputRule(regexp, (state, match, start, end) => {
    const [full, span, inner] = match
    const spanFrom = start + full.length - span.length
    const delimiter = (span.length - inner.length) / 2
    const innerFrom = spanFrom + delimiter
    const innerTo = innerFrom + inner.length
    return state.tr
      .delete(innerTo, end)
      .delete(spanFrom, innerFrom)
      .addMark(spanFrom, spanFrom + inner.length, markType.create())
      .removeStoredMark(markType)
  })
}

/**
 * `---` on a line of its own becomes a rule, with an empty paragraph after it
 * to keep typing into.
 *
 * @type {InputRule}
 */
export const horizontalRuleRule = new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start) => {
  const $start = state.doc.resolve(start)
  if ($start.parent.type !== paragraph) return null
  const before = $start.before()
  const tr = state.tr.replaceWith(before, $start.after(), [
    horizontal_rule.create(),
    paragraph.create(),
  ])
  return tr.setSelection(TextSelection.create(tr.doc, before + 2))
})

/** @type {InputRule[]} */
export const rules = [
  textblockTypeInputRule(/^(#{1,6})\s$/, heading, match => ({ level: match[1].length })),
  wrappingInputRule(/^\s*>\s$/, blockquote),
  wrappingInputRule(
    /^(\d+)\.\s$/,
    ordered_list,
    match => ({ order: Number(match[1]) }),
    (match, node) => node.childCount + node.attrs.order === Number(match[1])
  ),
  wrappingInputRule(/^\s*([-+*])\s$/, bullet_list),
  textblockTypeInputRule(/^```$/, code_block),
  horizontalRuleRule,
  markInputRule(/(?:^|\s)(\*\*(?!\s+\*\*)([^*]+)\*\*(?!\s+\*\*))$/, strong),
  markInputRule(/(?:^|\s)(__(?!\s+__)([^_]+)__(?!\s+__))$/, strong),
  markInputRule(/(?:^|\s)(\*(?!\s+\*)([^*]+)\*(?!\s+\*))$/, em),
  markInputRule(/(?:^|\s)(_(?!\s+_)([^_]+)_(?!\s+_))$/, em),
  markInputRule(/(?:^|\s)(~~(?!\s+~~)([^~]+)~~(?!\s+~~))$/, strikethrough),
  markInputRule(/(?:^|\s)(`(?!\s+`)([^`]+)`(?!\s+`))$/, code),
]

/**
 * The plugins every editor state runs with.
 *
 * @returns {import('prosemirror-state').Plugin[]}
 */
export function plugins() {
  return [
    inputRules({ rules }),
    keymap(keys),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    history(),
  ]
}

/**
 * The state for a document, with the caret at its end — where a writer
 * coming back to a chapter wants to be.
 *
 * @param {string|null|undefined} markdown
 * @returns {EditorState}
 */
export function createEditorState(markdown) {
  const doc = parseMarkdown(markdown)
  return EditorState.create({ doc, selection: Selection.atEnd(doc), plugins: plugins() })
}

/**
 * Whether a document holds nothing: one textblock with nothing in it.
 *
 * @param {Node} doc
 * @returns {boolean}
 */
export function isEmptyDocument(doc) {
  return doc.childCount === 1 && doc.firstChild.isTextblock && doc.firstChild.content.size === 0
}

/**
 * Replace the whole document, as one undo step of its own, with the caret at
 * the end of what arrived.
 *
 * @param {EditorState} state
 * @param {string} markdown
 * @returns {Transaction}
 */
export function replaceContent(state, markdown) {
  const tr = state.tr.replaceWith(0, state.doc.content.size, parseMarkdown(markdown).content)
  return closeHistory(tr.setSelection(Selection.atEnd(tr.doc)).scrollIntoView())
}

/**
 * Add blocks at the end of the document, as one undo step of its own. The
 * writer's caret stays where it is. An empty document is replaced rather than
 * added to, so no blank paragraph is left standing above.
 *
 * @param {EditorState} state
 * @param {string} markdown
 * @returns {Transaction}
 */
export function appendContent(state, markdown) {
  if (isEmptyDocument(state.doc)) return replaceContent(state, markdown)
  return closeHistory(state.tr.insert(state.doc.content.size, parseMarkdown(markdown).content))
}
