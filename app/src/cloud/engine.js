/* global Blob */
/**
 * @module cloud/engine
 * @description Sync's rounds: what this device wrote, sent; what the others
 * wrote, brought in; and the two merged where both changed one row.
 *
 * Every write to a project reaches `noteWrite`, from the storage facade,
 * and is put in the **outbox** by its row, the row as written. Beside it
 * the device keeps a **record** of each row as the server last had it: its
 * revision, a fingerprint, and for the rows merged three ways the row
 * itself, the base of the next merge. A **round** then:
 *
 * 1. Lists the collections, and pulls each project this window syncs from
 *    where it last read up to. A row with nothing waiting here is written
 *    here as it came. One with something waiting is merged, and the merge
 *    is written here and waits to go back.
 * 2. Pushes the outbox, each row against the revision it was based on. A
 *    row the server took leaves the outbox; one that moved on meanwhile
 *    comes back, is merged as in a pull, and goes in the next round.
 * 3. Fetches the bytes this device lacks that it wants at once: pictures,
 *    which their documents show. A file's bytes are fetched when they are
 *    wanted (`fetchFile`): when the file is opened, converted or backed up.
 *
 * Beside the projects, the account has a collection of its own: the
 * writer's setup and card library (`cloud/setup.js`). Its rows are kept as a
 * project's are, under `SETUP` where a project's are under its story's id,
 * and merged the same way. It carries no meta, so an app from before it was
 * synced passes over it; this one knows it by its id, made from the
 * account's key. A device's first sync of it puts the whole setup in the
 * outbox, as a first sync does every project; where the account has a row
 * already, the account's stands, and a row this device made as every install
 * makes it is never sent, so that a new device's defaults stand over nobody's.
 *
 * A merge can leave a project's tree broken in ways neither device made it:
 * a document whose folder is gone, a loop, two siblings of one name
 * (`cloud/tree.js`). The engine looks at the tree of each project a pull
 * brought documents to, and puts right what is still wrong a while later:
 * what another device sends in two pushes can be seen between them, a child
 * before its folder.
 *
 * A write is put in the outbox just after it is made, and a page closed
 * between the two loses it to sync. Once a launch, and when the writer asks
 * for a sync, the engine compares every row here with the server's as it
 * last had it, and puts in the outbox those that differ (`check`). Only
 * changes: a row missing here could as well be one that couldn't be read,
 * and a removal sent for it would remove it everywhere.
 *
 * What the engine writes here comes back to it through the facade like any
 * other write; it expects those, and leaves them out of the outbox.
 *
 * A server put back from a backup has gone back in time: it may lack what
 * it answered for since. It says so with a new generation, and the engine
 * then syncs as on a first sync, every row it has sent again, so that
 * nothing it wrote is lost.
 *
 * A project the writer keeps on this device only (`syncOff` on its story)
 * is left out of every round: its writes never wait to go, and what the
 * server has of it, nothing. Kept off, it is taken off the server once, by
 * a round, as a project kept rather than deleted. The other devices move
 * their copies to their trash and keep them out of sync as well
 * (`keptElsewhere`), until the project is on the server again; synced
 * again, it goes up whole, as on a first sync, and they take it back.
 *
 * A record written by a newer app, in a newer schema or format
 * (`cloud/format.js`), holds its project's pull where it is until this app
 * is updated: what came before it is written here, and it and what came
 * after wait on the server. The device still sends what it writes, but a row
 * a newer app wrote since waits in the outbox, unmerged, since a merge here
 * would lose what that app knows. The status says sync waits for an update.
 *
 * A project is shared with friends by their friend codes (`share`): the
 * project's key wrapped for each one's public key, which their first device
 * wraps again under their account key as it first sees the project, and
 * which it then brings in as a project made elsewhere. In a shared project a
 * chat and its messages are their writer's own: sealed under a key only
 * that account makes, and served by the server to it alone. Sharing sends
 * the owner's chats again so before anyone else has the key, and the server
 * takes a push to a shared project only from a device that knows it is
 * shared. Who is in each shared project is asked again as the number
 * changes, and told to the app (`onSharing`). A friend who left, or was
 * removed, has the project moved to the trash, out of sync, as one another
 * device kept to itself; one the owner deleted goes as for its owner, but
 * with edits waiting it stays here in the trash, out of sync, rather than
 * go up again.
 *
 * Past the account's quota, the server refuses what would take more room,
 * record by record, and a file's parts; those wait in the outbox, the rest
 * syncs, and the status says the storage is full.
 *
 * The engine counts what it does for the server's diagnostics
 * (`cloud/diagnostics.js`): counts and tags, never content.
 *
 * The engine knows nothing of the stores: `Local` is how it reaches the
 * app, and `State` where it keeps the outbox, the records and how far it has
 * read (IndexedDB, in the app).
 *
 * Design: `.llm/sync_design.md`, "On the device".
 */

import {
  collectionKeys,
  fingerprint,
  friendCode,
  hashName,
  makeKeyPair,
  open,
  openFor,
  openJson,
  openPrivateKey,
  ownKeys,
  randomBytes,
  readFriendCode,
  seal,
  sealFor,
  sealJson,
  toBase64,
} from './crypto.js'
import { CloudError } from './api.js'
import { UNCOUNTED, errorTag } from './diagnostics.js'
import { FORMAT } from './format.js'
import { comparable, mergeRow } from './merge.js'
import { SETTINGS, SETUP, SETUP_TABLES, asMade, asSent, idOf } from './setup.js'
import { treeFixes } from './tree.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/** @typedef {import('./api.js').Api} Api */
/** @typedef {import('./api.js').ListedCollection} ListedCollection */
/** @typedef {import('./crypto.js').AccountKeys} AccountKeys */
/** @typedef {import('./crypto.js').Bytes} Bytes */
/** @typedef {import('./crypto.js').CollectionKeys} CollectionKeys */
/** @typedef {import('@/types/models.js').Change} Change */
/** @typedef {import('@/storage/index.js').Written} Written */

/** The tables a project is synced as. */
export const SYNCED = ['stories', 'documents', 'chats', 'messages', 'files', 'versions']

/** The tables the account's own collection is synced as: the setup's, and its settings. */
const SETUP_SYNCED = [...SETUP_TABLES, SETTINGS]

/** The tables whose rows are kept as the base of a three-way merge. */
const MERGED = new Set([
  'stories',
  'documents',
  'chats',
  ...SETUP_SYNCED.filter(table => table !== 'cardFiles'),
])

/** The tables with a trash. */
const TRASHED = new Set(['stories', 'documents', 'chats'])

/** The tables whose rows, in a shared project, are their writer's own. */
const OWN = new Set(['chats', 'messages'])

/**
 * The tables whose rows carry bytes, sent as a file's parts and never
 * changed once sent: a project's files, and the card library's pictures.
 */
const BYTES = new Set(['files', 'cardFiles'])

/**
 * A row edited on one device and deleted on another, as it comes back: in
 * the trash, where the table has one, so that nothing written is lost and
 * nothing deleted reappears. A project's root goes with its project, never on
 * its own. See `.llm/trash_design.md`.
 *
 * @param {string} storyId
 * @param {string} table
 * @param {any} row
 * @returns {any} The row, or a copy of it in the trash
 */
function intoTrash(storyId, table, row) {
  if (!TRASHED.has(table) || !row || row.trashed) return row
  if (table === 'documents' && row.id === rootIdFor(storyId)) return row
  return { ...row, trashed: Date.now() }
}

/** How much of a file goes in one part. */
export const PART_SIZE = 4 * 1024 * 1024

/** How much a push carries at most, records once encrypted. */
const PUSH_BYTES = 4 * 1024 * 1024

/** What `expected` holds for a row the engine removed here. */
const GONE = 'gone'

/** What `expected` holds for bytes the engine fetched and kept here. */
const FETCHED = 'fetched'

/** How many rounds one call runs at most, while conflicts send it round again. */
const MOST_ROUNDS = 5

/**
 * How long a broken tree is left as it is, in case it is only half of what
 * another device is still sending.
 */
export const SETTLE_MS = 30_000

/** How long a reply that never said it finished is taken to be still streaming. */
const STREAMING_MS = 2 * 60 * 1000

/**
 * A row waiting to be sent, by its key: `documents:doc_x`.
 *
 * @typedef {Object} Waiting
 * @property {string} id
 * @property {string} table
 * @property {string} rowId
 * @property {'put'|'delete'} op
 * @property {any} [data] - The row as written; none for a file, whose bytes
 *   are read when it is sent
 * @property {string|null} storyId - Its project, where the row says, or `SETUP`
 * @property {string} [chatId] - A message's chat, which says its project
 * @property {string} [blob] - A file's blob, once its upload has begun
 * @property {boolean} [first] - Put there by the device's first sync of the
 *   setup: where the account has the row already, the account's stands
 * @property {WrittenBy} [ahead] - A newer app's copy on the server, which a row
 *   with no record here waits behind, as `Kept`'s does
 * @property {number} at - When it was written
 */

/**
 * A row as the server last had it.
 *
 * @typedef {Object} Kept
 * @property {string} id
 * @property {string} storyId - Its project, or `SETUP`
 * @property {string} name - What the server knows it by
 * @property {number} rev
 * @property {string|null} print - The row's fingerprint; null once removed
 * @property {any} [row] - The row itself, for the tables merged three ways
 * @property {FileInfo} [file] - A file's bytes, as uploaded
 * @property {WrittenBy} [ahead] - The server's copy, written since by a newer
 *   app, which this row's waiting change holds for until this app is updated
 * @property {boolean} [own] - Sealed under this account's own key: a chat, or
 *   a message, in a shared project
 */

