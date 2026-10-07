/* global atob, btoa, Blob */
/**
 * @module utils/backup
 * @description Pure helpers for whole-database export and import.
 *
 * Everything here operates on plain arrays so it can be tested without an
 * IndexedDB implementation. The Dexie reads and writes live in
 * `composables/useBackup.js`. One transform, v13's, needs a DOM to read the
 * HTML documents used to hold; the page has one and so does the test runner.
 *
 * A backup is a snapshot of every table plus enough metadata to know whether
 * it can be restored into the running app. The schema version matters: a
 * backup taken before a migration holds rows in the *old* shape, so restoring
 * it into a newer database has to move those rows forward first. That is what
 * `UPGRADES` is for.
 *
 * A single chat, or a project with its chats, is exported in the same
 * envelope, marked by `scope`, so the same transforms carry it forward. Each
 * is read back in its own place and never interchangeably: a chat file is
 * added to a story, a project file is added beside the others, a whole backup
 * replaces everything.
 */

import { nanoid } from 'nanoid'

import { partsAndScenesToDocuments } from '../stores/migrations/documents.js'
import { documentsToProjectTree } from '../stores/migrations/projectTree.js'
import { loreToDocuments } from '../stores/migrations/lore.js'
import { lastSceneToLastDocument } from '../stores/migrations/lastDocument.js'
import { overviewToRootSummary } from '../stores/migrations/overview.js'
import { commandArgsToInput } from '../stores/migrations/commandInput.js'
import { commandsIntoTheirVoice } from '../stores/migrations/commandVoice.js'
import { markCharacters } from '../stores/migrations/characterSigil.js'
import { foldTurns } from '../stores/migrations/turnSegments.js'
import { foldRuns } from '../stores/migrations/turnRuns.js'
import { documentsToMarkdown } from '../stores/migrations/markdown.js'
import {
  promptsToProfiles,
  chatsToProfiles,
  storiesToProfiles,
} from '../stores/migrations/profiles.js'
import { summariesIntoPlace } from '../stores/migrations/summariesInPlace.js'
import { withoutDeleted } from '../stores/migrations/purgeDeleted.js'
import { rolesToSkills } from '../stores/migrations/profileSkills.js'
import { rolesToWorkflows } from '../stores/migrations/jobWorkflows.js'
import { withoutModelKeeps } from '../stores/migrations/modelKeeps.js'
import { allowedProvidersToPresets } from '../stores/migrations/allowedProviders.js'

/** Format of the backup envelope itself, independent of the database schema. */
export const BACKUP_FORMAT = 1

/**
 * @typedef {'database'|'chat'|'project'} BackupScope
 *
 * @typedef {Record<string, any[]>} TableData
 *
 * @typedef {Object} Backup
 * @property {string} app - Always 'inksprite'; guards against importing a stray JSON file
 * @property {number} format - Envelope format, see BACKUP_FORMAT
 * @property {number} dbVersion - Dexie schema version the rows were written at
 * @property {number} exported - Timestamp
 * @property {boolean} includesApiKeys - Whether provider credentials were kept
 * @property {BackupScope} [scope] - What the file holds: every table, one chat and its messages, or one project and its chats. Files written before there was a choice have none, and hold the database.
 * @property {TableData} tables - Row arrays keyed by table name
 */

/**
 * What a file can hold, and where in the app each kind is read back — for
 * telling a writer who picked the right file in the wrong place.
 *
 * @type {Record<string, {noun: string, hint: string}>}
 */
const SCOPES = {
  database: { noun: 'a whole backup', hint: 'Restore it from the Data settings.' },
  chat: { noun: 'one chat', hint: 'Import it from the chat list.' },
  project: { noun: 'one project', hint: 'Import it from the project list.' },
}

/**
 * Forward transforms keyed by the schema version they produce. A backup at
 * version N is upgraded by applying every transform above N, in order.
 *
 * Each entry takes and returns plain table data. A migration that reshapes
 * rows should share its transform with the Dexie upgrade hook rather than
 * reimplementing it, so the two can never drift.
 *
 * @type {Record<number, (tables: TableData) => TableData>}
 */
