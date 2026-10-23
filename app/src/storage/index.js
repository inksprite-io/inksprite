/* global queueMicrotask */
/**
 * @module storage
 * @description Where the app's rows are kept.
 *
 * The one module that reads and writes the database; nothing else imports
 * `stores/db.js`, and lint says so. The stores hold rows in memory and hand
 * their changes to `syncStore`, which writes them here; everything they read
 * that is not already in memory comes from here too.
 *
 * The rows fall in two kinds:
 *
 * - **Project tables** - `stories`, `documents`, `files`, `chats` and
 *   `messages`: a project and everything in it. They are read the ways the
 *   app reads them (a project's tree, a chat's messages, a file's bytes)
 *   rather than as tables, because in the desktop app they are to live in a
 *   folder of files, where those reads are cheap and a query across every
 *   project is not.
 * - **App tables** - the writer's connections, presets, prompts, profiles,
 *   skills and MCP servers, and the jobs under way: configuration and work
 *   on this copy of the app, which stays in IndexedDB everywhere. They are
 *   read and written as plain tables.
 *
 * On the web all of it is Dexie (`dexie.js`). In the desktop app the
 * projects are in a folder the writer chose, and the rest is Dexie still
 * (`library.js`, chosen as the app opens by `open.js`). What a project is as a folder
 * of files, for the desktop app, is here too, as plain functions over rows
 * and paths that touch no disk:
 *
 * - **layout** - Where each document of a project goes, and the documents a
 *   folder holds when it is read back
 * - **documents** - One document as its file: frontmatter and body, or the
 *   hidden file beside an imported one, or a repository's list
 * - **names** - Filenames made from titles that every system takes
 * - **frontmatter** - YAML at the top of a markdown file
 * - **plan** - The moves, trashes and writes from one layout to the next
 * - **chats** - A chat's row and messages, written only where they changed
 * - **library** - Storage in the library, through the main process's files
 * - **open** - Which storage the app opens with, and the window's projects
 *   moved into the library the first time
 *
 * Design: `.llm/markdown_library_design.md`, step 3.
 *
 * @example
 * import { storage } from '@/storage/index.js'
 *
 * const documents = await storage.documents(storyId)
 * const presets = await storage.all('aiProfiles')
 */

/**
 * @typedef {import('../types/models.js').Story} Story
 * @typedef {import('../types/models.js').Document} Document
 * @typedef {import('../types/models.js').Chat} Chat
 * @typedef {import('../types/models.js').Message} Message
 * @typedef {import('../types/models.js').StoredFile} StoredFile
 * @typedef {import('../types/models.js').Change} Change
 * @typedef {import('../types/models.js').DocBase} DocBase
 * @typedef {import('../types/models.js').Version} Version
 */

/**
 * The tables a project is made of.
 * @typedef {'stories'|'documents'|'files'|'chats'|'messages'} ProjectTable
 */

/**
 * The tables a project is made of, which the desktop app keeps in its
 * library; the rest are the app's own, kept in IndexedDB everywhere.
 * @type {ProjectTable[]}
 */
export const PROJECT_TABLES = ['stories', 'documents', 'files', 'chats', 'messages']

/**
 * The tables that belong to the app rather than to a project.
 * @typedef {'aiProviders'|'aiProfiles'|'aiPrompts'|'chatProfiles'|'skills'|'skillWordings'|'mcpServers'|'webSearch'|'jobs'|'projectViews'|'cards'|'cardFiles'|'cloudState'|'cloudOutbox'|'cloudRecords'|'versions'} AppTable
 */

/**
 * The app tables whose rows are a project's all the same, and are synced
 * with it: its documents' versions, kept in IndexedDB beside the library.
 */
export const PROJECT_APP_TABLES = ['versions']

/**
 * A project's rows, ready to be added beside the others.
 * @typedef {Object} NewProject
 * @property {Story} story
 * @property {Document[]} documents
 * @property {StoredFile[]} files
 * @property {Chat[]} chats
 * @property {Message[]} messages
 */

/**
 * Told how far a long piece of work has got: how much of it is done, of how much.
 * @typedef {(done: number, total: number) => void} Progress
 */

