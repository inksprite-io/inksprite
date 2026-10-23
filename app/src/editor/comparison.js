/**
 * @module editor/comparison
 * @description A version of a document against its text now, as one
 * document for the Versions dialog to show: the version as the editor would
 * show it, with what a restore would take out of the text now marked as
 * deletions, and what it would bring back as insertions, both under an id of
 * the comparison's own.
 *
 * The change is laid out as a suggested one is (`layOut` in
 * `suggestions.js`): block by block, then word by word in the blocks it
 * changed, a block with no words to mark taken out or brought back whole. It
 * is laid out from the version to the text now, so that what both have is
 * the version's, its comments and pending suggestions with it, and what the
 * version alone has that a pending suggestion is on is shown as that
 * suggestion. Then it is turned round to say what a restore does, and in
 * each change what goes comes first.
 *
 * Nothing here is written: no markup can hold the comparison's id, and what
 * is copied from it is the version's own text (`versionBetween`).
 */

import { Fragment } from 'prosemirror-model'
import { schema } from './schema.js'
import { layOut, settling } from './suggestions.js'

/** @typedef {import('prosemirror-model').Node} Node */
/** @typedef {import('prosemirror-model').Mark} Mark */
/** @typedef {import('prosemirror-model').MarkType} MarkType */

/** The id the comparison's marks carry, which no suggestion's markup can. */
export const COMPARED = '~restore'

/**
 * A version against the text now: the version, with the words and blocks a
 * restore would take out of the text now marked as deletions, and those it
 * would bring back as insertions. Null when the change cannot be laid out,
 * for the texts to be compared as they are written.
 *
 * @param {Node} version
 * @param {Node} now
 * @returns {Node|null}
 */
export function compareTexts(version, now) {
  const laid = layOut(version, now, COMPARED)
  return laid && turned(laid).node
}

/**
 * The version's own text between two places in a comparison: what a restore
 * takes out left out, and what it brings back as the version has it. For
 * copying a passage out of it.
 *
 * @param {Node} doc - A comparison
 * @param {number} from
 * @param {number} to
 * @returns {import('prosemirror-model').Slice}
 */
export function versionBetween(doc, from, to) {
  const tr = settling(doc, COMPARED, true)
  const start = tr.mapping.map(from, 1)
  return tr.doc.slice(start, Math.max(start, tr.mapping.map(to, -1)))
}

/**
 * A node of the comparison as laid out, turned round to say what a restore
 * does: each of the comparison's marks the other way, and in each run of
 * children that are all a restore's, one way or the other, those taken out
 * first. With the side it is wholly on, if it is: a block brought back or
 * taken out whole, or words of either. Unchanged where nothing in it is
 * marked. A table's rows and cells stay where they are, since each is a
 * place in the grid.
 *
 * @param {Node} node
 * @returns {Turned}
 */
function turned(node) {
  const mark = node.marks.find(isCompared)
  const flipped = mark ? otherOf(mark.type) : null
  const marks = mark
    ? /** @type {MarkType} */ (flipped)
        .create({ id: COMPARED })
        .addToSet(mark.removeFromSet(node.marks))
    : node.marks
  if (node.isLeaf) return { node: mark ? node.mark(marks) : node, side: flipped }
  /** @type {Turned[]} */
  const children = []
  let changed = !!mark
  node.forEach(child => {
    const each = turned(child)
    if (each.node !== child) changed = true
    children.push(each)
  })
  if (!changed) return { node, side: null }
  const grid = node.type === schema.nodes.table || node.type === schema.nodes.table_row
  const ordered = grid ? children : goneFirst(node, children)
  const whole =
    !grid && ordered.length > 0 && ordered.every(each => each.side && each.side === ordered[0].side)
  const content = Fragment.fromArray(ordered.map(each => each.node))
  return {
    node: node.type.create(node.attrs, content, marks),
    side: flipped ?? (whole ? ordered[0].side : null),
  }
}

/**
 * A node turned round, and the side of a restore it is wholly on, if either:
 * the mark it is taken out or brought back by.
 *
 * @typedef {{node: Node, side: MarkType|null}} Turned
 */

/**
 * A node's children with what a restore takes out before what it brings
 * back, in each run of them that are all one or the other: words put in for
 * words taken out, a block for a block. The rest stay where they are, and
 * all of them do where the node could not hold them so: an item's first
 * block is its paragraph.
 *
 * @param {Node} node
 * @param {Turned[]} children
 * @returns {Turned[]}
 */
function goneFirst(node, children) {
  /** @type {Turned[]} */
  const out = []
  for (let i = 0; i < children.length; ) {
    if (!children[i].side) {
      out.push(children[i++])
      continue
    }
    let end = i
    while (end < children.length && children[end].side) end++
    const run = children.slice(i, end)
    out.push(...run.filter(each => each.side === schema.marks.deletion))
    out.push(...run.filter(each => each.side !== schema.marks.deletion))
    i = end
  }
  const fits = node.type.validContent(Fragment.fromArray(out.map(each => each.node)))
  return fits ? out : children
}

/** @param {MarkType} type */
const otherOf = type =>
  type === schema.marks.insertion ? schema.marks.deletion : schema.marks.insertion

/** @param {Mark} mark */
const isCompared = mark =>
  (mark.type === schema.marks.insertion || mark.type === schema.marks.deletion) &&
  mark.attrs.id === COMPARED
