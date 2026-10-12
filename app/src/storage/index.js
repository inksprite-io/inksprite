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
 * @typedef {'aiProviders'|'aiProfiles'|'aiPrompts'|'chatProfiles'|'skills'|'skillWordings'|'mcpServers'|'webSearch'|'jobs'|'projectViews'} AppTable
 */

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
 * @property {(table: string) => boolean} has - Whether there is such a table
 * @property {(table: string, changes: Change[]) => Promise<void>} write -
 *   Write and remove rows of one table, of either kind, together: what `syncStore` saves
 * @property {() => Promise<Record<string, any[]>>} dump - Every row of every table, for a backup
 * @property {(tables: Record<string, any[]>, keep?: string[]) => Promise<number>} replaceAll -
 *   Replace every table but those in `keep` with a backup's rows, all or none, emptying those
 *   it has none for. Resolves to how many rows were written.
 */

import { dexieStorage } from './dexie.js'

/** @type {Storage} */
let current = dexieStorage

/**
 * Storage as the app reaches it: IndexedDB until `useStorage` says
 * otherwise, which the desktop app does before anything is read
 * (`open.js`).
 *
 * @type {Storage}
 */
export const storage = /** @type {Storage} */ (
  Object.fromEntries(
    Object.keys(dexieStorage).map(name => [
      name,
      (/** @type {any[]} */ ...args) => /** @type {any} */ (current)[name](...args),
    ])
  )
)

/**
 * Keep the rows somewhere else from now on. Before anything is read: the
 * stores keep what they read, and would not read it again.
 *
 * @param {Storage} next
 */
export function useStorage(next) {
  current = next
}