/**
 * @typedef {Object} Storage
 * @property {() => number} schemaVersion - The version the rows are in, which a backup records
 * @property {() => Promise<Story[]>} stories - Every project's record
 * @property {(keep: string[]) => Promise<void>} refreshProjects - Read the list of projects
 *   again, after another window changed it, but for these, which this window has open
 * @property {(storyId: string) => Promise<void>} reopenProject - Forget what was read of a
 *   project, which another window may have changed since, to read it again when asked for
 * @property {(id: string) => Promise<Story|undefined>} story - One project's record
 * @property {(storyId: string) => Promise<Document[]>} documents - A project's whole tree
 * @property {(storyIds: string[]) => Promise<Document[]>} roots - These projects' roots, those there are
 * @property {(storyId: string) => Promise<Chat[]>} chats - A project's chats
 * @property {(id: string) => Promise<Chat|undefined>} chat - One chat
 * @property {(chatId: string) => Promise<Message[]>} messages - A chat's messages, in no order
 * @property {(id: string) => Promise<Blob|null>} fileBytes - A file document's bytes
 * @property {(storyId: string) => Promise<StoredFile[]>} projectFiles - The bytes of every file in a project
 * @property {(id: string, storyId: string, blob: Blob) => Promise<void>} putFileBytes - Keep a file document's bytes
 * @property {() => boolean} audioKept - Whether narration audio is kept past the session: in the
 *   library, not in a browser
 * @property {(storyId: string, documentId: string) => Promise<string[]>} audioKeys - The keys of
 *   the clips kept of a document's narration
 * @property {(storyId: string, documentId: string, key: string) => Promise<ArrayBuffer|null>} readAudio -
 *   One clip of a document's narration
 * @property {(storyId: string, documentId: string, key: string, audio: ArrayBuffer) => Promise<void>} writeAudio -
 *   Keep a clip of a document's narration
 * @property {(storyId: string, documentId: string, keys?: string[]) => Promise<void>} removeAudio -
 *   Delete these clips of a document's narration, or with no keys all of it
 * @property {(storyId: string, documentId: string) => Promise<DocBase|null>} readBase - A
 *   linked document's base, if it has one
 * @property {(base: DocBase) => Promise<void>} writeBase - Keep a linked document's base
 * @property {(storyId: string, documentId: string) => Promise<void>} removeBase - Forget a
 *   document's base
 * @property {(table: 'chats'|'messages', change: (row: any) => object|null) => Promise<number>} updateEach -
 *   Change every row of a table, in every project, open or not: `change` returns the fields
 *   to set, or null to leave the row. Resolves to how many changed.
 * @property {(project: NewProject, progress?: Progress) => Promise<void>} addProject - Add a
 *   project's rows, all or none, saying how far it has got where it takes a while
 * @property {(storyId: string) => Promise<void>} removeProject - Take a project away whole: its
 *   rows, or in the library its folder, to the trash
 * @property {(table: AppTable) => Promise<any[]>} all - Every row of an app table
 * @property {(table: AppTable) => Promise<number>} count - How many rows an app table holds, none of them read
 * @property {(table: AppTable, id: string) => Promise<any>} get - One row of an app table
 * @property {(table: AppTable, ids: string[]) => Promise<any[]>} getMany - These rows of an app table, those there are
 * @property {(table: AppTable, row: object) => Promise<void>} put - Write a row of an app table
 * @property {(table: AppTable, ids: string[]) => Promise<void>} remove - Remove rows of an app table
 * @property {(table: AppTable, storyId: string) => Promise<any[]>} ofStory - The rows of an app table for one project
 * @property {(documentId: string) => Promise<Version[]>} versionsOf - A document's versions, in no order
 * @property {(table: string) => boolean} has - Whether there is such a table
 * @property {(table: string, changes: Change[]) => Promise<void>} write -
 *   Write and remove rows of one table, of either kind, together: what `syncStore` saves
 * @property {() => Promise<Record<string, any[]>>} dump - Every row of every table, for a
 *   backup, but the linked documents' bases and what sync keeps of this device
 * @property {(tables: Record<string, any[]>, keep?: string[]) => Promise<number>} replaceAll -
 *   Replace every table but those in `keep` with a backup's rows, all or none, emptying those
 *   it has none for. Resolves to how many rows were written.
 */

/**
 * A write that sync sends, as those watching are told of it once it is
 * made: rows of a project or of the setup written or removed, a project
 * added or taken away, a file's bytes kept, or rows changed in every
 * project. A project added comes without its files' bytes.
 *
 * @typedef {{method: 'write', table: string, changes: Change[]}
 *   | {method: 'addProject', project: Omit<NewProject, 'files'> & {files: Array<{id: string, storyId: string}>}}
 *   | {method: 'removeProject', storyId: string}
 *   | {method: 'putFileBytes', id: string, storyId: string}
 *   | {method: 'updateEach', table: string, rows: any[]}} Written
 */

import { dexieStorage } from './dexie.js'
import { tellOtherWindows } from '@/platform/windows.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { SETUP_TABLES, idOf } from '@/cloud/setup.js'

/** @type {Storage} */
let current = dexieStorage

/**
 * What a write tells the other windows the app is open in, once it is done
 * (`platform/windows.js`): the app tables it wrote, which they read again; a
 * project come, gone or renamed, for their lists of projects; and everything
 * replaced, which they reload for. A project's own rows are left out: it is
 * open in one window at a time.
 *
 * @type {Partial<Record<keyof Storage, (...args: any[]) => void>>}
 */
