/**
 * @module editor/marks
 * @description Where a mark runs in the text around a position: the link the
 * caret is in, or the comment.
 */

/**
 * The run of a mark of `type` the position is in, or against at either end,
 * within its textblock.
 *
 * @param {import('prosemirror-model').ResolvedPos} $pos
 * @param {import('prosemirror-model').MarkType} type
 * @returns {{from: number, to: number, mark: import('prosemirror-model').Mark}|null}
 */
export function markAround($pos, type) {
  const { parent } = $pos
  let index = $pos.index()
  let mark = index < parent.childCount ? type.isInSet(parent.child(index).marks) : null
  if (!mark && $pos.textOffset === 0 && index > 0) {
    index -= 1
    mark = type.isInSet(parent.child(index).marks)
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
  return { from, to, mark }
}
