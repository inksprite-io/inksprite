/**
 * @module cloud/format
 * @description What a synced row may hold, as a number every record carries
 * beside its schema. The schema follows the tables; the format follows what
 * is in them: the markup a document's text may hold, the fields a row may
 * have and what they mean. An app that meets a record of a newer format, or
 * a newer schema, holds that project's pull until it is updated, since its
 * editor would drop markup it doesn't know, and its stores fields, as it
 * saved over them.
 *
 * A record carries the oldest format that holds it, so that an older app is
 * held only by a record it would harm, and a project with none of them goes
 * on syncing with it.
 *
 * Design: `.llm/sync_design.md`, "Schema versions".
 */

/**
 * The newest format this app reads, and so the newest a record it writes may
 * carry. Raise it by one when a synced row may come to hold what an older app
 * would lose or change on its way through: the editor learning a node, a
 * mark or an attribute, new markup in a document's text, or a field coming
 * to mean something else; and say in `formatOf` which records carry it. A
 * new table or index raises the schema instead. Records from before formats
 * carry none, which reads as 0.
 */
export const FORMAT = 2

/** What every record has carried at the least since formats began, 21 Oct 2026. */
const FIRST = 1

/**
 * The format a document is written in for its text: what the editor holds
 * (`editor/schema.js`, which a test pins to it). Raised with `FORMAT` when
 * the editor learns a node, a mark or an attribute, or a text may hold new
 * markup.
 */
export const TEXT_FORMAT = 1

/**
 * The format a document held by a text or an imported file is written in,
 * rather than by a folder (`.llm/nested_documents_design.md`). An older
 * desktop app lays one out at the top of its project on disk, reads it back
 * from there, and sends that on as a move.
 */
export const HELD_FORMAT = 2

/**
 * The format a record is written in: the oldest that holds it.
 *
 * @param {string} table
 * @param {any} row - The row it sends; null for one it removes
 * @param {string} [parentType] - For a document, its parent's type, when its
 *   parent is a document here
 * @returns {number}
 */
export function formatOf(table, row, parentType) {
  if (table !== 'documents' || !row) return FIRST
  const held = parentType !== undefined && parentType !== 'folder'
  return Math.max(TEXT_FORMAT, held ? HELD_FORMAT : FIRST)
}
