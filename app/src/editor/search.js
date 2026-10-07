/**
 * @module editor/search
 * @description Find and replace in a document: what matches, which match is the
 * one the writer is on, and the transactions that move between the matches and
 * replace them.
 *
 * The matches are a plugin's state, so they live with the document they were
 * found in and follow its text as it changes, and they are drawn as
 * decorations: nothing is written into the document to show them. A match is
 * within one textblock, a paragraph or a heading or a code block, whatever
 * marks it runs across: "the long road" finds "the **long** road". Case does
 * not count.
 *
 * Moving to a match selects it, which is where the caret is when the find is
 * closed, and where a replace or the next search starts from. The commands
 * leave scrolling to the view, which knows how much of the page there is to
 * show it in.
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

/**
 * @typedef {import('prosemirror-state').EditorState} EditorState
 * @typedef {import('prosemirror-state').Transaction} Transaction
 * @typedef {import('prosemirror-state').Command} Command
 * @typedef {import('prosemirror-model').Node} Node
 *
 * @typedef {Object} Match
 * @property {number} from
 * @property {number} to
 *
 * @typedef {Object} SearchState
 * @property {string} query - What is being looked for; empty while nothing is
 * @property {Match[]} matches - Every match, in document order
 * @property {number} current - Which of them the writer is on, or -1 for none
 * @property {DecorationSet} decorations
 */

/** Stands in for an inline node that is not text, such as a line break, so positions line up. */
const NOT_TEXT = '￼'

/** @type {PluginKey<SearchState>} */
export const searchKey = new PluginKey('search')

/** @type {SearchState} */
const NONE = { query: '', matches: [], current: -1, decorations: DecorationSet.empty }

/** @param {string} text */
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Every place the query is found in the document, in order.
 *
 * @param {Node} doc
 * @param {string} query
 * @returns {Match[]}
 */
export function findMatches(doc, query) {
  if (!query) return []
  const pattern = new RegExp(escapeRegExp(query), 'giu')
  /** @type {Match[]} */
  const matches = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach(child => {
      text += child.isText ? child.text : NOT_TEXT.repeat(child.nodeSize)
    })
    for (const found of text.matchAll(pattern)) {
      const from = pos + 1 + (found.index ?? 0)
      matches.push({ from, to: from + found[0].length })
    }
    return false
  })
  return matches
}

/**
 * The first match at or after a position, going round to the first of all
 * from past the last. -1 when there are none.
 *
 * @param {Match[]} matches
 * @param {number} pos
 */
const firstFrom = (matches, pos) => {
  if (matches.length === 0) return -1
  const at = matches.findIndex(match => match.from >= pos)
  return at === -1 ? 0 : at
}

/**
 * @param {Node} doc
 * @param {string} query
 * @param {Match[]} matches
 * @param {number} current
 * @returns {SearchState}
 */
const searchState = (doc, query, matches, current) => {
  if (!query) return NONE
  const decorations = DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === current ? 'find-match find-match-current' : 'find-match',
      })
    )
  )
  return { query, matches, current, decorations }
}

/**
 * The plugin that keeps the search. A transaction that sets one carries it
 * whole, found against the document it leaves; any other change to the
 * document finds the query again, staying on the match that was current, or
 * the next one if that one went.
 *
 * @returns {Plugin<SearchState>}
 */
export function searchPlugin() {
  return new Plugin({
    key: searchKey,
    state: {
      init: () => NONE,
      apply(tr, value, _old, state) {
        /** @type {{query: string, matches: Match[], current: number}|undefined} */
        const set = tr.getMeta(searchKey)
        if (set) return searchState(state.doc, set.query, set.matches, set.current)
        if (!tr.docChanged || !value.query) return value
        const was = value.matches[value.current]
        const matches = findMatches(state.doc, value.query)
        const current = was ? firstFrom(matches, tr.mapping.map(was.from)) : -1
        return searchState(state.doc, value.query, matches, current)
      },
    },
    props: {
      decorations: state => searchKey.getState(state)?.decorations,
    },
  })
}

/**
 * The search a state holds. None for a state made without the plugin.
 *
 * @param {EditorState} state
 * @returns {SearchState}
 */
export const searchOf = state => searchKey.getState(state) ?? NONE

/**
 * Put the search on a transaction, and select the match it is on.
 *
 * @param {Transaction} tr
 * @param {string} query
 * @param {Match[]} matches
 * @param {number} current
 * @returns {Transaction}
 */
const withSearch = (tr, query, matches, current) => {
  tr.setMeta(searchKey, { query, matches, current })
  const match = matches[current]
  if (match) tr.setSelection(TextSelection.create(tr.doc, match.from, match.to))
  return tr
}

/**
 * Look for something, starting at the selection: as the query grows letter by
 * letter, the match the writer is on stays theirs for as long as it still
 * matches. An empty query is the search put away.
 *
 * @param {string} query
 * @returns {Command}
 */
export const find = query => (state, dispatch) => {
  const matches = findMatches(state.doc, query)
  const current = firstFrom(matches, state.selection.from)
  dispatch?.(withSearch(state.tr, query, matches, current))
  return true
}

/**
 * Move to the match after the one the writer is on, or before it, going round
 * at the ends. Nothing to do without a match.
 *
 * @param {1|-1} [step]
 * @returns {Command}
 */
export const findNext =
  (step = 1) =>
  (state, dispatch) => {
    const { query, matches, current } = searchOf(state)
    if (matches.length === 0) return false
    const next = current === -1 ? firstFrom(matches, state.selection.from) : current + step
    const at = (next + matches.length) % matches.length
    dispatch?.(withSearch(state.tr, query, matches, at))
    return true
  }

/**
 * Write text over a range, in the marks the range has, so that a word replaced
 * in italics is still in italics. Nothing is a deletion.
 *
 * @param {Transaction} tr
 * @param {Match} match
 * @param {string} text
 */
const replaceText = (tr, { from, to }, text) => {
  if (!text) return tr.delete(from, to)
  const $from = tr.doc.resolve(from)
  const marks = $from.marksAcross(tr.doc.resolve(to)) ?? $from.marks()
  return tr.replaceWith(from, to, tr.doc.type.schema.text(text, marks))
}

/**
 * Replace the match the writer is on, and move to the next one after what
 * went in, so that a replacement holding the query is not found again.
 *
 * @param {string} replacement
 * @returns {Command}
 */
export const replaceCurrent = replacement => (state, dispatch) => {
  const { query, matches, current } = searchOf(state)
  const match = matches[current]
  if (!match) return false
  if (dispatch) {
    const tr = replaceText(state.tr, match, replacement)
    const found = findMatches(tr.doc, query)
    dispatch(withSearch(tr, query, found, firstFrom(found, match.from + replacement.length)))
  }
  return true
}

/**
 * Replace every match, as one change and so one undo. The selection stays
 * where it was, moved along with the text.
 *
 * @param {string} replacement
 * @returns {Command}
 */
export const replaceAll = replacement => (state, dispatch) => {
  const { query, matches } = searchOf(state)
  if (matches.length === 0) return false
  if (dispatch) {
    const tr = state.tr
    // Last first, so that each replacement leaves the positions before it alone.
    for (const match of [...matches].reverse()) replaceText(tr, match, replacement)
    const found = findMatches(tr.doc, query)
    dispatch(tr.setMeta(searchKey, { query, matches: found, current: -1 }))
  }
  return true
}
