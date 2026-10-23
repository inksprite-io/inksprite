/**
 * @module cloud/tree
 * @description A project's tree as two devices' changes, merged, can leave
 * it, and what puts it right.
 *
 * Each device keeps its tree whole, but a merge takes each document's fields
 * on their own, and the two together can make what neither did:
 *
 * - **A document whose folder is gone**: moved into a folder on one device
 *   while that folder was deleted for good on the other.
 * - **A loop**: one device moved a folder into a second while the other moved
 *   the second into the first.
 * - **Two siblings of one name**: a "Chapter 3" made in one folder on each
 *   device, which the app never lets happen on one.
 *
 * The first two go to the project's root, after what is there; of two
 * siblings of one name, the one made first keeps it, and the other takes the
 * next free one, "Chapter 3 (2)". The fixes depend on the rows alone, so two
 * devices that see the same tree make the same ones, and their merge agrees.
 *
 * Design: `.llm/sync_design.md`, "Merging".
 */

import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { freeTitle, titleKey } from '@/utils/documentPath.js'
import { trashedIds } from '@/utils/trash.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * The documents to write again to put a project's tree right, each as it is
 * to be: none when the tree is whole.
 *
 * @param {Document[]} documents - The project's, in the trash and out of it
 * @param {string} storyId
 * @param {number} now - When the fixes are made
 * @returns {Document[]}
 */
export function treeFixes(documents, storyId, now) {
  const rootId = rootIdFor(storyId)
  /** @type {Map<string, Document>} */
  const byId = new Map(documents.map(document => [document.id, document]))
  if (!byId.has(rootId)) return []
  /** @type {Map<string, Document>} */
  const fixed = new Map()
  /** @param {string} id */
  const current = id => /** @type {Document} */ (fixed.get(id) ?? byId.get(id))
  /** @param {string} id */
  const change = (id, /** @type {Partial<Document>} */ fields) =>
    fixed.set(id, { ...current(id), ...fields, updated: now })

  /** @param {string} parentId */
  const childrenOf = parentId =>
    [...byId.keys()].map(current).filter(document => document.parentId === parentId)

  /** Into the root, after its last. @param {string} id */
  const toRoot = id => {
    const last = Math.max(-1, ...childrenOf(rootId).map(document => document.order ?? 0))
    change(id, { parentId: rootId, order: last + 1 })
  }

  // In id order, so every device moves the same documents to the same places.
  const ids = [...byId.keys()].sort()
  /** A document's folder is one of the project's, or the project itself, as a root's is. */
  const placed = (/** @type {Document} */ document) =>
    byId.has(document.parentId) || document.parentId === storyId

  for (const id of ids) if (id !== rootId && !placed(current(id))) toRoot(id)

  /** @type {Set<string>} */
  const settled = new Set([rootId])
  for (const id of ids) {
    /** @type {string[]} */
    const path = []
    let at = id
    while (byId.has(at) && !settled.has(at)) {
      const loop = path.indexOf(at)
      if (loop >= 0) {
        toRoot(path.slice(loop).sort()[0])
        break
      }
      path.push(at)
      at = current(at).parentId
    }
    for (const passed of path) settled.add(passed)
  }

  // Names matter in the tree, not in the trash.
  const inTrash = trashedIds([...byId.keys()].map(current))
  const byFolder = groupBy(
    [...byId.keys()].map(current).filter(document => !inTrash.has(document.id)),
    document => document.parentId
  )
  for (const siblings of byFolder.values()) {
    for (const same of groupBy(siblings, document => titleKey(document.title)).values()) {
      if (same.length < 2) continue
      const [, ...after] = same.sort(
        (a, b) => (a.created ?? 0) - (b.created ?? 0) || (a.id < b.id ? -1 : 1)
      )
      for (const document of after) {
        const others = siblings.map(sibling => current(sibling.id))
        change(document.id, { title: freeTitle(others, document.title, document.id) })
      }
    }
  }
  return [...fixed.values()]
}

/**
 * Items by a key of each, in the order they came. `Map.groupBy` is newer
 * than some of the Safaris the app runs in.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {Map<string, T[]>}
 */
function groupBy(items, keyOf) {
  /** @type {Map<string, T[]>} */
  const groups = new Map()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}
