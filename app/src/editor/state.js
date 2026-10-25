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
 * nest and lift. In a table they move between cells and rows (see
 * `editor/tables`). A list's keys and the quote's take it off again, as their
 * items under a selection do (see `editor/format`). The typed shortcuts are markdown's own: `# `, `- `, `1. `,
 * `> `, ```` ``` ````, `---`, `**bold**` as you type, and a table's header
 * row followed by Enter. Quotes, dashes and ellipses are made as they are
 * typed, as a word processor makes them.
 */

import { EditorState, Selection, TextSelection } from 'prosemirror-state'
import { history, undo, redo, closeHistory } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark } from 'prosemirror-commands'
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import {
  InputRule,
  ellipsis,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { tableEditing } from 'prosemirror-tables'
import { schema } from './schema.js'
import { parseMarkdown } from './markdown.js'
import { searchPlugin } from './search.js'
import { spellingPlugin } from './spelling.js'
import { commentDraftPlugin } from './commentDraft.js'
import { figuresPlugin } from './pictures.js'
import { toggleList, toggleQuote } from './format.js'
import { diffSequences } from '@/utils/diff.js'
import {
  cellPaste,
  deleteEmptyTable,
  exitTable,
  nextCell,
  nextRow,
  previousCell,
  tableFromRow,
} from './tables.js'

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
 * The keys, in front of the base keymap. Enter makes a table of a typed
 * header row, moves down one, or tries the list split, and falls through to a
 * paragraph split; Backspace undoes a typed shortcut before it deletes.
 * Shift-Enter leaves a table where it would break a line, since a cell has
 * only the one.
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
  'Mod-e': toggleMark(code),
  'Mod-Shift-s': toggleMark(strikethrough),

  'Shift-Enter': chainCommands(exitCode, exitTable, insertHardBreak),
  'Mod-Enter': chainCommands(exitCode, exitTable, insertHardBreak),

  Enter: chainCommands(tableFromRow, nextRow, splitListItem(list_item)),
  Tab: chainCommands(nextCell, sinkListItem(list_item)),
  'Shift-Tab': chainCommands(previousCell, liftListItem(list_item)),
  'Mod-Shift-7': toggleList(ordered_list),
  'Mod-Shift-8': toggleList(bullet_list),
  'Mod-Shift-b': toggleQuote,
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
 * The keys a whole table answers ahead of `tableEditing`, which would only
 * empty its cells again.
 *
 * @type {Record<string, Command>}
 */
export const wholeTableKeys = {
  Backspace: deleteEmptyTable,
  'Mod-Backspace': deleteEmptyTable,
  Delete: deleteEmptyTable,
  'Mod-Delete': deleteEmptyTable,
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

/**
 * Typography as a writer's word processor does it, as they type: curly quotes
 * and apostrophes, a dash for two hyphens, and an ellipsis for three dots.
 * Not in code, and Backspace straight after takes any of them back.
 *
 * The dash wants something before it on the line, so that `---` on a line of
 * its own still draws a rule.
 *
 * @type {InputRule[]}
 */
export const typography = [
  ...smartQuotes,
  new InputRule(/.(--)$/, '—', { inCodeMark: false }),
  ellipsis,
]

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
  ...typography,
]

/**
 * The plugins every editor state runs with.
 *
 * @returns {import('prosemirror-state').Plugin[]}
 */
export function plugins() {
  return [
    inputRules({ rules }),
    cellPaste(),
    keymap(wholeTableKeys),
    tableEditing(),
    keymap(keys),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    history(),
    searchPlugin(),
    spellingPlugin(),
    commentDraftPlugin(),
    figuresPlugin(),
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
 * The document made to say this markdown by replacing only what differs, so
 * the caret and what is around the change stay as they are: for a change made
 * to the markdown, a comment put back on its passage, that the writer did
 * not make in the text. Null when the two say the same.
 *
 * @param {EditorState} state
 * @param {string} markdown
 * @returns {Transaction|null}
 */
export function replaceChanged(state, markdown) {
  const next = parseMarkdown(markdown)
  const start = state.doc.content.findDiffStart(next.content)
  if (start === null) return null
  const end = state.doc.content.findDiffEnd(next.content)
  if (!end) return null
  let { a: endA, b: endB } = end
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  return state.tr.replace(start, endA, next.slice(start, endB))
}

/**
 * The document made into another by replacing only the blocks that differ,
 * and inside a block still of its kind only what differs in it, so the
 * caret, and the text around each change, stay where they are: for edits
 * that come from outside the editor, a sync's from its Doc, as one undo
 * step of their own. Null when the two say the same.
 *
 * @param {EditorState} state
 * @param {Node} next - The document it is to be
 * @returns {Transaction|null}
 */
export function editsTo(state, next) {
  /** @type {Node[]} */
  const before = []
  /** @type {number[]} Where each block of `before` starts, and the end after them. */
  const starts = []
  state.doc.forEach((node, offset) => {
    before.push(node)
    starts.push(offset)
  })
  starts.push(state.doc.content.size)
  /** @type {Node[]} */
  const after = []
  next.forEach(node => after.push(node))
  /** @param {Node} node */
  const key = node => JSON.stringify(node.toJSON())
  const steps = diffSequences(before.map(key), after.map(key))
  if (!steps || steps.every(step => step.op === 'equal')) return null

  /** @type {Array<{a: [number, number], b: [number, number]}>} Each stretch that differs. */
  const changes = []
  let a = 0
  let b = 0
  for (const step of steps) {
    if (step.op === 'equal') {
      a = step.a + 1
      b = step.b + 1
      continue
    }
    const last = changes.at(-1)
    const change = last && last.a[1] === a && last.b[1] === b ? last : { a: [a, a], b: [b, b] }
    if (change !== last) changes.push(/** @type {any} */ (change))
    if (step.op === 'delete') change.a[1] = a = step.a + 1
    else change.b[1] = b = step.b + 1
  }

  const tr = state.tr
  for (const change of changes.reverse()) {
    const from = starts[change.a[0]]
    const to = starts[change.a[1]]
    const old = before[change.a[0]]
    const made = after[change.b[0]]
    if (
      change.a[1] - change.a[0] === 1 &&
      change.b[1] - change.b[0] === 1 &&
      old.sameMarkup(made)
    ) {
      const start = old.content.findDiffStart(made.content)
      const end = old.content.findDiffEnd(made.content)
      if (start !== null && end) {
        let { a: endA, b: endB } = end
        const overlap = start - Math.min(endA, endB)
        if (overlap > 0) {
          endA += overlap
          endB += overlap
        }
        tr.replace(from + 1 + start, from + 1 + endA, made.slice(start, endB))
        continue
      }
    }
    tr.replaceWith(from, to, after.slice(change.b[0], change.b[1]))
  }
  return closeHistory(tr)
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
