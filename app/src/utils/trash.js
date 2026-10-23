/**
 * @module utils/trash
 * @description The trash's rules, shared by the stores that keep it: how long
 * something stays there, and which of a project's documents are in it.
 *
 * What was deleted carries `trashed`, when it went. What is inside a trashed
 * folder keeps its row as it was and is in the trash because the folder is,
 * so that it goes and comes back with the folder. The stores keep what is in
 * the trash apart from what everything else reads. See
 * `.llm/trash_design.md`.
 */

/** @typedef {import('../types/models.js').Document} Document */

/** How long the trash keeps what is in it: 30 days, in milliseconds. */
export const TRASH_KEPT_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Whether something in the trash has been there long enough to go for good.
 *
 * @param {{trashed?: number}} row
 * @param {number} [now]
 * @returns {boolean}
 */
export const expired = (row, now = Date.now()) =>
  typeof row.trashed === 'number' && now - row.trashed >= TRASH_KEPT_MS

/**
 * The documents in the trash: each one trashed, and every one under a
 * trashed folder. A document whose folders loop, or lead nowhere, is in it
 * only if one of them was trashed.
 *
 * @param {Iterable<Document>} documents - A project's, or any set of them
 * @returns {Set<string>} Their ids
 */
export function trashedIds(documents) {
  /** @type {Map<string, Document>} */
  const byId = new Map()
  for (const document of documents) byId.set(document.id, document)

  /** @type {Map<string, boolean>} */
  const known = new Map()
  /** @type {Set<string>} */
  const out = new Set()
  for (const document of byId.values()) {
    /** @type {Set<string>} */
    const seen = new Set()
    let at = /** @type {Document|undefined} */ (document)
    let inTrash = false
    while (at && !seen.has(at.id)) {
      const already = known.get(at.id)
      if (already !== undefined) {
        inTrash = already
        break
      }
      seen.add(at.id)
      if (at.trashed) {
        inTrash = true
        break
      }
      at = byId.get(at.parentId)
    }
    for (const id of seen) known.set(id, inTrash)
    if (inTrash) out.add(document.id)
  }
  return out
}

/**
 * A project's documents without what is in its trash.
 *
 * @param {Document[]} documents
 * @returns {Document[]}
 */
export function outOfTrash(documents) {
  const inTrash = trashedIds(documents)
  return inTrash.size === 0 ? documents : documents.filter(document => !inTrash.has(document.id))
}