const UPGRADES = {
  // v2 added `aiPrompts`. No existing row changed, so the table just starts empty.
  2: tables => ({ aiPrompts: [], ...tables }),

  // v3 folded parts and scenes into documents. A backup taken before that
  // upgrade holds only the old rows, so they are rebuilt here with the same
  // transform the Dexie hook runs. The old tables ride along untouched; they
  // still exist, and they are the way back.
  3: tables => ({
    documents: partsAndScenesToDocuments(tables.parts || [], tables.scenes || []).documents,
    ...tables,
  }),

  // v4 gave every story a root node and default folders. The transform is
  // idempotent, so a backup that already has one restores unchanged.
  4: tables => ({
    ...tables,
    documents: documentsToProjectTree(tables.documents || [], tables.stories || []).documents,
  }),

  // v5 folded lore into the tree. The transform returns only the documents it
  // adds, and skips entries that are already documents, so a backup taken
  // after the upgrade restores without duplicating anything.
  5: tables => ({
    ...tables,
    documents: [
      ...(tables.documents || []),
      ...loreToDocuments(tables.lorebooks || [], tables.loreEntries || [], tables.documents || [])
        .documents,
    ],
  }),

  // v6 renamed Story.lastSceneId to lastDocumentId.
  6: tables => ({
    ...tables,
    stories: lastSceneToLastDocument(tables.stories || []).stories,
  }),

  // v7 moved Story.overview onto the root document's summary. The transform
  // returns the roots it changed rather than new rows, so these replace their
  // existing entries instead of being appended.
  7: tables => ({
    ...tables,
    documents: replaceById(
      tables.documents || [],
      overviewToRootSummary(tables.stories || [], tables.documents || []).documents
    ),
  }),

  // v8 rewrote stored slash commands from `args` to `input` and `param`. The
  // transform is idempotent, so a backup already holding the new shape
  // restores unchanged.
  8: tables => ({
    ...tables,
    messages: commandArgsToInput(tables.messages || []).messages,
  }),

  // v9 gave a command's message its answer as its content, and moved the ones
  // that consulted a model into the assistant's voice. Idempotent, so a backup
  // already in that shape restores unchanged.
  9: tables => ({
    ...tables,
    messages: commandsIntoTheirVoice(tables.messages || []).messages,
  }),

  // v10 put the answer on the record: which stored commands are people, rather
  // than leaving it to be worked out from a command list that can change.
  10: tables => ({
    ...tables,
    messages: markCharacters(tables.messages || []).messages,
  }),

  // v11 folded each of the writer's turns into one message holding what it was
  // made of. Rows disappear here rather than only changing shape, which is the
  // one thing no transform above this does.
  11: tables => ({
    ...tables,
    messages: foldTurns(tables.messages || []).messages,
  }),

  // v12 folded each run of the writer's messages into one, the way the app
  // now keeps them as it goes.
  12: tables => ({
    ...tables,
    messages: foldRuns(tables.messages || []).messages,
  }),

  // v13 made documents markdown. The first transform here that needs a DOM:
  // the HTML is read through the editor's schema, which is the only honest
  // account of what it held.
  13: tables => ({
    ...tables,
    documents: replaceById(
      tables.documents || [],
      documentsToMarkdown(tables.documents || []).documents
    ),
  }),

  // v14 turned the prompt library into chat profiles. The saved prompts keep
  // their ids as profiles, so the chats and projects that named one carry the
  // id straight across. `aiPrompts` stays in the file: it is the record of
  // what was there, and a table nobody reads costs nothing.
  14: tables => ({
    ...tables,
    chatProfiles: [
      ...(tables.chatProfiles || []),
      ...promptsToProfiles(tables.aiPrompts || []).profiles,
    ],
    chats: chatsToProfiles(tables.chats || []).chats,
    stories: storiesToProfiles(tables.stories || []).stories,
  }),

  // v15 moved each summary to where it is read: above the turns it kept,
  // rather than at the end of the chat with a count of how far to hoist it.
  15: tables => ({
    ...tables,
    messages: replaceById(
      tables.messages || [],
      summariesIntoPlace(tables.messages || []).messages
    ),
  }),

  // v16 added `files`, the bytes behind file documents. No existing row
  // changed, so the table starts empty.
  16: tables => ({ files: [], ...tables }),

  // v17 emptied the trash: a delete removes its row now, and rows a backup
  // still carries as marked are what the sweep would have dropped anyway.
  17: tables => withoutDeleted(tables).tables,

  // v18 added `jobs`, the long work a model does for a project. No existing
  // row changed, so the table starts empty.
  18: tables => ({ jobs: [], ...tables }),

  // v19 moved a profile's wording for its roles onto its skills. Idempotent,
  // so a backup already in that shape restores unchanged.
  19: tables => ({
    ...tables,
    chatProfiles: rolesToSkills(tables.chatProfiles || []).profiles,
  }),

  // v20 added `skills`, the writer's own. No existing row changed, so the
  // table starts empty.
  20: tables => ({ skills: [], ...tables }),

  // v21 moved a job's `role` to `workflow`, the settings its model is picked
  // from having been renamed. Idempotent.
  21: tables => ({
    ...tables,
    jobs: rolesToWorkflows(tables.jobs || []).jobs,
  }),

  // v22 added `mcpServers`, the writer's connected servers. No existing row
  // changed, so the table starts empty.
  22: tables => ({ mcpServers: [], ...tables }),

  // v23 took the model's keeps off each chat's pins: only the writer pins.
  // Idempotent.
  23: tables => ({
    ...tables,
    chats: withoutModelKeeps(tables.chats || []).chats,
  }),

  // v24 moved each connection's allowed providers onto the presets that use
  // it. Idempotent.
  24: tables => {
    const { providers, presets } = allowedProvidersToPresets(
      tables.aiProviders || [],
      tables.aiProfiles || []
    )
    return { ...tables, aiProviders: providers, aiProfiles: presets }
  },
}

