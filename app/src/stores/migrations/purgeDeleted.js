/**
 * @module stores/migrations/purgeDeleted
 * @description The trash, emptied for good.
 *
 * Until schema version 17 a delete only marked the row, and a sweep dropped
 * rows marked longer than a month. Now a delete removes the row, and there
 * is no trash to sweep — so what was in it when this version arrived goes,
 * in the database and in any backup restored from before. A file's bytes are
 * keyed by its document's id, and go with the document.
 */

/** The tables that carried the flag. */
export const FLAGGED_TABLES = [
  'stories',
  'documents',
  'chats',
  'messages',
  'aiProviders',
  'aiProfiles',
  'aiPrompts',
  'chatProfiles',
]

/**
 * @typedef {Object} Purged
 * @property {Record<string, any[]>} tables - The same tables, without the rows marked deleted
 * @property {number} removed - How many rows went, file rows included
 */

/**
 * Drop every row marked deleted, and the bytes of any file document among them.
 *
 * @param {Record<string, any[]>} tables - Rows by table name
 * @returns {Purged}
 */
export function withoutDeleted(tables) {
  /** @type {Record<string, any[]>} */
  const out = { ...tables }
  let removed = 0
  /** @type {Set<string>} */
  const goneFiles = new Set()

  for (const name of FLAGGED_TABLES) {
    const rows = tables[name]
    if (!Array.isArray(rows)) continue
    const kept = rows.filter(row => {
      if (!row?.deleted) return true
      if (name === 'documents' && row.type === 'file') goneFiles.add(row.id)
      removed++
      return false
    })
    if (kept.length !== rows.length) out[name] = kept
  }

  if (goneFiles.size > 0 && Array.isArray(tables.files)) {
    const files = tables.files.filter(row => !goneFiles.has(row?.id))
    removed += tables.files.length - files.length
    out.files = files
  }

  return { tables: out, removed }
}

/**
 * The ids of the rows in a table that are marked deleted.
 *
 * For the Dexie upgrade, which deletes by id rather than rewriting tables.
 *
 * @param {any[]} rows
 * @returns {string[]}
 */
export function deletedIds(rows) {
  return rows.filter(row => row?.deleted).map(row => row.id)
}
