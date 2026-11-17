/**
 * What a device takes of what comes to it.
 *
 * A record says for itself which table it is a row of, and which project
 * the row belongs to; so does a collection say which project it is. Neither
 * is believed: everyone a project is shared with holds its key and can seal
 * anything under it. A collection is a project only where nothing here says
 * the project is another's (`engine.js`, `learn`), and a record is taken only
 * as a row of the collection it came in: of one of its tables, under its own
 * id, in its own project.
 *
 * Design: `.llm/sync_design.md`.
 */

import { SETTINGS, SETUP, SETUP_TABLES, idOf } from './setup.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/** The tables a project is synced as. */
export const SYNCED = ['stories', 'documents', 'chats', 'messages', 'files', 'versions']

/** The tables the account's own collection is synced as: the setup's, and its settings. */
export const SETUP_SYNCED = [...SETUP_TABLES, SETTINGS]

/** The tables whose rows, in a shared project, are their writer's own. */
export const OWN = new Set(['chats', 'messages'])

/** What a project's id is made of. */
const STORY_ID = /^[A-Za-z0-9_-]{1,64}$/

/** What a root document's id begins with: `root_<its project>`. */
const ROOT = rootIdFor('')

/**
 * Whether this could be a project's id: the account's own collection is
 * kept under `SETUP` in a project's place, and is never a project.
 *
 * @param {unknown} id
 * @returns {id is string}
 */
export const isStoryId = id => typeof id === 'string' && id !== SETUP && STORY_ID.test(id)

/**
 * The collection a record came in, as far as taking it goes.
 *
 * @typedef {Object} From
 * @property {string} storyId - Its project, or `SETUP`
 * @property {boolean} [shared] - Whether it has ever been shared
 * @property {string} [role] - This account's part in it: `owner`, or a member's
 */

/**
 * Whether others hold a collection's key.
 * @param {From} collection
 */
const withOthers = collection =>
  Boolean(collection.shared) || (collection.role ?? 'owner') !== 'owner'

/**
 * Why a record is not taken, or null where it is: the tag counted for it,
 * never anything of the record's own.
 *
 * @param {From} collection
 * @param {any} payload - The record, opened
 * @param {{own?: boolean}} [how] - `own`, where it was sealed under this
 *   account's own key, which nobody else can do
 * @returns {string|null}
 */
export function refusal(collection, payload, { own = false } = {}) {
  if (!payload || typeof payload !== 'object') return 'shape'
  const { table, id, row } = payload
  if (typeof table !== 'string' || typeof id !== 'string' || id === '') return 'shape'
  const { storyId } = collection

  if (storyId === SETUP) {
    if (!SETUP_SYNCED.includes(table)) return 'table'
    if (payload.deleted) return null
    if (!isRow(row)) return 'shape'
    return idOf(table, row) === id ? null : 'id'
  }

  if (!SYNCED.includes(table)) return 'table'
  if (table === 'stories' && id !== storyId) return 'project'
  // A root is its project's alone, and anyone who knows a project knows its root's id.
  if (table === 'documents' && id.startsWith(ROOT) && id !== rootIdFor(storyId)) return 'project'
  if (payload.deleted) return null
  if (!isRow(row)) return 'shape'
  if (row.id !== id) return 'id'
  if (table === 'messages') {
    if (typeof row.chatId !== 'string' || row.chatId === '') return 'shape'
  } else if (table !== 'stories' && row.storyId !== storyId) return 'project'
  // A chat in a project others are in is its writer's own, and only they can seal one so.
  if (OWN.has(table) && withOthers(collection) && !own) return 'own'
  return null
}

/**
 * @param {unknown} row
 * @returns {row is Record<string, any>}
 */
const isRow = row => Boolean(row) && typeof row === 'object' && !Array.isArray(row)

/**
 * Whether a row about to be written is one of the project, or the setup, it
 * came for: asked again where it is written, whatever the engine let through.
 *
 * @param {string} storyId - The project, or `SETUP`
 * @param {{table: string, id: string, row: any|null}} incoming
 * @returns {boolean}
 */
export function belongs(storyId, { table, id, row }) {
  if (storyId === SETUP) return SETUP_SYNCED.includes(table)
  if (!SYNCED.includes(table)) return false
  if (table === 'stories') return id === storyId
  if (!row || table === 'messages') return true
  return row.storyId === storyId
}