/**
 * Bytes as base64, a slice at a time.
 *
 * Spreading a whole file into `fromCharCode` overflows the stack, and a PDF is
 * megabytes; the limit is on the call, so slices of it cost nothing.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
  const SLICE = 8192
  let binary = ''
  for (let at = 0; at < bytes.length; at += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(at, at + SLICE))
  }
  return btoa(binary)
}

/**
 * @param {string} base64
 * @returns {Uint8Array<ArrayBuffer>}
 */
function fromBase64(base64) {
  const binary = atob(base64)
  // Over a fresh ArrayBuffer, which is what a Blob is typed to take.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
  return bytes
}

/**
 * A `files` row as JSON can carry it.
 *
 * A Blob stringifies to `{}`, so a backup that took the table as read would
 * hold every file's name and none of its bytes, and say nothing about it. The
 * bytes go out as base64 with the media type beside them; the file grows by a
 * third, which is what base64 costs.
 *
 * @typedef {Object} SerializedFile
 * @property {string} id
 * @property {string} storyId
 * @property {string} mime - The blob's type
 * @property {string} data - Its bytes, base64
 *
 * @param {import('../types/models.js').StoredFile[]} rows
 * @returns {Promise<SerializedFile[]>}
 */
export async function serializeFiles(rows) {
  return Promise.all(
    rows.map(async row => ({
      id: row.id,
      storyId: row.storyId,
      mime: row.blob?.type || '',
      data: row.blob ? toBase64(new Uint8Array(await row.blob.arrayBuffer())) : '',
    }))
  )
}

/**
 * The rows back as the database holds them.
 *
 * @param {SerializedFile[]} rows
 * @returns {import('../types/models.js').StoredFile[]}
 */
export function deserializeFiles(rows) {
  return rows.map(row => ({
    id: row.id,
    storyId: row.storyId,
    blob: new Blob([fromBase64(row.data || '')], { type: row.mime || '' }),
  }))
}

/**
 * Overlay changed rows onto a table, matching by id.
 *
 * @param {any[]} rows
 * @param {any[]} changed
 * @returns {any[]}
 */
function replaceById(rows, changed) {
  if (changed.length === 0) return rows
  const byId = new Map(changed.map(row => [row.id, row]))
  return rows.map(row => byId.get(row?.id) || row)
}

/**
 * Drop persisted credentials from provider rows.
 *
 * Providers saved with `rememberKey: false` keep their key in sessionStorage
 * and never reach the database, so they are already absent here.
 *
 * @param {any[]} providers
 * @returns {any[]} Providers with `apiKey` removed
 */
