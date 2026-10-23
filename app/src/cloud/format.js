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
 * Design: `.llm/sync_design.md`, "Schema versions".
 */

/**
 * The format this app writes. Raise it by one when a synced row may come to
 * hold what an older app would lose or change on its way through: the editor
 * learning a node, a mark or an attribute (`editor/schema.js`, which a test
 * pins to this number), new markup in a document's text, or a field coming
 * to mean something else. A new table or index raises the schema instead.
 * Records from before formats carry none, which reads as 0.
 */
export const FORMAT = 1
