/* global structuredClone */
/**
 * A device for sync's tests: its rows in maps, as storage would hold them,
 * telling its engine of every write the way the storage facade does, and
 * its own state in memory.
 */

import { createEngine } from '@/cloud/engine.js'
import { SETTINGS, SETUP, SETUP_TABLES, idOf } from '@/cloud/setup.js'
import { CLASHED } from '@/utils/versions.js'

/** @typedef {import('@/types/models.js').Change} Change */

/** Sync's own tables, in memory. */
export function memoryState() {
  /** @type {Map<string, Map<string, any>>} */
  const tables = new Map()
  /** @param {string} name */
  const table = name => {
    let rows = tables.get(name)
    if (!rows) tables.set(name, (rows = new Map()))
    return rows
  }
  return {
    get: async (/** @type {string} */ name, /** @type {string} */ id) =>
      structuredClone(table(name).get(id)),
    all: async (/** @type {string} */ name) =>
      [...table(name).values()].map(row => structuredClone(row)),
    ofStory: async (/** @type {string} */ name, /** @type {string} */ storyId) =>
      [...table(name).values()]
        .filter(row => row.storyId === storyId)
        .map(row => structuredClone(row)),
    write: async (/** @type {string} */ name, /** @type {Change[]} */ changes) => {
      for (const change of changes) {
        if (change.op === 'delete') table(name).delete(change.id)
        else table(name).set(change.id, structuredClone(change.data))
      }
    },
  }
}

/**
 * @param {string} table
 * @param {any} row
 * @returns {Change}
 */
const putOf = (table, row) => ({
  entityType: table,
  id: /** @type {string} */ (idOf(table, row) ?? row.id),
  op: 'put',
  data: structuredClone(row),
  timestamp: Date.now(),
})

/**
 * @param {string} table
 * @param {string} id
 * @returns {Change}
 */
const removalOf = (table, id) => ({ entityType: table, id, op: 'delete', data: null, timestamp: 0 })

/**
 * @param {{api: import('@/cloud/api.js').Api, keys: import('@/cloud/crypto.js').AccountKeys, schema?: number, format?: number, now?: () => number, diagnostics?: import('@/cloud/diagnostics.js').Diagnostics}} options
 */