export function redactApiKeys(providers) {
  return providers.map(provider => {
    if (!provider || !('apiKey' in provider)) return provider
    const { apiKey: _apiKey, ...rest } = provider
    return rest
  })
}

/**
 * Assemble a backup envelope from raw table contents.
 *
 * @param {TableData} tables - Every table, keyed by name
 * @param {object} opts
 * @param {number} opts.dbVersion - Schema version the rows came from
 * @param {boolean} [opts.includeApiKeys] - Keep provider credentials (default false)
 * @param {number} [opts.exported] - Timestamp, injectable for tests
 * @param {BackupScope} [opts.scope] - What the tables hold (default the whole database)
 * @returns {Backup}
 */
export function buildBackup(
  tables,
  { dbVersion, includeApiKeys = false, exported = Date.now(), scope = 'database' }
) {
  /** @type {TableData} */
  const out = {}
  for (const [name, rows] of Object.entries(tables)) {
    out[name] = name === 'aiProviders' && !includeApiKeys ? redactApiKeys(rows) : rows
  }

  return {
    app: 'inksprite',
    format: BACKUP_FORMAT,
    dbVersion,
    exported,
    includesApiKeys: includeApiKeys,
    scope,
    tables: out,
  }
}

/**
 * Check that parsed JSON is a backup this build can read.
 *
 * @param {any} data - Result of JSON.parse on an uploaded file
 * @param {number} currentDbVersion - Schema version of the running database
 * @param {BackupScope} [scope] - What the caller is expecting the file to hold
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateBackup(data, currentDbVersion, scope = 'database') {
  /** @type {string[]} */
  const errors = []

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Not a backup file.'] }
  }
  if (data.app !== 'inksprite') {
    errors.push('This file was not exported from inksprite.')
  }
  const held = data.scope ?? 'database'
  if (held !== scope) {
    errors.push(
      held in SCOPES
        ? `This file holds ${SCOPES[held].noun}, not ${SCOPES[scope].noun}. ${SCOPES[held].hint}`
        : `This file holds something this version of inksprite does not understand (${held}). Update the app first.`
    )
  }
  if (typeof data.format !== 'number') {
    errors.push('Missing backup format.')
  } else if (data.format > BACKUP_FORMAT) {
    errors.push(
      `Backup format ${data.format} is newer than this version of inksprite understands (${BACKUP_FORMAT}). Update the app first.`
    )
  }
  if (typeof data.dbVersion !== 'number') {
    errors.push('Missing schema version.')
  } else if (data.dbVersion > currentDbVersion) {
    errors.push(
      `Backup was taken at schema version ${data.dbVersion}, newer than this app's (${currentDbVersion}). Update the app first.`
    )
  } else if (data.dbVersion < currentDbVersion) {
    // Restoring older rows is supported, but only where a transform exists.
    // Without one the rows would land in the wrong shape and read as corrupt.
    for (let v = data.dbVersion + 1; v <= currentDbVersion; v++) {
      if (!UPGRADES[v]) errors.push(`No upgrade path from schema version ${v - 1} to ${v}.`)
    }
  }
  if (!data.tables || typeof data.tables !== 'object' || Array.isArray(data.tables)) {
    errors.push('Backup contains no tables.')
  } else {
    for (const [name, rows] of Object.entries(data.tables)) {
      if (!Array.isArray(rows)) errors.push(`Table '${name}' is not a list of rows.`)
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Move table data forward to the running schema version.
 *
 * @param {TableData} tables
 * @param {number} fromVersion - Schema version the rows were written at
 * @param {number} toVersion - Schema version of the running database
 * @returns {TableData}
 * @throws {Error} If a version in the range has no registered transform
 */
export function upgradeTables(tables, fromVersion, toVersion) {
  if (fromVersion > toVersion) {
    throw new Error(`Cannot downgrade a backup from schema version ${fromVersion} to ${toVersion}`)
  }

  let out = tables
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    const upgrade = UPGRADES[v]
    if (!upgrade) throw new Error(`No backup upgrade path to schema version ${v}`)
    out = upgrade(out)
  }
  return out
}

/**
 * Row counts per table, for showing what an import is about to replace.
 * Tables with no rows are omitted — an empty list is noise in a summary.
 *
 * @param {Backup} backup
 * @returns {Array<{table: string, count: number}>} Largest first
 */
export function summarizeBackup(backup) {
  return Object.entries(backup.tables || {})
    .map(([table, rows]) => ({ table, count: Array.isArray(rows) ? rows.length : 0 }))
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.table.localeCompare(b.table))
}