/**
 * The schema and format a record was written in.
 *
 * @typedef {Object} WrittenBy
 * @property {number} schema
 * @property {number} format
 */

/**
 * A file's bytes as uploaded.
 *
 * @typedef {Object} FileInfo
 * @property {string} blob
 * @property {number} size
 * @property {string} type
 * @property {number} parts
 */

/**
 * Bytes on the server that this device has yet to have, as the round that
 * brought their record left them, in its own table.
 *
 * @typedef {Object} Pending
 * @property {string} id - `file:<id>`
 * @property {string} storyId
 * @property {string} collection
 * @property {string} [table] - `files` where absent, as before cards had pictures
 * @property {string} fileId
 * @property {FileInfo} file
 * @property {any} [row] - A card's row, to keep with its picture
 */

/**
 * How far this device has read a project's collection.
 *
 * @typedef {Object} Reading
 * @property {string} id - `collection:<storyId>`
 * @property {string} storyId
 * @property {string} collection
 * @property {number} cursor
 * @property {number} epoch
 * @property {WrittenBy} [held] - What the record from a newer app that it
 *   stopped at was written in: it pulls no further until this app is updated
 * @property {boolean} [partial] - Held partway through reading it whole: read
 *   whole again, from the start, once this app is updated
 */

/**
 * A row the server sent, as the app is to write it.
 *
 * @typedef {Object} Incoming
 * @property {string} table
 * @property {string} id
 * @property {any|null} row - Null to remove it
 * @property {any} [replaced] - A document as this device had it, which a merge
 *   with another device's changes is about to change: kept as a version first
 */

/**
 * A document's text that lost a clash with this device's.
 *
 * @typedef {Object} Clash
 * @property {any} of - The document as the merge left it
 * @property {string} content - The other device's text, whole
 * @property {boolean} large - More than a paragraph or two clashed, and
 *   nothing of the other text was merged in
 */

/**
 * What a record holds once opened.
 *
 * @typedef {Object} Payload
 * @property {string} table
 * @property {string} id
 * @property {number} schema
 * @property {number} [format] - None on a record from before formats: 0
 * @property {any} [row]
 * @property {boolean} [deleted]
 * @property {FileInfo} [file]
 */

/**
 * A project's rows, files without their bytes.
 *
 * @typedef {Object} ProjectRows
 * @property {any} story
 * @property {any[]} documents
 * @property {any[]} chats
 * @property {any[]} messages
 * @property {Array<{id: string, storyId: string}>} files - The bytes it has to
 *   send, by the document or picture they are of: never a repository's source
 *   file, which is its text alone
 * @property {any[]} [versions] - Its documents' versions
 */

/**
 * The app, as the engine reaches it.
 *
 * @typedef {Object} Local
 * @property {() => Promise<void>} settle - Have everything typed so far written
 * @property {() => Promise<string[]>} projects - The projects here, by id
 * @property {(storyId: string) => Promise<ProjectRows|null>} readProject
 * @property {() => Promise<Record<string, any[]>>} readSetup - The setup's rows here, by
 *   table, its settings among them
 * @property {(storyId: string) => Promise<any[]>} tree - A project's documents, in the
 *   trash and out of it, as they stand here
 * @property {(chatId: string) => Promise<string|null>} storyOfChat
 * @property {(table: string, id: string) => Promise<Blob|null>} fileBytes - A file's
 *   bytes, or a library card's picture
 * @property {(storyId: string, incoming: Incoming[]) => Promise<void>} write - Rows of a
 *   project, or of the setup
 * @property {(project: ProjectRows) => Promise<void>} addProject
 * @property {(storyId: string) => Promise<void>} removeProject
 * @property {(table: string, id: string, storyId: string, blob: Blob, row?: any) => Promise<void>} putFileBytes -
 *   Keep bytes that came: a file's, or a library card's picture with the rest of its row
 * @property {(table: string, id: string) => boolean} fetchesAtOnce - Whether bytes that came
 *   are fetched with the round, as a picture is, rather than when they are wanted
 * @property {(storyId: string, clash: Clash) => Promise<void>} keepClash - Keep the
 *   text that lost a clash, as a version of its document
 * @property {(storyId: string) => boolean} syncsHere - Whether this window syncs the project
 * @property {() => Promise<Map<string, 'here'|'elsewhere'>>} keptOff - The projects this
 *   device keeps off sync: those the writer keeps on it alone, and those another
 *   device keeps to itself, in the trash here
 */

/**
 * Where the engine keeps its own rows: the app tables of that name.
 *
 * @typedef {Object} State
 * @property {(table: string, id: string) => Promise<any>} get
 * @property {(table: string) => Promise<any[]>} all
 * @property {(table: string, storyId: string) => Promise<any[]>} ofStory
 * @property {(table: string, changes: Change[]) => Promise<void>} write
 */

/**
 * What sync is doing, for the settings to show.
 *
 * @typedef {Object} Status
 * @property {'idle'|'syncing'|'offline'|'error'|'held'} phase - Held: waiting
 *   for this app to be updated, to bring in what a newer one wrote or to send
 *   anything
 * @property {number} waiting - Rows waiting to be sent
 * @property {number|null} last - When a round last finished
 * @property {string|null} error
 * @property {boolean} [full] - The account's storage is full, and some rows wait for room
 */

/**
 * @typedef {Object} Known
 * @property {string} id
 * @property {string} storyId
 * @property {CollectionKeys} keys
 * @property {Bytes} wrapped - Its key as the server keeps it for this account
 * @property {number} seq
 * @property {number} epoch
 * @property {number|null} deleted
 * @property {boolean} [kept] - Deleted because another device keeps the project to itself
 * @property {string} role - `owner`, or `member` of a project shared with this account
 * @property {number|null} owner - The owner's account, where the server says
 * @property {number} members - How many are in it, the owner among them
 * @property {boolean} shared - Ever shared: its chats are each one's own
 */

/**
 * A project shared, as this device last heard of it.
 *
 * @typedef {Object} Shared
 * @property {string} role - This account's: `owner`, or `member`
 * @property {number|null} owner - The owner's account
 * @property {import('./api.js').Member[]} members - Who is in it, the owner first
 */

/**
 * Who this account is, and the projects shared with it or by it.
 *
 * @typedef {Object} Sharing
 * @property {number|null} me - This account, once the server has said
 * @property {Record<string, Shared>} projects - By story
 */

/**
 * @typedef {Object} Options
 * @property {Api} api
 * @property {AccountKeys} keys
 * @property {Local} local
 * @property {State} state
 * @property {number} schema - The schema this app writes
 * @property {number} [format] - The format this app writes, `FORMAT` but in tests
 * @property {(table: string, row: any, from: number) => any} upgrade - A row
 *   from an older schema, moved forward
 * @property {(status: Status) => void} [onStatus]
 * @property {(sharing: Sharing) => void} [onSharing] - Told of the projects shared
 *   when what is known of them changes
 * @property {import('./diagnostics.js').Diagnostics} [diagnostics] - What counts what it does
 * @property {() => number} [now] - The clock, for tests
 */

/**
 * A row to write into one of the engine's tables.
 * @param {string} table
 * @param {any} data
 */
const put = (table, data) =>
  /** @type {Change} */ ({ entityType: table, id: data.id, op: 'put', data, timestamp: Date.now() })

/** @param {string} table @param {string} id */
const removal = (table, id) =>
  /** @type {Change} */ ({ entityType: table, id, op: 'delete', data: null, timestamp: Date.now() })

/**
 * A row's project, where the row says.
 * @param {string} table
 * @param {any} row
 */
const storyOf = (table, row) =>
  !row
    ? null
    : SETUP_SYNCED.includes(table)
      ? SETUP
      : table === 'stories'
        ? row.id
        : (row.storyId ?? null)

/**
 * Whether a message is still being written by the model.
 * @param {any} message
 */
/**
 * A story as it goes to the server: without what is this device's alone,
 * whether it keeps the project off sync.
 * @param {any} story
 */
const asSentStory = ({ syncOff: _syncOff, keptElsewhere: _keptElsewhere, ...story }) => story

const streaming = message =>
  Boolean(message?.streamingStartTime) &&
  !message.streamingFinishTime &&
  Date.now() - (message.updated ?? 0) < STREAMING_MS

/**
 * The engine for one device signed in to one account.
 * @param {Options} options
 */
