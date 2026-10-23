/**
 * @module utils/wordDiff
 * @description Two texts laid out as one, word by word: what both have, what
 * only the first has, and what only the second has. For showing a version of
 * a plain document against its text now, as both are written; a structured
 * document's are laid out as the editor shows them (`editor/comparison.js`).
 *
 * Words are compared with the spaces between them, so that the pieces read
 * back as the texts. Past so many changes word by word, the texts are
 * compared line by line instead, and past as many lines, shown whole.
 */

import { diffSequences } from './diff.js'

/**
 * @typedef {Object} Piece
 * @property {string} text
 * @property {'both'|'first'|'second'} in - Which of the texts has it
 */

/** How many words or lines may differ before a finer comparison gives up. */
const MOST_CHANGES = 3000

/** @param {string} text */
const wordsOf = text => text.split(/(\s+)/).filter(Boolean)

/** @param {string} text */
const linesOf = text => text.split(/(\n)/).filter(Boolean)

/**
 * The pieces two texts make, in order: where they differ, what only the first
 * has comes before what only the second has.
 *
 * @param {string} first
 * @param {string} second
 * @returns {Piece[]}
 */
export function textChanges(first, second) {
  for (const split of [wordsOf, linesOf]) {
    const a = split(first)
    const b = split(second)
    const steps = diffSequences(a, b, { maxEdits: MOST_CHANGES })
    if (!steps) continue
    /** @type {Piece[]} */
    const pieces = []
    const add = (/** @type {string} */ text, /** @type {Piece['in']} */ where) => {
      const last = pieces[pieces.length - 1]
      if (last?.in === where) last.text += text
      else pieces.push({ text, in: where })
    }
    for (const step of steps) {
      if (step.op === 'equal') add(a[step.a], 'both')
      else if (step.op === 'delete') add(a[step.a], 'first')
      else add(b[step.b], 'second')
    }
    return pieces
  }
  return /** @type {Piece[]} */ ([
    { text: first, in: 'first' },
    { text: second, in: 'second' },
  ]).filter(piece => piece.text)
}