/**
 * Filename for a downloaded backup, e.g. `inksprite-backup-2026-08-23.json`.
 *
 * @param {Date} date
 * @returns {string}
 */
export function backupFilename(date) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `inksprite-backup-${stamp}.json`
}

/**
 * A title as a filename's words: lower case, letters and digits joined by
 * hyphens, cut to a length a file browser shows.
 *
 * @param {string} title
 * @returns {string}
 */
function slugOf(title) {
  const slug = (title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'untitled'
}

/**
 * Filename for a downloaded chat, e.g. `inksprite-chat-plot-holes-in-act-two.json`.
 *
 * @param {string} title
 * @returns {string}
 */
export function chatFilename(title) {
  return `inksprite-chat-${slugOf(title)}.json`
}

/**
 * Filename for a downloaded project, e.g. `inksprite-project-the-salt-road.json`.
 *
 * @param {string} title - The project's name
 * @returns {string}
 */
export function projectFilename(title) {
  return `inksprite-project-${slugOf(title)}.json`
}

/**
 * Pick the chat out of a single-chat file, with its messages in order.
 *
 * The file is a table snapshot like any backup, so what it holds can include
 * rows deleted before the export. Those stay out.
 *
 * The prompt the chat ran on comes along when the file has it — a prompt of
 * the user's own, which the importing library may not hold.
 *
 * @param {TableData} tables - Already moved forward to the running schema
 * @returns {{chat: import('../types/models.js').Chat, messages: import('../types/models.js').Message[], prompt?: import('../types/models.js').AIPrompt}}
 * @throws {Error} If there is no chat in the file
 */
export function chatFromTables(tables) {
  const chat = (tables.chats || []).find(row => row)
  if (!chat) throw new Error('There is no chat in this file.')

  const messages = (tables.messages || [])
    .filter(row => row && row.chatId === chat.id)
    .sort((a, b) => a.created - b.created)

  const prompt = (tables.aiPrompts || []).find(row => row && row.id === chat.promptId)

  return prompt ? { chat, messages, prompt } : { chat, messages }
}

/**
 * One project's rows, as a project file holds them.
 *
 * @typedef {Object} ProjectRows
 * @property {import('../types/models.js').Story} story
 * @property {import('../types/models.js').Document[]} documents - Its whole tree, root included
 * @property {SerializedFile[]} files - The bytes behind its file documents, still as the file carries them
 * @property {import('../types/models.js').Chat[]} chats
 * @property {import('../types/models.js').Message[]} messages - Every chat's
 * @property {import('../types/models.js').StoredChatProfile[]} profiles - The writer's own profiles the project and its chats run on; built-ins are wherever the file is opened
 */

/**
 * Pick the project out of a project file.
 *
 * The file holds one story and only what belongs to it, but it is read as
 * though it might hold more: a row that names another story, or a chat that
 * is not there, stays out rather than being carried into the project under an
 * id nothing else uses.
 *
 * @param {TableData} tables - Already moved forward to the running schema
 * @returns {ProjectRows}
 * @throws {Error} If there is no project in the file
 */
export function projectFromTables(tables) {
  const story = (tables.stories || []).find(row => row)
  if (!story) throw new Error('There is no project in this file.')

  /** @param {any[]} [rows] */
  const own = rows => (rows || []).filter(row => row && row.storyId === story.id)
  const chats = own(tables.chats)
  const chatIds = new Set(chats.map(chat => chat.id))

  return {
    story,
    documents: own(tables.documents),
    files: own(tables.files),
    chats,
    messages: (tables.messages || []).filter(row => row && chatIds.has(row.chatId)),
    profiles: (tables.chatProfiles || []).filter(row => row && row.id),
  }
}

/**
 * The same project under new ids, so it can be added beside the one it was
 * exported from — or beside an earlier import of the same file — without
 * either overwriting the other.
 *
 * Ids are replaced wherever they appear rather than in a list of the fields
 * that hold one. A document is named by id in a chat's pins, in an edit a turn
 * made, in a tool call's arguments, in a read the model was shown; a list
 * would miss the next field to hold one, and this does not. An id is long and
 * random, so text that merely looks like one does not come up.
 *
 * The documents whose ids are built from the story's — the root above all,
 * which is found by `rootIdFor(storyId)` — get no id of their own: the story's
 * new id, replaced inside theirs, gives them the one the app will look for.
 *
 * The writer's profiles keep their ids. They are the library's rather than
 * the project's, and one the library already holds is the one to use.
 *
 * @param {ProjectRows} project
 * @param {(prefix: string) => string} [mint] - A new id for a row of the kind the prefix names
 * @returns {ProjectRows}
 */
export function withFreshIds(project, mint = prefix => `${prefix}_${nanoid()}`) {
  const { story, documents, files, chats, messages, profiles } = project

  /** @type {Map<string, string>} */
  const ids = new Map([[story.id, mint('story')]])
  /**
   * @param {Array<{id: string}>} rows
   * @param {string} prefix
   */
  const renew = (rows, prefix) => {
    for (const row of rows) if (!row.id.includes(story.id)) ids.set(row.id, mint(prefix))
  }
  renew(documents, 'doc')
  renew(chats, 'chat')
  renew(messages, 'message')

  const rewrite = idRewriter(ids)
  /** @type {<T>(rows: T[]) => T[]} */
  const rewriteRows = rows => rows.map(row => rewriteIds(row, rewrite))

  return {
    story: rewriteIds(story, rewrite),
    documents: rewriteRows(documents),
    // Only where they are, not what they hold: the bytes are base64, which has
    // no ids in it, and can be megabytes of nothing to search.
    files: files.map(file => ({ ...file, id: rewrite(file.id), storyId: rewrite(file.storyId) })),
    chats: rewriteRows(chats),
    messages: rewriteRows(messages),
    profiles,
  }
}

/**
 * Replace every id a string holds.
 *
 * Only runs of nanoid's alphabet that have an underscore in them can hold an
 * id, and only those are looked at. A run is searched rather than looked up
 * whole: an id can sit inside a longer one, as the story's does in its root's,
 * or behind an escape in JSON held as a string, where `\ndoc_…` reads as one
 * run beginning with the `n`. Where two ids could match at once the longer
 * one wins.
 *
 * @param {Map<string, string>} ids - Old id to new
 * @returns {(text: string) => string}
 */
function idRewriter(ids) {
  const lengths = [...new Set([...ids.keys()].map(id => id.length))].sort((a, b) => b - a)
  const shortest = lengths[lengths.length - 1]

  /** @param {string} run */
  const rewriteRun = run => {
    let out = ''
    let from = 0
    for (let at = 0; at + shortest <= run.length; ) {
      const length = lengths.find(n => at + n <= run.length && ids.has(run.slice(at, at + n)))
      if (length === undefined) {
        at++
        continue
      }
      out += run.slice(from, at) + ids.get(run.slice(at, at + length))
      at += length
      from = at
    }
    return from === 0 ? run : out + run.slice(from)
  }

  return text =>
    text.length >= shortest && text.includes('_')
      ? text.replace(/[\w-]+/g, run =>
          run.length >= shortest && run.includes('_') ? rewriteRun(run) : run
        )
      : text
}

/**
 * A row with every string in it, keys included, passed through `rewrite`.
 *
 * @template T
 * @param {T} value - Plain data, as JSON makes it
 * @param {(text: string) => string} rewrite
 * @returns {T}
 */
function rewriteIds(value, rewrite) {
  if (typeof value === 'string') return /** @type {T} */ (rewrite(value))
  if (Array.isArray(value)) return /** @type {T} */ (value.map(item => rewriteIds(item, rewrite)))
  if (value && typeof value === 'object') {
    return /** @type {T} */ (
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [rewrite(key), rewriteIds(item, rewrite)])
      )
    )
  }
  return value
}