export function createEngine({
  api,
  keys,
  local,
  state,
  schema,
  format = FORMAT,
  upgrade,
  onStatus = () => {},
  onSharing = () => {},
  diagnostics = UNCOUNTED,
  now = Date.now,
}) {
  /**
   * What a record was written in.
   * @param {Payload} payload
   * @returns {WrittenBy}
   */
  const writtenBy = payload => ({ schema: payload.schema, format: payload.format ?? 0 })

  /**
   * Whether a record was written by a newer app than this one.
   * @param {WrittenBy|Payload} written
   */
  const ahead = written => written.schema > schema || (written.format ?? 0) > format

  /**
   * Rows the engine wrote here, by key, with their fingerprints, or `GONE`
   * for those it removed.
   * @type {Map<string, string>}
   */
  const expected = new Map()

  /** Outbox writes under way. @type {Set<Promise<void>>} */
  const noting = new Set()

  /** Collections' keys, by collection id. @type {Map<string, CollectionKeys>} */
  const keysById = new Map()

  /** This account's own keys in each collection, by its id. @type {Map<string, CollectionKeys>} */
  const ownById = new Map()

  /** The collections this account left, or was removed from, as last listed. @type {Set<string>} */
  let left = new Set()

  /** The projects shared now, as last listed, by story. @type {Set<string>} */
  let sharedHere = new Set()

  /** @type {Status} */
  let status = { phase: 'idle', waiting: 0, last: null, error: null }

  /** @param {Partial<Status>} change */
  function tell(change) {
    status = { ...status, ...change }
    onStatus(status)
  }

  // Noting writes.

  /**
   * Put a storage write in the outbox. Called for every write to a project,
   * as it is made; the outbox is written meanwhile.
   * @param {Written} written
   */
  function noteWrite(written) {
    const work = note(written).catch(error => console.error('Sync could not note a write:', error))
    noting.add(work)
    work.finally(() => noting.delete(work))
  }

  /** @param {Written} written */
  async function note(written) {
    /** @type {Waiting[]} */
    const waiting = []
    const at = Date.now()
    if (written.method === 'write' || written.method === 'updateEach') {
      if (!SYNCED.includes(written.table) && !SETUP_SYNCED.includes(written.table)) return
      const changes =
        written.method === 'write'
          ? written.changes
          : written.rows.map(row => put(written.table, row))
      for (const change of changes) {
        if (change.op === 'delete') {
          waiting.push({
            id: `${written.table}:${change.id}`,
            table: written.table,
            rowId: change.id,
            op: 'delete',
            storyId:
              written.table === 'stories'
                ? change.id
                : SETUP_SYNCED.includes(written.table)
                  ? SETUP
                  : null,
            at,
          })
          continue
        }
        waiting.push(waitingOf(written.table, change.data, at, change.id))
      }
    } else if (written.method === 'addProject') {
      waiting.push(...projectWaiting(written.project, at))
    } else if (written.method === 'removeProject') {
      waiting.push({
        id: `stories:${written.storyId}`,
        table: 'stories',
        rowId: written.storyId,
        op: 'delete',
        storyId: written.storyId,
        at,
      })
    } else if (written.method === 'putFileBytes') {
      waiting.push(waitingOf('files', { id: written.id, storyId: written.storyId }, at))
    }
    /** @type {Waiting[]} */
    const left = []
    for (const entry of waiting) {
      // What the engine wrote here itself, as the server has it.
      const hoped = expected.get(entry.id)
      // Bytes once sent never change: any put of them the engine made is its own.
      const came =
        entry.op === 'delete'
          ? hoped === GONE
          : BYTES.has(entry.table)
            ? hoped !== undefined && hoped !== GONE
            : Boolean(hoped && entry.data && hoped === (await fingerprint(comparable(entry.data))))
      if (came) {
        expected.delete(entry.id)
        continue
      }
      left.push(entry)
    }
    if (left.length === 0) return
    await state.write(
      'cloudOutbox',
      left.map(entry => put('cloudOutbox', entry))
    )
  }

  /**
   * A row written, as it waits in the outbox: a file's without its bytes,
   * which are read when it is sent, and the setup's as it is sent.
   *
   * @param {string} table
   * @param {any} row
   * @param {number} at
   * @param {string} [id] - Its id, where the row is known by something else
   * @param {string|null} [storyId] - Its project, where the row doesn't say
   * @returns {Waiting}
   */
  function waitingOf(table, row, at, id = idOf(table, row), storyId = storyOf(table, row)) {
    const rowId = /** @type {string} */ (id)
    return {
      id: `${table}:${rowId}`,
      table,
      rowId,
      op: 'put',
      data: table === 'files' ? undefined : SETUP_SYNCED.includes(table) ? asSent(table, row) : row,
      storyId,
      ...(table === 'messages' ? { chatId: row.chatId } : {}),
      at,
    }
  }

  /**
   * Every row of a project, to wait in the outbox.
   * @param {ProjectRows} project
   * @param {number} at
   * @returns {Waiting[]}
   */
  function projectWaiting(project, at) {
    const storyId = project.story.id
    /**
     * @param {string} table
     * @param {any} row
     */
    const entry = (table, row) => waitingOf(table, row, at, row.id, storyId)
    return [
      entry('stories', project.story),
      ...project.documents.map(row => entry('documents', row)),
      ...project.chats.map(row => entry('chats', row)),
      ...project.messages.map(row => entry('messages', row)),
      ...project.files.map(row => entry('files', row)),
      ...(project.versions ?? []).map(row => entry('versions', row)),
    ]
  }

  /**
   * Every row of the setup, to wait in the outbox for the device's first
   * sync of it.
   * @param {Record<string, any[]>} setup
   * @param {number} at
   * @returns {Waiting[]}
   */
  function setupWaiting(setup, at) {
    return SETUP_SYNCED.flatMap(table =>
      (setup[table] ?? [])
        .filter(row => idOf(table, row))
        .map(row => ({ ...waitingOf(table, row, at, idOf(table, row), SETUP), first: true }))
    )
  }

  /**
   * Put every row of these projects, or of the setup, in the outbox: a
   * device's first sync, or a collection to upload whole again.
   * @param {string[]} [storyIds] - Every project and the setup when absent
   * @param {{blobs?: Map<string, string>}} [options] - Blobs files were
   *   uploaded as already, by their key, so their parts aren't sent twice
   */
  async function enqueue(storyIds, { blobs } = {}) {
    const off = await local.keptOff()
    for (const storyId of storyIds ?? [...(await local.projects()), SETUP]) {
      if (off.has(storyId)) continue
      /** @type {Waiting[]} */
      let entries
      if (storyId === SETUP) entries = setupWaiting(await local.readSetup(), Date.now())
      else {
        const project = await local.readProject(storyId)
        if (!project) continue
        entries = projectWaiting(project, Date.now())
      }
      await state.write(
        'cloudOutbox',
        entries.map(entry => {
          const blob = blobs?.get(entry.id)
          return put('cloudOutbox', blob ? { ...entry, blob } : entry)
        })
      )
    }
  }

  /**
   * Whether the server's generation is new since the last round: put back
   * from a backup since. The first one heard of is only kept.
   * @param {string|null} generation
   */
  async function restoredSince(generation) {
    if (!generation) return false
    /** @type {{value: string}|undefined} */
    const had = await state.get('cloudState', 'generation')
    if (had?.value === generation) return false
    await state.write('cloudState', [put('cloudState', { id: 'generation', value: generation })])
    return Boolean(had)
  }

  /**
   * Sync as a first sync, since the server may have lost what it was sent:
   * forget its revisions and how far each collection was read, and put
   * every row here in the outbox. A file goes again as the blob it was, if
   * its bytes are here; one fetched only when wanted is left to a device
   * that has them.
   */
  async function sendAgain() {
    /** @type {Change[]} */
    const forgotten = []
    /** @type {Map<string, string>} */
    const blobs = new Map()
    for (const record of /** @type {Kept[]} */ (await state.all('cloudRecords'))) {
      const [table, ...rest] = record.id.split(':')
      if (BYTES.has(table) && record.file) {
        if (!(await local.fileBytes(table, rest.join(':')))) continue
        blobs.set(record.id, record.file.blob)
      }
      forgotten.push(removal('cloudRecords', record.id))
    }
    await state.write('cloudRecords', forgotten)
    const readings = (await state.all('cloudState')).filter(row => row.id.startsWith('collection:'))
    await state.write(
      'cloudState',
      readings.map(row => removal('cloudState', row.id))
    )
    await enqueue(undefined, { blobs })
    diagnostics.count('restoresMet')
    console.info('The sync server was put back from a backup. Everything here goes up again.')
  }

  /**
   * Take the projects this device has begun keeping off sync off the
   * server, and forget what sync kept of them. Once each: what another
   * device sends of one afterwards is left alone here.
   * @param {Map<string, Known>} known
   */
  async function takeOff(known) {
    const taking = (await state.all('cloudState')).filter(row => row.id.startsWith('keepOff:'))
    for (const row of taking) {
      const collection = known.get(row.project)
      if (collection && collection.deleted == null) {
        await api.deleteCollection(collection.id, { kept: true })
      }
      await forget(row.project)
      await state.write('cloudState', [removal('cloudState', row.id)])
    }
  }

  /**
   * Write a project's story here as given, as the engine's own write rather
   * than one to send.
   * @param {string} storyId
   * @param {any} story
   */
  async function writeStory(storyId, story) {
    expected.set(`stories:${storyId}`, await fingerprint(comparable(story)))
    await local.write(storyId, [{ table: 'stories', id: storyId, row: story }])
  }

  /**
   * A project another device took off the server to keep to itself: kept
   * here in the trash, out of sync, its edits waiting here with it.
   * @param {string} storyId
   */
  async function keptElsewhere(storyId) {
    const story = (await local.readProject(storyId))?.story
    if (story) {
      await writeStory(storyId, {
        ...intoTrash(storyId, 'stories', story),
        keptElsewhere: now(),
      })
    }
    await forget(storyId)
    keptOff.set(storyId, 'elsewhere')
  }

  /**
   * The projects another device kept to itself that are on the server again,
   * synced from there once more: taken back here, from the server as a
   * first sync would, the story as it was so that the server's is the newer.
   * @param {Map<string, Known>} known
   */
  async function takeBack(known) {
    for (const [storyId, why] of keptOff) {
      const collection = known.get(storyId)
      if (why !== 'elsewhere' || !collection || collection.deleted != null) continue
      const story = (await local.readProject(storyId))?.story
      if (story) {
        const { keptElsewhere: _keptElsewhere, ...back } = story
        await writeStory(storyId, back)
      }
      keptOff.delete(storyId)
    }
  }

  /**
   * The projects shared with this account that it has left, or been removed
   * from: moved to the trash here, out of sync, as one another device kept
   * to itself. Added again, they are taken back as those are.
   */
  async function leftBehind() {
    if (left.size === 0) return
    const readings = (await state.all('cloudState')).filter(
      row => row.id.startsWith('collection:') && left.has(row.collection)
    )
    for (const reading of readings) {
      if (!keptOff.has(reading.storyId)) await keptElsewhere(reading.storyId)
    }
  }

  // Sharing.

  /** Who is in each project shared, as last asked, by story. @type {Map<string, Shared & {count: number}>} */
  const people = new Map()

  /** The projects whose people were asked for since the engine began. @type {Set<string>} */
  const peopleAsked = new Set()

  /** This account, once the server has said. @type {number|null} */
  let me = null

  /** What the app was last told, to tell it only of a change. */
  let toldSharing = ''

  /**
   * Who is in each project shared, asked again where the number in it has
   * changed, or not yet since the engine began; kept for when the server
   * can't be reached. The app is told when it changes.
   * @param {Map<string, Known>} known
   */
  async function lookAtPeople(known) {
    for (const collection of known.values()) {
      const { storyId } = collection
      if (storyId === SETUP || collection.deleted != null) continue
      if (collection.role === 'owner' && collection.members <= 1) {
        if (people.delete(storyId)) {
          await state.write('cloudState', [removal('cloudState', `people:${storyId}`)])
        }
        continue
      }
      const had = people.get(storyId) ?? (await state.get('cloudState', `people:${storyId}`))
      if (had && had.count === collection.members && peopleAsked.has(storyId)) {
        people.set(storyId, had)
        continue
      }
      try {
        const kept = {
          id: `people:${storyId}`,
          storyId,
          count: collection.members,
          role: collection.role,
          owner: collection.owner,
          members: await api.members(collection.id),
        }
        await state.write('cloudState', [put('cloudState', kept)])
        people.set(storyId, kept)
        peopleAsked.add(storyId)
      } catch (error) {
        console.warn('Sync could not ask who is in a shared project:', error)
        if (had) people.set(storyId, had)
      }
    }
    for (const storyId of [...people.keys()]) {
      if (!known.has(storyId) || known.get(storyId)?.deleted != null) people.delete(storyId)
    }
    if (people.size > 0 && me === null) {
      try {
        me = (await api.account()).id ?? null
      } catch {
        // Asked again next round.
      }
    }
    tellSharing()
  }

  /** Tell the app of the projects shared, if that has changed. */
  function tellSharing() {
    /** @type {Sharing} */
    const sharing = {
      me,
      projects: Object.fromEntries(
        [...people].map(([storyId, { role, owner, members }]) => [
          storyId,
          { role, owner, members },
        ])
      ),
    }
    const said = JSON.stringify(sharing)
    if (said === toldSharing) return
    toldSharing = said
    onSharing(sharing)
  }

  /** Wait for the round under way, if one is. */
  async function idle() {
    while (running) await running.catch(() => {})
  }

  /**
   * A project's collection as the server lists it now.
   * @param {string} storyId
   * @returns {Promise<ListedCollection|null>}
   */
  async function listedFor(storyId) {
    /** @type {Reading|undefined} */
    const reading = await state.get('cloudState', `collection:${storyId}`)
    if (!reading) return null
    return (
      (await api.collections()).find(collection => collection.id === reading.collection) ?? null
    )
  }

  /**
   * Whether every chat and message of a project the server has is this
   * account's own, and none waits to go.
   * @param {string} storyId
   */
  async function allOwn(storyId) {
    for (const record of /** @type {Kept[]} */ (await state.ofStory('cloudRecords', storyId))) {
      if (OWN.has(record.id.split(':')[0]) && record.print !== null && !record.own) return false
    }
    for (const entry of /** @type {Waiting[]} */ (await state.all('cloudOutbox'))) {
      if (!OWN.has(entry.table)) continue
      const of = entry.storyId ?? (entry.chatId ? await local.storyOfChat(entry.chatId) : null)
      if (of === storyId) return false
    }
    return true
  }

  /**
   * Share a project with the account a friend code is of. The collection is
   * marked shared first, so that no device of this account sends a chat
   * the friend could read; then its chats and messages go again as this
   * account's own; then its key is wrapped for the friend's public key, once
   * that key is the one the code is of.
   *
   * @param {string} storyId
   * @param {string} code - As typed
   * @returns {Promise<import('./api.js').Member>} Who it was shared with
   * @throws {Error} Saying why it wasn't, in words for the writer
   */
  async function share(storyId, code) {
    const letters = readFriendCode(code)
    if (!letters) throw new Error("That isn't a friend code.")
    await idle()
    const listed = await listedFor(storyId)
    if (!listed || listed.deleted != null) {
      throw new Error("This project isn't on the sync server yet. Try again once it has synced.")
    }
    if (listed.role !== 'owner') throw new Error('Only its owner can share it.')
    const friend = await api.friend(letters)
    if ((await friendCode(friend.publicKey)) !== letters) {
      throw new Error("The sync server's key for that friend code is wrong, so it wasn't shared.")
    }
    if (!listed.shared) await api.share(listed.id)
    checked = false
    await round()
    if (!(await allOwn(storyId))) {
      throw new Error(
        "Its chats haven't all synced yet, so it wasn't shared. Try again in a moment."
      )
    }
    const about = `collection ${listed.id}`
    const secret = await open(keys.wrap, listed.key, about)
    const added = await api.addMember(
      listed.id,
      letters,
      await sealFor(friend.publicKey, secret, about)
    )
    peopleAsked.delete(storyId)
    await round()
    return { account: added.account, owner: false, display: added.display }
  }

  /**
   * Take someone out of a project shared by this account.
   * @param {string} storyId
   * @param {number} account
   */
  async function removeMember(storyId, account) {
    await idle()
    const listed = await listedFor(storyId)
    if (!listed) throw new Error("This project isn't on the sync server.")
    await api.removeMember(listed.id, account)
    peopleAsked.delete(storyId)
    await round()
  }

  /**
   * Leave a project shared with this account: the server stops sending it,
   * and it goes to the trash here, out of sync.
   * @param {string} storyId
   */
  async function leave(storyId) {
    await idle()
    const listed = await listedFor(storyId)
    if (listed && !listed.left) await leaveCollection(listed.id)
    await keptElsewhere(storyId)
    people.delete(storyId)
    tellSharing()
  }

  /**
   * Take this account out of a collection shared with it.
   * @param {string} id
   */
  async function leaveCollection(id) {
    me ??= (await api.account()).id ?? null
    if (me === null) throw new Error("This sync server can't share projects.")
    await api.removeMember(id, me)
  }

  /**
   * This account as the people it shares with know it: its id, the name
   * they see, and its friend code, its key pair made if it has none.
   * @returns {Promise<{id: number|null, display: string|null, friend: string}>}
   */
  async function profile() {
    const account = await api.account()
    me = account.id ?? null
    const { publicKey } = await keyPair()
    return { id: me, display: account.display ?? null, friend: await friendCode(publicKey) }
  }

  /** Have every write noted so far in the outbox. */
  async function noted() {
    while (noting.size > 0) await Promise.all([...noting])
  }

  // Rounds.

  /** @type {Promise<void>|null} */
  let running = null
  let again = false

  /**
   * Sync once, or once more after the round under way.
   * @returns {Promise<void>}
   */
  async function round() {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        let rounds = 0
        do {
          again = false
          await once()
        } while (again && ++rounds < MOST_ROUNDS)
      } finally {
        running = null
      }
    })()
    return running
  }

  /** Whether a round met the account's quota. */
  let full = false

  /** The projects kept off sync, as the round under way found them. @type {Map<string, 'here'|'elsewhere'>} */
  let keptOff = new Map()

  /**
   * Count a page of changes that came.
   * @param {{records: Array<{body: Bytes|null}>}} page
   */
  function counted(page) {
    diagnostics.count('pulled', page.records.length)
    diagnostics.count(
      'bytesDown',
      page.records.reduce((sum, record) => sum + (record.body?.length ?? 0), 0)
    )
  }

  async function once() {
    tell({ phase: 'syncing', error: null })
    const started = now()
    full = false
    try {
      await local.settle()
      await noted()
      expected.clear()
      keptOff = await local.keptOff()
      const listing = await api.listing()
      if (await restoredSince(listing.generation)) await sendAgain()
      const known = await learn(listing.collections)
      await takeOff(known)
      await takeBack(known)
      await leftBehind()
      await lookAtPeople(known)
      // A device signed in before the setup was synced sends it once, whole.
      if (local.syncsHere(SETUP) && !(await state.get('cloudState', `collection:${SETUP}`))) {
        await enqueue([SETUP])
      }
      const waiting = await groupWaiting()
      const here = new Set([...(await local.projects()), SETUP])
      /** @type {Set<string>} */
      const grown = new Set()
      for (const collection of known.values()) {
        if (!local.syncsHere(collection.storyId) || keptOff.has(collection.storyId)) continue
        if (await pull(collection, waiting, here)) grown.add(collection.storyId)
      }
      await push(known, waiting)
      await fetchFiles()
      await repairTrees(grown)
      if (!checked) {
        checked = true
        if ((await check()) > 0) again = true
      }
      /** @type {Waiting[]} */
      const left = await state.all('cloudOutbox')
      const held = (await state.all('cloudState')).some(row => row.held && ahead(row.held))
      diagnostics.count('rounds')
      diagnostics.took(now() - started)
      diagnostics.outbox(left.length, Math.max(0, ...left.map(entry => now() - entry.at)))
      tell({
        phase: held ? 'held' : 'idle',
        waiting: left.length,
        last: Date.now(),
        error: null,
        full,
      })
    } catch (error) {
      const failure = /** @type {Error} */ (error)
      const offline = failure instanceof CloudError && failure.status === 0
      // The server takes nothing from this build until it is updated.
      const held = failure instanceof CloudError && failure.status === 426
      diagnostics.count('roundsFailed')
      diagnostics.error(errorTag(failure))
      tell({
        phase: offline ? 'offline' : held ? 'held' : 'error',
        waiting: (await state.all('cloudOutbox')).length,
        error: held ? null : failure.message,
        full: full || (failure instanceof CloudError && failure.status === 507),
      })
      throw error
    }
  }

  /**
   * The collections the server lists, opened: whose each is, and its keys.
   * @param {ListedCollection[]} listed
   * @returns {Promise<Map<string, Known>>} By story
   */
  async function learn(listed) {
    const setupId = await setupCollection()
    /** @type {Map<string, Known>} */
    const known = new Map()
    left = new Set()
    sharedHere = new Set()
    for (const collection of listed) {
      if (collection.left) {
        left.add(collection.id)
        continue
      }
      try {
        if (collection.sealed) await takeShared(collection)
        const opened = await keysOf(collection)
        const storyId =
          collection.id === setupId
            ? SETUP
            : collection.meta
              ? (await openJson(opened.seal, collection.meta, `meta ${collection.id}`)).storyId
              : null
        if (!storyId) continue
        known.set(storyId, {
          id: collection.id,
          storyId,
          keys: opened,
          wrapped: collection.key,
          seq: collection.seq,
          epoch: collection.epoch,
          deleted: collection.deleted,
          kept: Boolean(collection.kept),
          role: collection.role,
          owner: collection.owner ?? null,
          members: collection.members ?? 1,
          shared: Boolean(collection.shared),
        })
        if (collection.shared) sharedHere.add(storyId)
      } catch (error) {
        diagnostics.error('open collection')
        console.error(`Sync could not open the collection ${collection.id}:`, error)
      }
    }
    return known
  }

  /** @type {string|null} */
  let setupId = null

  /** The id of the account's own collection, the same on every device. */
  async function setupCollection() {
    setupId ??= await hashName(keys.ids, 'setup')
    return setupId
  }

  /**
   * A collection shared with this account, its key still wrapped for the
   * account's public key: opened with the private key, and wrapped again
   * under the account key, as this account's own collections are, for its
   * other devices to take as they take those.
   * @param {ListedCollection} collection
   */
  async function takeShared(collection) {
    const { privateKey } = await keyPair()
    const about = `collection ${collection.id}`
    const secret = await openFor(privateKey, collection.key, about)
    const wrapped = await seal(keys.wrap, secret, about)
    await api.rewrap(collection.id, wrapped)
    collection.key = wrapped
    collection.sealed = false
  }

  /** @type {Promise<{publicKey: Bytes, privateKey: CryptoKey}>|null} */
  let pair = null

  /**
   * The account's key pair, made the first time any of its devices needs
   * one: a second device making one at once takes the first's.
   * @returns {Promise<{publicKey: Bytes, privateKey: CryptoKey}>}
   */
  function keyPair() {
    pair ??= (async () => {
      let { publicKey, privateKey } = await api.account()
      if (!publicKey || !privateKey) {
        const made = await makeKeyPair(keys.wrap)
        ;({ publicKey, privateKey } = await api.setKeys(made.publicKey, made.privateKey))
      }
      return { publicKey, privateKey: await openPrivateKey(keys.wrap, privateKey) }
    })()
    pair.catch(() => {
      pair = null
    })
    return pair
  }

  /**
   * The keys this account's own records in a collection are sealed with.
   * @param {Known} collection
   */
  async function ownOf(collection) {
    const had = ownById.get(collection.id)
    if (had) return had
    const made = await ownKeys(keys.ids, collection.id)
    ownById.set(collection.id, made)
    return made
  }

  /** @param {ListedCollection} collection */
  async function keysOf(collection) {
    const had = keysById.get(collection.id)
    if (had) return had
    const secret = await open(keys.wrap, collection.key, `collection ${collection.id}`)
    const opened = await collectionKeys(secret)
    keysById.set(collection.id, opened)
    return opened
  }

  /**
   * The outbox, by project. A row with no project of its own (a removal, a
   * message) is put with the project its record or its chat says.
   *
   * @returns {Promise<Map<string, Map<string, Waiting>>>}
   */
  async function groupWaiting() {
    /** @type {Map<string, Map<string, Waiting>>} */
    const grouped = new Map()
    const entries = /** @type {Waiting[]} */ (await state.all('cloudOutbox'))
    const records = new Map(
      /** @type {Kept[]} */ (await state.all('cloudRecords')).map(record => [record.id, record])
    )
    /** @type {Map<string, string|null>} */
    const chats = new Map()
    /** @type {string[]} */
    const lost = []
    for (const entry of entries) {
      let storyId = entry.storyId ?? records.get(entry.id)?.storyId ?? null
      if (!storyId && entry.chatId) {
        if (!chats.has(entry.chatId)) chats.set(entry.chatId, await local.storyOfChat(entry.chatId))
        storyId = chats.get(entry.chatId) ?? null
      }
      if (!storyId || keptOff.has(storyId)) {
        lost.push(entry.id)
        continue
      }
      let group = grouped.get(storyId)
      if (!group) grouped.set(storyId, (group = new Map()))
      group.set(entry.id, { ...entry, storyId })
    }
    // A removal of a row never sent, a message whose chat is gone, or a row
    // of a project kept off sync.
    if (lost.length > 0) {
      await state.write(
        'cloudOutbox',
        lost.map(id => removal('cloudOutbox', id))
      )
    }
    return grouped
  }

  // Pulling.

  /**
   * Bring a project's collection in from where this device last read it.
   *
   * @param {Known} collection
   * @param {Map<string, Map<string, Waiting>>} waiting
   * @param {Set<string>} here - The projects this device has
   * @returns {Promise<boolean>} Whether documents came, which may have broken its tree
   */
  async function pull(collection, waiting, here) {
    const { storyId } = collection
    const ownWaiting = waiting.get(storyId) ?? new Map()
    if (ownWaiting.get(`stories:${storyId}`)?.op === 'delete') return false
    const reading = /** @type {Reading|undefined} */ (
      await state.get('cloudState', `collection:${storyId}`)
    )
    if (collection.deleted != null) {
      await gone(collection, reading, ownWaiting)
      return false
    }
    if (reading?.held && ahead(reading.held)) return false
    const whole = !reading || reading.epoch !== collection.epoch || Boolean(reading.partial)
    let cursor = whole ? 0 : reading.cursor
    if (!whole && collection.seq <= cursor) return false
    if (whole && !here.has(storyId)) {
      await arrive(collection)
      return true
    }

    /** @type {Set<string>} */
    const received = new Set()
    let documents = false
    /** @type {WrittenBy|null} */
    let held = null
    for (;;) {
      const page = await api.changes(collection.id, cursor)
      counted(page)
      /** @type {Incoming[]} */
      const incoming = []
      /** @type {Clash[]} */
      const clashes = []
      /** @type {Change[]} */
      const kept = []
      /** @type {Change[]} */
      const outbox = []
      for (const record of page.records) {
        const payload = await openRecord(collection, record.name, record.body, record.own)
        if (!payload) {
          cursor = record.rev
          continue
        }
        if (ahead(payload)) {
          held = writtenBy(payload)
          diagnostics.count('blocked')
          break
        }
        const key = `${payload.table}:${payload.id}`
        received.add(key)
        const record_ = /** @type {Kept|undefined} */ (await state.get('cloudRecords', key))
        const taken = await take(collection, payload, record.name, record.rev, {
          record: record_,
          waiting: ownWaiting.get(key),
          own: record.own,
        })
        incoming.push(...taken.incoming)
        clashes.push(...taken.clashes)
        kept.push(taken.kept)
        if (taken.outbox) {
          outbox.push(taken.outbox)
          if (taken.outbox.op === 'delete') ownWaiting.delete(key)
          else ownWaiting.set(key, taken.outbox.data)
        }
        cursor = record.rev
      }
      if (incoming.length > 0) await local.write(storyId, incoming)
      if (incoming.some(item => item.table === 'documents')) documents = true
      for (const clash of clashes) {
        diagnostics.count(clash.large ? 'clashesLarge' : 'clashesSmall')
        await local.keepClash(storyId, clash)
      }
      if (kept.length > 0) await state.write('cloudRecords', kept)
      if (outbox.length > 0) await state.write('cloudOutbox', outbox)
      await state.write('cloudState', [
        put('cloudState', {
          id: `collection:${storyId}`,
          storyId,
          collection: collection.id,
          cursor,
          epoch: collection.epoch,
          ...(held ? { held } : {}),
          ...(held && whole ? { partial: true } : {}),
        }),
      ])
      if (held || !page.more) break
    }
    // Held partway, it hasn't received all it will.
    if (whole && !held) await dropUnreceived(storyId, received, ownWaiting)
    return documents || whole
  }

  // Checking.

  /** Whether this launch has compared its rows with the server's yet. */
  let checked = false

  /**
   * Put in the outbox every row here that differs from the server's as it
   * last had it, and every one it never had, but those already waiting:
   * writes whose note was lost. A collection never synced goes whole.
   *
   * Bytes waiting for a document that has none to send leave the outbox:
   * they would wait for ever. A repository's source file was put there as a
   * file once.
   *
   * @returns {Promise<number>} How many were found
   */
  async function check() {
    const waiting = new Set(
      /** @type {Waiting[]} */ (await state.all('cloudOutbox')).map(entry => entry.id)
    )
    const at = Date.now()
    let found = 0
    for (const storyId of [...(await local.projects()), SETUP]) {
      if (!local.syncsHere(storyId) || keptOff.has(storyId)) continue
      /** @type {Waiting[]} */
      let entries
      if (storyId === SETUP) entries = setupWaiting(await local.readSetup(), at)
      else {
        const project = await local.readProject(storyId)
        if (!project) continue
        entries = projectWaiting(project, at)
        const files = new Set(project.files.map(file => file.id))
        const byteless = project.documents
          .filter(document => !files.has(document.id) && waiting.has(`files:${document.id}`))
          .map(document => removal('cloudOutbox', `files:${document.id}`))
        if (byteless.length > 0) await state.write('cloudOutbox', byteless)
      }
      const records = new Map(
        /** @type {Kept[]} */ (await state.ofStory('cloudRecords', storyId)).map(record => [
          record.id,
          record,
        ])
      )
      /** @type {Waiting[]} */
      const behind = []
      for (const { first: _first, ...entry } of entries) {
        if (waiting.has(entry.id)) continue
        const record = records.get(entry.id)
        // Bytes once sent never change.
        if (BYTES.has(entry.table)) {
          if (!record) behind.push(entry)
          continue
        }
        if (entry.table === 'messages' && streaming(entry.data)) continue
        if (!record && asMade(entry.table, entry.data)) continue
        const row = entry.table === 'stories' ? asSentStory(entry.data) : entry.data
        // A chat sent before its project was shared goes again, as its writer's own.
        const unowned = OWN.has(entry.table) && sharedHere.has(storyId) && !record?.own
        if (record?.print === (await fingerprint(comparable(row))) && !unowned) continue
        behind.push(entry)
      }
      if (behind.length === 0) continue
      found += behind.length
      await state.write(
        'cloudOutbox',
        behind.map(entry => put('cloudOutbox', entry))
      )
    }
    if (found > 0) console.info(`Sync found ${found} rows here that the server didn't have.`)
    diagnostics.count('checkResent', found)
    return found
  }

  // The tree.

  /** The projects whose tree was broken when last looked at, with since when. @type {Map<string, number>} */
  const broken = new Map()

  /**
   * Look at the trees of these projects, and of those broken when last
   * looked at, and put right what has been wrong for a while.
   *
   * @param {Set<string>} grown - The projects documents came to this round
   */
  async function repairTrees(grown) {
    for (const storyId of new Set([...grown, ...broken.keys()])) {
      if (storyId === SETUP || !local.syncsHere(storyId)) continue
      const fixes = treeFixes(await local.tree(storyId), storyId, now())
      if (fixes.length === 0) {
        broken.delete(storyId)
        continue
      }
      const since = broken.get(storyId)
      if (since === undefined) broken.set(storyId, now())
      else if (now() - since >= SETTLE_MS) {
        broken.delete(storyId)
        diagnostics.count('treeRepairs', fixes.length)
        await local.write(
          storyId,
          fixes.map(row => ({ table: 'documents', id: row.id, row }))
        )
      }
    }
  }

  /**
   * A record the server sent, as this device is to take it: what to write
   * here, what to keep of it, and what is to wait to go back.
   *
   * @param {Known} collection
   * @param {Payload} payload
   * @param {string} name
   * @param {number} rev
   * @param {{record?: Kept, waiting?: Waiting, own?: boolean}} here - `own`, where
   *   the record is this account's own
   * @returns {Promise<{incoming: Incoming[], clashes: Clash[], kept: Change, outbox?: Change}>}
   */
  async function take(collection, payload, name, rev, { record, waiting, own }) {
    const { table, id } = payload
    const key = `${table}:${id}`
    const theirs = payload.deleted ? null : payload.row
    /** @type {Kept} */
    const kept = {
      id: key,
      storyId: collection.storyId,
      name,
      rev,
      print: theirs ? await fingerprint(comparable(theirs)) : null,
      ...(MERGED.has(table) && theirs ? { row: theirs } : {}),
      ...(payload.file ? { file: payload.file } : {}),
      ...(own ? { own: true } : {}),
    }
    /** @type {Incoming[]} */
    const incoming = []
    /** @type {Clash[]} */
    const clashes = []
    /** @type {Change|undefined} */
    let outbox

    if (BYTES.has(table)) {
      // A file's bytes never change: the server's stand.
      if (waiting) outbox = removal('cloudOutbox', key)
      expected.set(key, kept.print ?? GONE)
      if (!theirs) {
        incoming.push({ table, id, row: null })
        await state.write('cloudState', [removal('cloudState', `file:${id}`)])
      } else if (!(await local.fileBytes(table, id))) {
        if (payload.file) {
          await state.write('cloudState', [
            put('cloudState', {
              id: `file:${id}`,
              storyId: collection.storyId,
              collection: collection.id,
              table,
              fileId: id,
              file: payload.file,
              ...(table === 'files' ? {} : { row: theirs }),
            }),
          ])
        } else if (table !== 'files') incoming.push({ table, id, row: theirs })
      }
      return { incoming, clashes, kept: put('cloudRecords', kept), outbox }
    }

    // On a device's first sync of the setup, a row the account has already (a
    // built-in every install makes, a group of settings) is the account's.
    if (waiting?.first && !record && theirs) {
      outbox = removal('cloudOutbox', key)
      waiting = undefined
    }

    if (!waiting) {
      expected.set(key, kept.print ?? GONE)
      incoming.push({ table, id, row: theirs })
    } else if (waiting.op === 'delete') {
      // An edit wins over a removal: the row comes back, into the trash, and
      // goes back to the server as that.
      outbox = removal('cloudOutbox', key)
      if (theirs) {
        const back = intoTrash(collection.storyId, table, theirs)
        incoming.push({ table, id, row: back })
        if (back === theirs) expected.set(key, /** @type {string} */ (kept.print))
        else {
          expected.set(key, await fingerprint(comparable(back)))
          outbox = put('cloudOutbox', { ...waiting, op: 'put', data: back, at: Date.now() })
        }
      }
    } else if (!theirs) {
      // A row edited here and removed there waits to go back, in the trash.
      const back = intoTrash(collection.storyId, table, waiting.data)
      if (back !== waiting.data) {
        incoming.push({ table, id, row: back })
        expected.set(key, await fingerprint(comparable(back)))
        outbox = put('cloudOutbox', { ...waiting, data: back, at: Date.now() })
      }
    } else {
      const merged = mergeRow(table, record?.row ?? null, waiting.data, theirs)
      const print = await fingerprint(comparable(merged.row))
      const replaced = table === 'documents' && merged.row.content !== waiting.data.content
      incoming.push({ table, id, row: merged.row, ...(replaced ? { replaced: waiting.data } : {}) })
      if (print === kept.print) {
        expected.set(key, print)
        outbox = removal('cloudOutbox', key)
      } else {
        outbox = put('cloudOutbox', { ...waiting, data: merged.row, at: Date.now() })
      }
      if (merged.lost) clashes.push({ of: merged.row, ...merged.lost })
    }
    return { incoming, clashes, kept: put('cloudRecords', kept), outbox }
  }

  /**
   * Open a record's body: null for one this device can't read, which is
   * passed over rather than stop every other.
   *
   * @param {Known} collection
   * @param {string} name
   * @param {Bytes|null} body
   * @param {boolean} [own] - This account's own, sealed under its own key
   * @returns {Promise<Payload|null>}
   */
  async function openRecord(collection, name, body, own = false) {
    if (!body) return null
    try {
      const sealing = own ? await ownOf(collection) : collection.keys
      /** @type {Payload} */
      const payload = await openJson(sealing.seal, body, `${collection.id}/${name}`)
      if (payload.row && payload.schema < schema) {
        return { ...payload, row: upgrade(payload.table, payload.row, payload.schema), schema }
      }
      return payload
    } catch (error) {
      diagnostics.error(`open record: ${errorTag(error)}`)
      console.error(`Sync could not open a record of ${collection.storyId}:`, error)
      return null
    }
  }

  /**
   * A project another device made, brought in whole.
   * @param {Known} collection
   */
  async function arrive(collection) {
    const { storyId } = collection
    /** @type {ProjectRows} */
    const project = { story: null, documents: [], chats: [], messages: [], files: [], versions: [] }
    /** @type {Change[]} */
    const kept = []
    let cursor = 0
    /** @type {WrittenBy|null} */
    let held = null
    for (;;) {
      const page = await api.changes(collection.id, cursor)
      counted(page)
      for (const record of page.records) {
        const payload = await openRecord(collection, record.name, record.body, record.own)
        if (payload && ahead(payload)) {
          held = writtenBy(payload)
          break
        }
        cursor = record.rev
        if (!payload) continue
        const taken = await take(collection, payload, record.name, record.rev, {
          own: record.own,
        })
        kept.push(taken.kept)
        if (payload.deleted) continue
        if (payload.table === 'stories') project.story = payload.row
        else if (payload.table === 'files') project.files.push(payload.row)
        else /** @type {any} */ (project)[payload.table].push(payload.row)
      }
      if (held || !page.more) break
    }
    // Half a project is no project: all of it waits.
    if (held) {
      await state.write('cloudState', [
        put('cloudState', {
          id: `collection:${storyId}`,
          storyId,
          collection: collection.id,
          cursor: 0,
          epoch: collection.epoch,
          held,
          partial: true,
        }),
      ])
      return
    }
    if (!project.story) return
    const prints = new Map(kept.map(change => [change.id, change.data.print]))
    for (const table of ['stories', 'documents', 'chats', 'messages', 'versions']) {
      const rows = table === 'stories' ? [project.story] : /** @type {any} */ (project)[table]
      for (const row of rows) expected.set(`${table}:${row.id}`, prints.get(`${table}:${row.id}`))
    }
    await local.addProject({ ...project, files: [] })
    await state.write('cloudRecords', kept)
    await state.write('cloudState', [
      put('cloudState', {
        id: `collection:${storyId}`,
        storyId,
        collection: collection.id,
        cursor,
        epoch: collection.epoch,
      }),
    ])
  }

  /**
   * A collection deleted on another device. With nothing waiting here, the
   * project goes here too. With edits waiting, they are kept: the project
   * goes to the trash here, and up again whole in the push, in the trash.
   *
   * @param {Known} collection
   * @param {Reading|undefined} reading
   * @param {Map<string, Waiting>} waiting
   */
  async function gone(collection, reading, waiting) {
    if (!reading) return
    const { storyId } = collection
    // A friend's edits to a project its owner deleted stay with the friend.
    if (collection.kept || (collection.role !== 'owner' && waiting.size > 0)) {
      await keptElsewhere(storyId)
      return
    }
    if (waiting.size === 0) {
      await local.removeProject(storyId)
      await forget(storyId)
      return
    }
    const story = (await local.readProject(storyId))?.story
    if (story && !story.trashed) {
      await local.write(storyId, [
        { table: 'stories', id: storyId, row: intoTrash(storyId, 'stories', story) },
      ])
    }
  }

  /**
   * After reading a collection whole, the rows it no longer has: removed
   * here, but those waiting to go up.
   *
   * @param {string} storyId
   * @param {Set<string>} received
   * @param {Map<string, Waiting>} waiting
   */
  async function dropUnreceived(storyId, received, waiting) {
    const records = /** @type {Kept[]} */ (await state.ofStory('cloudRecords', storyId))
    const stale = records.filter(record => !received.has(record.id) && !waiting.has(record.id))
    if (stale.length === 0) return
    await local.write(
      storyId,
      stale.map(record => {
        const [table, ...rest] = record.id.split(':')
        return { table, id: rest.join(':'), row: null }
      })
    )
    await state.write(
      'cloudRecords',
      stale.map(record => removal('cloudRecords', record.id))
    )
  }

  /**
   * Forget everything sync kept of a project.
   * @param {string} storyId
   */
  async function forget(storyId) {
    for (const table of ['cloudRecords', 'cloudOutbox', 'cloudState']) {
      const rows = await state.ofStory(table, storyId)
      if (rows.length > 0) {
        await state.write(
          table,
          rows.map(row => removal(table, row.id))
        )
      }
    }
  }

  // Pushing.

  /**
   * Send what waits, project by project.
   *
   * @param {Map<string, Known>} known
   * @param {Map<string, Map<string, Waiting>>} waiting
   */
  async function push(known, waiting) {
    for (const [storyId, group] of waiting) {
      // Kept off by a pull of this round, another device keeping it.
      if (!local.syncsHere(storyId) || keptOff.has(storyId)) continue
      const reading = /** @type {Reading|undefined} */ (
        await state.get('cloudState', `collection:${storyId}`)
      )
      if (group.get(`stories:${storyId}`)?.op === 'delete') {
        const collection = known.get(storyId)
        // Deleted by a friend it was shared with, it is left: only its owner deletes it.
        if (collection && collection.deleted == null) {
          if (collection.role === 'owner') await api.deleteCollection(collection.id)
          else await leaveCollection(collection.id)
        }
        await forget(storyId)
        continue
      }
      let collection = known.get(storyId)
      // Only its owner makes a shared project's collection again.
      if (collection && collection.role !== 'owner' && collection.deleted != null) continue
      if (!collection || collection.deleted != null) {
        collection = await make(storyId, collection)
        known.set(storyId, collection)
        if (collection.epoch !== reading?.epoch && reading) {
          // Made again after it was deleted: the server has nothing, so all of it goes.
          await enqueue([storyId])
          again = true
          continue
        }
      }
      await pushGroup(collection, group)
    }
  }

  /**
   * Make a project's collection, or take up the one another device made
   * meanwhile, or make again one deleted.
   *
   * @param {string} storyId
   * @param {Known} [was]
   * @returns {Promise<Known>}
   */
  async function make(storyId, was) {
    const id =
      was?.id ??
      (storyId === SETUP ? await setupCollection() : await hashName(keys.ids, `project:${storyId}`))
    const secret = randomBytes(32)
    const fresh = was?.keys ?? (await collectionKeys(secret))
    // Made again, it keeps the key it had, which the server still holds.
    const wrapped = was?.wrapped ?? (await seal(keys.wrap, secret, `collection ${id}`))
    // The setup's has none: it is known by its id.
    const meta = storyId === SETUP ? null : await sealJson(fresh.seal, { storyId }, `meta ${id}`)
    const { made, collection } = await api.putCollection(id, wrapped, meta)
    const opened = made && !was ? fresh : await keysOf(collection)
    keysById.set(id, opened)
    if (made) {
      await state.ofStory('cloudRecords', storyId).then(rows =>
        rows.length === 0
          ? null
          : state.write(
              'cloudRecords',
              rows.map(row => removal('cloudRecords', row.id))
            )
      )
      await state.write('cloudState', [
        put('cloudState', {
          id: `collection:${storyId}`,
          storyId,
          collection: id,
          cursor: collection.seq,
          epoch: collection.epoch,
        }),
      ])
    }
    return {
      id,
      storyId,
      keys: opened,
      wrapped: collection.key,
      seq: collection.seq,
      epoch: collection.epoch,
      deleted: collection.deleted,
      role: 'owner',
      owner: collection.owner ?? null,
      members: collection.members ?? 1,
      shared: Boolean(collection.shared),
    }
  }

  /**
   * Send one project's waiting rows.
   *
   * @param {Known} collection
   * @param {Map<string, Waiting>} group
   */
  async function pushGroup(collection, group) {
    const { storyId } = collection
    /** @type {Sending[]} */
    let batch = []
    let size = 0
    /** @type {Change[]} */
    const dropped = []
    for (const entry of group.values()) {
      const record = /** @type {Kept|undefined} */ (await state.get('cloudRecords', entry.id))
      // Behind a newer app's copy, it waits for this one to be updated.
      const behind = record?.ahead ?? entry.ahead
      if (behind && ahead(behind)) continue
      // A chat in a shared project is its writer's own; one sent before it
      // was shared goes again so, even unchanged.
      const own = OWN.has(entry.table) && (collection.shared || Boolean(record?.own))
      /** @type {Payload} */
      let payload
      /** @type {string|null} */
      let print = null
      if (entry.op === 'delete') {
        if (!record || record.print === null) {
          dropped.push(removal('cloudOutbox', entry.id))
          continue
        }
        payload = { table: entry.table, id: entry.rowId, schema, format, deleted: true }
      } else if (BYTES.has(entry.table)) {
        // Once a part was refused for room, the other files wait too.
        if (full) continue
        if (record?.print) {
          dropped.push(removal('cloudOutbox', entry.id))
          continue
        }
        const bytes = await local.fileBytes(entry.table, entry.rowId)
        // A file waits for its bytes; a card without a picture has none to wait for.
        if (!bytes && entry.table === 'files') continue
        /** @type {FileInfo|null} */
        let file = null
        try {
          file = bytes ? await upload(collection, entry, bytes) : null
        } catch (error) {
          // No room for it: it waits, and the rest goes.
          if (!(error instanceof CloudError && error.status === 507)) throw error
          full = true
          continue
        }
        const row = entry.table === 'files' ? { id: entry.rowId, storyId } : entry.data
        payload = {
          table: entry.table,
          id: entry.rowId,
          schema,
          format,
          row,
          ...(file ? { file } : {}),
        }
        print = await fingerprint(comparable(row))
      } else {
        if (entry.table === 'messages' && streaming(entry.data)) continue
        if (!record && asMade(entry.table, entry.data)) {
          dropped.push(removal('cloudOutbox', entry.id))
          continue
        }
        const row = entry.table === 'stories' ? asSentStory(entry.data) : entry.data
        print = await fingerprint(comparable(row))
        if (record?.print === print && (!own || record.own)) {
          dropped.push(removal('cloudOutbox', entry.id))
          continue
        }
        payload = { table: entry.table, id: entry.rowId, schema, format, row }
      }
      const name = record?.name ?? (await hashName(collection.keys.names, entry.id))
      const sealing = own ? await ownOf(collection) : collection.keys
      const body = await sealJson(sealing.seal, payload, `${collection.id}/${name}`)
      batch.push({
        name,
        base: record?.rev ?? 0,
        body,
        blob: payload.file?.blob ?? null,
        own,
        entry,
        payload,
        print,
      })
      size += body.length
      if (size >= PUSH_BYTES) {
        await send(collection, batch)
        batch = []
        size = 0
      }
    }
    if (batch.length > 0) await send(collection, batch)
    if (dropped.length > 0) await state.write('cloudOutbox', dropped)
  }

  /**
   * A record on its way, with what it was made from.
   *
   * @typedef {{name: string, base: number, body: Bytes, blob: string|null, own: boolean, entry: Waiting, payload: Payload, print: string|null}} Sending
   */

  /**
   * One push, and what came of each record.
   *
   * @param {Known} collection
   * @param {Sending[]} batch
   */
  async function send(collection, batch) {
    const { storyId } = collection
    /** @type {Awaited<ReturnType<Api['push']>>} */
    let pushed
    try {
      pushed = await api.push(
        collection.id,
        schema,
        batch.map(({ name, base, body, blob, own }) => ({
          name,
          base,
          body,
          blob,
          ...(own ? { own: true } : {}),
        })),
        { shared: collection.shared }
      )
    } catch (error) {
      // Shared since the round began: what waits goes again, chats as their writer's own.
      if (!(error instanceof CloudError && error.status === 409 && error.extra.shared)) throw error
      collection.shared = true
      sharedHere.add(storyId)
      again = true
      return
    }
    diagnostics.count(
      'bytesUp',
      batch.reduce((sum, item) => sum + item.body.length, 0)
    )
    const byName = new Map(batch.map(item => [item.name, item]))
    /** @type {Change[]} */
    const kept = []
    /** @type {Change[]} */
    const outbox = []
    /** @type {Incoming[]} */
    const incoming = []
    /** @type {Clash[]} */
    const clashes = []
    for (const result of pushed.results) {
      const item = /** @type {(typeof batch)[number]} */ (byName.get(result.name))
      const { entry, payload } = item
      if ('refused' in result) {
        if (result.refused === 'own') {
          // Another account's own, by a name no other row here should have.
          console.error(`Sync could not send ${entry.id}: it is someone else's.`)
          outbox.push(removal('cloudOutbox', entry.id))
          continue
        }
        // No room for it: it waits in the outbox until there is.
        full = true
        diagnostics.count('refusedQuota')
        continue
      }
      if ('rev' in result) {
        diagnostics.count('pushed')
        kept.push(
          put('cloudRecords', {
            id: entry.id,
            storyId,
            name: result.name,
            rev: result.rev,
            print: item.print,
            ...(MERGED.has(entry.table) && payload.row ? { row: payload.row } : {}),
            ...(payload.file ? { file: payload.file } : {}),
            ...(item.own ? { own: true } : {}),
          })
        )
        const now = /** @type {Waiting|undefined} */ (await state.get('cloudOutbox', entry.id))
        if (now && now.at === entry.at) outbox.push(removal('cloudOutbox', entry.id))
        continue
      }
      // Moved on since this device last had it: merged, and sent next round.
      again = true
      diagnostics.count('conflicts')
      const theirs = await openRecord(
        collection,
        result.name,
        result.conflict.body,
        result.conflict.own
      )
      if (!theirs) {
        // The server has none any more: send it as new.
        await state.write('cloudRecords', [removal('cloudRecords', entry.id)])
        continue
      }
      const record = /** @type {Kept|undefined} */ (await state.get('cloudRecords', entry.id))
      if (ahead(theirs)) {
        // A newer app's: not merged here, and not sent again until this app is
        // updated. The next pull stops at it.
        if (record) kept.push(put('cloudRecords', { ...record, ahead: writtenBy(theirs) }))
        else {
          const now = /** @type {Waiting|undefined} */ (await state.get('cloudOutbox', entry.id))
          if (now && now.at === entry.at) {
            outbox.push(put('cloudOutbox', { ...now, ahead: writtenBy(theirs) }))
          }
        }
        continue
      }
      const taken = await take(collection, theirs, result.name, result.conflict.rev, {
        record,
        waiting: entry,
        own: result.conflict.own,
      })
      kept.push(taken.kept)
      if (taken.outbox) outbox.push(taken.outbox)
      incoming.push(...taken.incoming)
      clashes.push(...taken.clashes)
    }
    if (incoming.length > 0) await local.write(storyId, incoming)
    for (const clash of clashes) {
      diagnostics.count(clash.large ? 'clashesLarge' : 'clashesSmall')
      await local.keepClash(storyId, clash)
    }
    if (kept.length > 0) await state.write('cloudRecords', kept)
    if (outbox.length > 0) await state.write('cloudOutbox', outbox)
    const reading = /** @type {Reading|undefined} */ (
      await state.get('cloudState', `collection:${storyId}`)
    )
    if (reading && reading.cursor === pushed.from) {
      await state.write('cloudState', [put('cloudState', { ...reading, cursor: pushed.seq })])
    }
  }

  // Files.

  /**
   * Upload a file's bytes, carrying on from the parts the server has.
   *
   * @param {Known} collection
   * @param {Waiting} entry
   * @param {Blob} bytes
   * @returns {Promise<FileInfo>}
   */
  async function upload(collection, entry, bytes) {
    let blob = entry.blob
    if (!blob) {
      blob = toBase64(randomBytes(18)).replace(/\+/g, '-').replace(/\//g, '_')
      await state.write('cloudOutbox', [put('cloudOutbox', { ...entry, blob })])
    }
    const parts = Math.max(1, Math.ceil(bytes.size / PART_SIZE))
    const have = new Set(await api.parts(collection.id, blob))
    for (let part = 0; part < parts; part++) {
      if (have.has(part)) continue
      const plain = new Uint8Array(
        await bytes.slice(part * PART_SIZE, (part + 1) * PART_SIZE).arrayBuffer()
      )
      const sealed = await seal(collection.keys.seal, plain, `${collection.id}/${blob}/${part}`)
      await api.putPart(collection.id, blob, part, sealed)
      diagnostics.count('bytesUp', sealed.length)
      diagnostics.count('partsUp')
    }
    return { blob, size: bytes.size, type: bytes.type, parts }
  }

  /** @returns {Promise<Pending[]>} */
  const pending = async () =>
    (await state.all('cloudState')).filter(row => row.id.startsWith('file:'))

  /** Download the bytes this device wants at once: pictures, rather than files. */
  async function fetchFiles() {
    for (const want of await pending()) {
      if (!local.syncsHere(want.storyId)) continue
      if (!local.fetchesAtOnce(want.table ?? 'files', want.fileId)) continue
      if (!keysById.has(want.collection)) continue
      await fetchOne(want)
    }
  }

  /** Fetches under way, by the file's id. @type {Map<string, Promise<Blob>>} */
  const fetching = new Map()

  /**
   * Download one file's bytes and keep them here.
   *
   * @param {Pending} want
   * @param {(done: number, total: number) => void} [progress] - Told of each part
   * @returns {Promise<Blob>}
   */
  function fetchOne(want, progress) {
    const under = fetching.get(want.fileId)
    if (under) return under
    const work = (async () => {
      if (!keysById.has(want.collection)) await learn((await api.listing()).collections)
      const collectionKeys_ = keysById.get(want.collection)
      if (!collectionKeys_) throw new Error('That file is no longer on the sync server.')
      const { file } = want
      /** @type {Bytes[]} */
      const parts = []
      progress?.(0, file.parts)
      for (let part = 0; part < file.parts; part++) {
        const sealed = await api.getPart(want.collection, file.blob, part)
        diagnostics.count('bytesDown', sealed.length)
        parts.push(
          await open(collectionKeys_.seal, sealed, `${want.collection}/${file.blob}/${part}`)
        )
        progress?.(part + 1, file.parts)
      }
      const table = want.table ?? 'files'
      const blob = new Blob(parts, { type: file.type })
      expected.set(`${table}:${want.fileId}`, FETCHED)
      await local.putFileBytes(table, want.fileId, want.storyId, blob, want.row)
      await state.write('cloudState', [removal('cloudState', want.id)])
      diagnostics.count('filesFetched')
      return blob
    })()
    work.catch(error => {
      diagnostics.count('filesFailed')
      diagnostics.error(`fetch file: ${errorTag(error)}`)
    })
    fetching.set(want.fileId, work)
    work.finally(() => fetching.delete(want.fileId)).catch(() => {})
    return work
  }

  /**
   * Whether a file's bytes are on the server and not here: to fetch when
   * they are wanted.
   * @param {string} id
   */
  const hasFile = async id => Boolean(await state.get('cloudState', `file:${id}`))

  /**
   * A file's bytes from the server, fetched now and kept here.
   *
   * @param {string} id - The file document's id
   * @param {(done: number, total: number) => void} [progress]
   * @returns {Promise<Blob|null>} Null when the server has none of it for this device
   * @throws {CloudError} When the server can't be reached
   */
  async function fetchFile(id, progress) {
    /** @type {Pending|undefined} */
    const want = await state.get('cloudState', `file:${id}`)
    return want ? fetchOne(want, progress) : null
  }

  /**
   * Fetch every file of these projects that is still on the server alone,
   * as a backup wants them. Stops at the first that can't be fetched.
   *
   * @param {string[]} [storyIds] - Every project when absent
   * @returns {Promise<number>} How many are left unfetched
   */
  async function fetchProjectFiles(storyIds) {
    const wanted = (await pending()).filter(want => !storyIds || storyIds.includes(want.storyId))
    for (const [at, want] of wanted.entries()) {
      try {
        await fetchOne(want)
      } catch (error) {
        console.error('Sync could not fetch a file:', error)
        return wanted.length - at
      }
    }
    return 0
  }

  return {
    noteWrite,
    noted,
    round,
    enqueue,
    hasFile,
    fetchFile,
    fetchProjectFiles,
    share,
    removeMember,
    leave,
    profile,
    /**
     * Give this account the name the people it shares with see.
     * @param {string} display - Empty for none
     */
    setDisplay: async display => {
      await api.setDisplay(display)
      peopleAsked.clear()
    },
    /**
     * Begin keeping a project off sync, its story saying so already
     * (`syncOff`): the next round takes it off the server.
     * @param {string} storyId
     */
    async keepOff(storyId) {
      await state.write('cloudState', [
        put('cloudState', { id: `keepOff:${storyId}`, project: storyId }),
      ])
    },
    /**
     * Sync a project kept off again, its story no longer saying so: it goes
     * up whole.
     * @param {string} storyId
     */
    async syncAgain(storyId) {
      await state.write('cloudState', [removal('cloudState', `keepOff:${storyId}`)])
      await enqueue([storyId])
    },
    /** Compare every row here with the server's again in the next round, as a launch does. */
    checkNextRound() {
      checked = false
    },
    /** @returns {Status} */
    get status() {
      return status
    },
  }
}

/** @typedef {ReturnType<typeof createEngine>} Engine */