export function makeDevice({ api, keys, schema = 32, format, now = Date.now, diagnostics }) {
  /** What the engine last said of the projects shared. @type {import('@/cloud/engine.js').Sharing} */
  let sharing = { me: null, projects: {}, selective: [] }
  /** @type {Record<string, Map<string, any>>} */
  const db = {
    stories: new Map(),
    documents: new Map(),
    chats: new Map(),
    messages: new Map(),
    files: new Map(),
    versions: new Map(),
    ...Object.fromEntries([...SETUP_TABLES, SETTINGS].map(table => [table, new Map()])),
  }
  const state = memoryState()
  let clashes = 0

  /** @type {import('@/cloud/engine.js').Engine} */
  let engine

  /**
   * A write, made and told.
   * @param {string} table
   * @param {Change[]} changes
   */
  function write(table, changes) {
    for (const change of changes) {
      if (change.op === 'delete') db[table].delete(change.id)
      else db[table].set(change.id, structuredClone(change.data))
    }
    engine.noteWrite({ method: 'write', table, changes })
  }

  /** @param {string} storyId */
  function rowsOf(storyId) {
    const chats = [...db.chats.values()].filter(chat => chat.storyId === storyId)
    const chatIds = new Set(chats.map(chat => chat.id))
    return {
      story: db.stories.get(storyId),
      documents: [...db.documents.values()].filter(row => row.storyId === storyId),
      chats,
      messages: [...db.messages.values()].filter(row => chatIds.has(row.chatId)),
      files: [...db.files.values()]
        .filter(row => row.storyId === storyId)
        .map(({ id }) => ({ id, storyId })),
      versions: [...db.versions.values()].filter(row => row.storyId === storyId),
    }
  }

  /** @type {import('@/cloud/engine.js').Local} */
  const local = {
    settle: async () => {},
    projects: async () => [...db.stories.keys()],
    readProject: async storyId =>
      db.stories.has(storyId) ? structuredClone(rowsOf(storyId)) : null,
    tree: async storyId =>
      structuredClone([...db.documents.values()].filter(row => row.storyId === storyId)),
    versions: async storyId =>
      structuredClone([...db.versions.values()].filter(row => row.storyId === storyId)),
    readSetup: async () =>
      Object.fromEntries(
        [...SETUP_TABLES, SETTINGS].map(table => [table, structuredClone([...db[table].values()])])
      ),
    storyOfChat: async chatId => db.chats.get(chatId)?.storyId ?? null,
    fileBytes: async (table, id) =>
      (table === 'files' ? db.files.get(id)?.blob : db.cardFiles.get(id)?.image) ?? null,
    async write(storyId, incoming) {
      const tables =
        storyId === SETUP
          ? [...SETUP_TABLES, SETTINGS]
          : ['stories', 'documents', 'chats', 'messages', 'files', 'versions']
      for (const table of tables) {
        const changes = incoming
          .filter(item => item.table === table)
          .map(item => (item.row ? putOf(table, item.row) : removalOf(table, item.id)))
        if (changes.length > 0) write(table, changes)
      }
    },
    async addProject(project) {
      db.stories.set(project.story.id, structuredClone(project.story))
      for (const table of ['documents', 'chats', 'messages', 'versions']) {
        for (const row of /** @type {any} */ (project)[table] ?? [])
          db[table].set(row.id, structuredClone(row))
      }
      engine.noteWrite({ method: 'addProject', project: structuredClone(project) })
    },
    async removeProject(storyId) {
      for (const table of Object.keys(db)) {
        for (const [id, row] of db[table]) {
          if ((table === 'stories' ? row.id : row.storyId) === storyId) db[table].delete(id)
        }
      }
      engine.noteWrite({ method: 'removeProject', storyId })
    },
    async putFileBytes(table, id, storyId, blob, row) {
      if (table === 'cardFiles') {
        write('cardFiles', [putOf('cardFiles', { ...row, id, image: blob })])
        return
      }
      db.files.set(id, { id, storyId, blob })
      engine.noteWrite({ method: 'putFileBytes', id, storyId })
    },
    async keepClash(storyId, { of, content, large }) {
      clashes++
      const version = {
        id: `ver_clash${clashes}_${Math.random().toString(36).slice(2)}`,
        storyId,
        documentId: of.id,
        at: Date.now(),
        title: of.title,
        content,
        words: 0,
        name: CLASHED,
        clash: large ? 'large' : 'small',
      }
      write('versions', [putOf('versions', version)])
    },
    // As the app: a picture comes with its document, a file when it is wanted.
    fetchesAtOnce: (table, id) => table !== 'files' || id.includes('/'),
    syncsHere: () => true,
    async keptOff() {
      /** @type {Map<string, 'here'|'elsewhere'>} */
      const off = new Map()
      for (const story of db.stories.values()) {
        if (story.syncOff) off.set(story.id, 'here')
        else if (story.keptElsewhere) off.set(story.id, 'elsewhere')
      }
      return off
    },
  }

  /**
   * An app that writes this schema, and, given a format, reads that and
   * writes it on every record, as an app does that knows no newer one.
   *
   * @param {{schema: number, format?: number}} writes
   */
  const start = ({ schema, format }) =>
    createEngine({
      api,
      keys,
      local,
      state,
      schema,
      ...(format === undefined ? {} : { format, formatOf: () => format }),
      upgrade: (table, row) => row,
      onSharing: told => {
        sharing = told
      },
      now,
      diagnostics,
    })
  engine = start({ schema, format })

  return {
    db,
    state,
    get engine() {
      return engine
    },
    /** What the engine last said of the projects shared. */
    get sharing() {
      return sharing
    },
    api,
    /**
     * The app updated: its engine made again over what it kept.
     * @param {{schema?: number, format?: number}} writes
     */
    update: writes => {
      engine = start({ schema, format, ...writes })
    },
    /**
     * The writer writing a row.
     * @param {string} table
     * @param {any} row
     */
    put: (table, row) => write(table, [putOf(table, row)]),
    /**
     * The writer removing a row.
     * @param {string} table
     * @param {string} id
     */
    remove: (table, id) => write(table, [removalOf(table, id)]),
    /**
     * A file imported.
     * @param {string} id
     * @param {string} storyId
     * @param {Blob} blob
     */
    putFile: (id, storyId, blob) => local.putFileBytes('files', id, storyId, blob),
    /** @param {string} storyId */
    removeProject: storyId => local.removeProject(storyId),
    sync: () => engine.round(),
    /** What waits to be sent. */
    waiting: async () => (await state.all('cloudOutbox')).map(row => row.id).sort(),
  }
}