const TOLD = {
  put: table => tablesWritten(table),
  remove: table => tablesWritten(table),
  write: (table, /** @type {Change[]} */ changes) => {
    if (!PROJECT_TABLES.includes(table)) tablesWritten(table)
    else if (table === 'stories' || changes.some(isRoot)) tellOtherWindows({ type: 'projects' })
  },
  addProject: () => tellOtherWindows({ type: 'projects' }),
  removeProject: () => tellOtherWindows({ type: 'projects' }),
  replaceAll: () => tellOtherWindows({ type: 'reload' }),
}

/**
 * Whether sync sends a table's rows: a project's, or the setup's
 * (`cloud/setup.js`).
 * @param {string} table
 */
const synced = table => [...PROJECT_TABLES, ...PROJECT_APP_TABLES, ...SETUP_TABLES].includes(table)

/**
 * What each write that sync sends tells those watching (`onWrittenForSync`).
 *
 * @type {Partial<Record<keyof Storage, (...args: any[]) => Written|null>>}
 */
const WATCHED = {
  write: (table, changes) => (synced(table) ? { method: 'write', table, changes } : null),
  put: (table, row) =>
    SETUP_TABLES.includes(table)
      ? {
          method: 'write',
          table,
          changes: [
            {
              entityType: table,
              id: idOf(table, row),
              op: 'put',
              data: row,
              timestamp: Date.now(),
            },
          ],
        }
      : null,
  remove: (table, /** @type {string[]} */ ids) =>
    SETUP_TABLES.includes(table)
      ? {
          method: 'write',
          table,
          changes: ids.map(id => ({
            entityType: table,
            id,
            op: 'delete',
            data: null,
            timestamp: 0,
          })),
        }
      : null,
  addProject: (/** @type {NewProject} */ project) => ({
    method: 'addProject',
    project: { ...project, files: project.files.map(({ id, storyId }) => ({ id, storyId })) },
  }),
  removeProject: storyId => ({ method: 'removeProject', storyId }),
  putFileBytes: (id, storyId) => ({ method: 'putFileBytes', id, storyId }),
}

/** @type {Set<(written: Written) => void>} */
const watchers = new Set()

/**
 * Be told of every write that sync sends once it is made, in this window:
 * to a project, or to the setup.
 *
 * @param {(written: Written) => void} watcher
 * @returns {() => void} Stop being told
 */
export function onWrittenForSync(watcher) {
  watchers.add(watcher)
  return () => watchers.delete(watcher)
}

/** @param {Written|null} written */
function tellWatchers(written) {
  if (written) for (const watcher of watchers) watcher(written)
}

/** @param {Change} change */
const isRoot = change => Boolean(change.data && change.id === rootIdFor(change.data.storyId))

/** @type {Set<string>} App tables written since the other windows were last told */
const written = new Set()

/**
 * Tell the other windows of an app table written, with the others written
 * in the same moment.
 *
 * @param {string} table
 */
function tablesWritten(table) {
  if (written.size === 0) {
    queueMicrotask(() => {
      tellOtherWindows({ type: 'tables', tables: [...written] })
      written.clear()
    })
  }
  written.add(table)
}

/**
 * Storage as the app reaches it: IndexedDB until `useStorage` says
 * otherwise, which the desktop app does before anything is read
 * (`open.js`).
 *
 * @type {Storage}
 */
export const storage = /** @type {Storage} */ (
  Object.fromEntries(
    Object.keys(dexieStorage).map(name => {
      const told = TOLD[/** @type {keyof Storage} */ (name)]
      const watched = WATCHED[/** @type {keyof Storage} */ (name)]
      return [
        name,
        name === 'updateEach'
          ? updateEach
          : told || watched
            ? async (/** @type {any[]} */ ...args) => {
                const result = await /** @type {any} */ (current)[name](...args)
                told?.(...args)
                if (watched && watchers.size > 0) tellWatchers(watched(...args))
                return result
              }
            : (/** @type {any[]} */ ...args) => /** @type {any} */ (current)[name](...args),
      ]
    })
  )
)

/**
 * `updateEach`, telling those watching of the rows it changed.
 *
 * @type {Storage['updateEach']}
 */
async function updateEach(table, change) {
  /** @type {any[]} */
  const rows = []
  const changed = await current.updateEach(table, row => {
    const changes = change(row)
    if (changes && watchers.size > 0) rows.push({ ...row, ...changes })
    return changes
  })
  if (rows.length > 0) tellWatchers({ method: 'updateEach', table, rows })
  return changed
}

/**
 * Keep the rows somewhere else from now on. Before anything is read: the
 * stores keep what they read, and would not read it again.
 *
 * @param {Storage} next
 */
export function useStorage(next) {
  current = next
}
