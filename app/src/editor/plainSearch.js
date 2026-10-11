/**
 * @module editor/plainSearch
 * @description Find and replace in a plain document, as `search` does it in a
 * laid-out one, for the CodeMirror view a plain document is shown in.
 *
 * The matches are a state field, so they follow the text as it changes, and
 * they are drawn as decorations, in the classes `search` draws with. Case
 * and whole words count as they do there, and so does a replacement taking
 * the capitals of what it replaces. Moving to a match selects it, which is where the caret is
 * when the find is closed, and where a replace or the next search starts
 * from. Each command takes the view, as CodeMirror's own do, and says whether
 * there was anything to do; `reveal` then brings the match into sight.
 *
 * Loaded with the plain view rather than from `editor/index`, so that
 * CodeMirror is not in the app until a plain document is opened.
 */

import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { inCaseOf, patternFor } from './search.js'

/**
 * @typedef {import('@codemirror/state').Text} Text
 * @typedef {import('@codemirror/state').ChangeSet} ChangeSet
 * @typedef {import('@codemirror/view').DecorationSet} DecorationSet
 * @typedef {import('./search.js').Match} Match
 * @typedef {import('./search.js').SearchOptions} SearchOptions
 *
 * @typedef {Object} Found
 * @property {string} query - What is being looked for; empty while nothing is
 * @property {SearchOptions} options - How it is looked for
 * @property {Match[]} matches - Every match, in order
 * @property {number} current - Which of them the writer is on, or -1 for none
 *
 * @typedef {Found & {decorations: DecorationSet}} PlainSearchState
 */

/** @type {PlainSearchState} */
const NONE = { query: '', options: {}, matches: [], current: -1, decorations: Decoration.none }

const MATCH = Decoration.mark({ class: 'find-match' })
const CURRENT = Decoration.mark({ class: 'find-match find-match-current' })

/**
 * Every place the query is found in the text, in order.
 *
 * @param {Text} doc
 * @param {string} query
 * @param {SearchOptions} [options]
 * @returns {Match[]}
 */
export function findMatches(doc, query, options = {}) {
  if (!query) return []
  const pattern = patternFor(query, options)
  return [...doc.toString().matchAll(pattern)].map(found => {
    const from = found.index ?? 0
    return { from, to: from + found[0].length }
  })
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
 * @param {Found} found
 * @returns {PlainSearchState}
 */
const searchState = ({ query, options, matches, current }) => {
  if (!query) return NONE
  const decorations = Decoration.set(
    matches.map((match, index) => (index === current ? CURRENT : MATCH).range(match.from, match.to))
  )
  return { query, options, matches, current, decorations }
}

/** A search set whole, found against the text the transaction leaves. */
const setSearch = /** @type {import('@codemirror/state').StateEffectType<Found>} */ (
  StateEffect.define()
)

/**
 * The field that keeps the search. Any other change to the text finds the
 * query again, staying on the match that was current, or the next one if that
 * one went.
 */
export const plainSearch = StateField.define({
  create: () => NONE,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSearch)) return searchState(effect.value)
    if (!tr.docChanged || !value.query) return value
    const was = value.matches[value.current]
    const matches = findMatches(tr.state.doc, value.query, value.options)
    const current = was ? firstFrom(matches, tr.changes.mapPos(was.from)) : -1
    return searchState({ query: value.query, options: value.options, matches, current })
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

/**
 * The search a state holds. None for a state made without the field.
 *
 * @param {import('@codemirror/state').EditorState} state
 * @returns {PlainSearchState}
 */
export const searchOf = state => state.field(plainSearch, false) ?? NONE

/**
 * Set the search, with any change it comes with, and select the match it is on.
 *
 * @param {EditorView} view
 * @param {Found} found - Against the text after the change
 * @param {ChangeSet} [changes]
 */
const go = (view, found, changes) => {
  const match = found.matches[found.current]
  view.dispatch({
    changes,
    effects: setSearch.of(found),
    selection: match ? EditorSelection.range(match.from, match.to) : undefined,
  })
}

/**
 * Look for something, starting at the selection: as the query grows letter by
 * letter, the match the writer is on stays theirs for as long as it still
 * matches. An empty query is the search put away.
 *
 * @param {string} query
 * @param {SearchOptions} [options]
 * @returns {(view: EditorView) => boolean}
 */
export const find =
  (query, options = {}) =>
  view => {
    const matches = findMatches(view.state.doc, query, options)
    const current = firstFrom(matches, view.state.selection.main.from)
    go(view, { query, options, matches, current })
    return true
  }

/**
 * Move to the match after the one the writer is on, or before it, going round
 * at the ends. Nothing to do without a match.
 *
 * @param {1|-1} [step]
 * @returns {(view: EditorView) => boolean}
 */
export const findNext =
  (step = 1) =>
  view => {
    const { query, options, matches, current } = searchOf(view.state)
    if (matches.length === 0) return false
    const next =
      current === -1 ? firstFrom(matches, view.state.selection.main.from) : current + step
    go(view, { query, options, matches, current: (next + matches.length) % matches.length })
    return true
  }

/**
 * What goes in over a match: the replacement, in the capitals of what it
 * replaces where case does not count.
 *
 * @param {import('@codemirror/state').EditorState} state
 * @param {Match} match
 * @param {string} replacement
 * @param {SearchOptions} options
 * @returns {string}
 */
const written = (state, { from, to }, replacement, options) =>
  options.matchCase ? replacement : inCaseOf(state.sliceDoc(from, to), replacement)

/**
 * Replace the match the writer is on, and move to the next one after what
 * went in, so that a replacement holding the query is not found again.
 *
 * @param {string} replacement
 * @returns {(view: EditorView) => boolean}
 */
export const replaceCurrent = replacement => view => {
  const { query, options, matches, current } = searchOf(view.state)
  const match = matches[current]
  if (!match) return false
  const insert = written(view.state, match, replacement, options)
  const changes = view.state.changes({ from: match.from, to: match.to, insert })
  const found = findMatches(changes.apply(view.state.doc), query, options)
  const next = firstFrom(found, match.from + insert.length)
  go(view, { query, options, matches: found, current: next }, changes)
  return true
}

/**
 * Replace every match, as one change and so one undo. The selection stays
 * where it was, moved along with the text.
 *
 * @param {string} replacement
 * @returns {(view: EditorView) => boolean}
 */
export const replaceAll = replacement => view => {
  const { query, options, matches } = searchOf(view.state)
  if (matches.length === 0) return false
  const changes = view.state.changes(
    matches.map(match => ({
      from: match.from,
      to: match.to,
      insert: written(view.state, match, replacement, options),
    }))
  )
  const found = findMatches(changes.apply(view.state.doc), query, options)
  view.dispatch({
    changes,
    effects: setSearch.of({ query, options, matches: found, current: -1 }),
  })
  return true
}

/**
 * Bring the match the writer is on into sight, a third of the way down, unless
 * it is well in view already. CodeMirror would scroll it only as far as the
 * edge.
 *
 * @param {EditorView} view
 */
export const reveal = view => {
  const { matches, current } = searchOf(view.state)
  const match = matches[current]
  if (!match) return
  const box = view.scrollDOM.getBoundingClientRect()
  const at = view.coordsAtPos(match.from)
  const margin = Math.min(48, box.height / 4)
  if (at && at.top >= box.top + margin && at.bottom <= box.bottom - margin) return
  view.dispatch({
    effects: EditorView.scrollIntoView(match.from, { y: 'start', yMargin: box.height / 3 }),
  })
}
