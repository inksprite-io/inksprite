/**
 * @module stores/migrations/overview
 * @description Move `Story.overview` onto the root document's `summary`.
 *
 * The root node is the story: its title is the story's name, and the tree the
 * model reads is a list of titles and summaries. An overview living on the
 * story row was a second place for the same idea, reachable only through a
 * dialog and invisible to anything that walks documents.
 *
 * Once it is the root's summary it is one line of the project listing, edited
 * the same way every other summary is edited, and the system message no longer
 * needs a section of its own to carry it.
 *
 * The story row keeps its `overview` field. Nothing reads it afterwards, but
 * it is the way back, exactly like the legacy tables before it.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

import { rootIdFor } from './projectTree.js'

/** @typedef {import('../../types/models.js').Story} Story */
/** @typedef {import('../../types/models.js').Document} Document */

/**
 * Copy each story's overview onto its root document's summary.
 *
 * Only the documents that change are returned, so the caller can `bulkPut`
 * them over the existing rows without rewriting the whole table.
 *
 * Idempotent, and careful about which way it writes: a root that already has a
 * summary keeps it. A re-imported backup must not walk a summary the writer has
 * since edited back to the overview it was copied from.
 *
 * @param {Story[]} stories
 * @param {Document[]} documents
 * @returns {{documents: Document[], moved: number}}
 */
export function overviewToRootSummary(stories, documents) {
  /** @type {Map<string, Document>} */
  const byId = new Map()
  for (const document of documents || []) {
    if (document?.id) byId.set(document.id, document)
  }

  /** @type {Document[]} */
  const out = []

  for (const story of stories || []) {
    const overview = story?.overview?.trim()
    if (!story?.id || !overview) continue

    const root = byId.get(rootIdFor(story.id))
    // A story with no root has not been through the v4 upgrade, and there is
    // nothing to hang the overview on. Leave the row alone rather than
    // inventing a document here.
    // Rows from before v17 may still carry the old soft-delete flag.
    if (!root || /** @type {any} */ (root).deleted) continue

    // The root's own summary wins. It is either already this overview, from an
    // earlier run, or something newer the writer typed.
    if (root.summary?.trim()) continue

    out.push({ ...root, summary: overview })
  }

  return { documents: out, moved: out.length }
}
