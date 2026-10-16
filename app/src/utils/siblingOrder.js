/**
 * @module utils/siblingOrder
 * @description The order a folder's children are shown in.
 */

import { compareNames } from './compareNames.js'

/**
 * A folder's children in the order the outline shows them.
 *
 * An ordered folder sorts by `order`; anything else sorts the way a file
 * explorer does, folders first and then by title, numbers by value. A
 * document nobody has named sorts as the "Untitled" it reads as, rather than
 * as an empty title ahead of everything. Ties fall back to the id, so equal
 * keys don't shuffle between renders.
 *
 * @param {import('../types/models.js').Document[]} children - Sorted in place
 * @param {boolean} [ordered] - Whether the folder they are in is ordered
 * @returns {import('../types/models.js').Document[]} The same array
 */
export function orderSiblings(children, ordered = false) {
  const byId = (
    /** @type {import('../types/models.js').Document} */ a,
    /** @type {import('../types/models.js').Document} */ b
  ) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0)

  if (ordered) return children.sort((a, b) => a.order - b.order || byId(a, b))

  const named = (/** @type {import('../types/models.js').Document} */ document) =>
    document.title?.trim() || 'Untitled'
  const folder = (/** @type {import('../types/models.js').Document} */ document) =>
    document.type === 'folder' ? 0 : 1
  return children.sort(
    (a, b) => folder(a) - folder(b) || compareNames(named(a), named(b)) || byId(a, b)
  )
}
