/**
 * Storage in IndexedDB, through Dexie: every table, on the web and, until the
 * library on disk, in the desktop app.
 */

import db from '@/stores/db.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/** @typedef {import('./index.js').Storage} Storage */

/** @type {Storage} */
export const dexieStorage = {
  schemaVersion: () => db.verno,

  stories: () => db.stories.toArray(),

  story: id => db.stories.get(id),

  documents: storyId => db.documents.where('storyId').equals(storyId).toArray(),

  async roots(storyIds) {
    const rows = await db.documents.bulkGet(storyIds.map(rootIdFor))
    return rows.filter(Boolean)
  },

  chats: storyId => db.chats.where('storyId').equals(storyId).toArray(),

  chat: id => db.chats.get(id),

  messages: chatId => db.messages.where('chatId').equals(chatId).toArray(),

  async fileBytes(id) {
    const row = await db.files.get(id)
    return row?.blob ?? null
  },

  projectFiles: storyId => db.files.where('storyId').equals(storyId).toArray(),

  async putFileBytes(id, storyId, blob) {
    await db.files.put({ id, storyId, blob })
  },

  async updateEach(table, change) {
    let changed = 0
    await db[table].toCollection().modify((/** @type {any} */ row) => {
      const changes = change(row)
      if (!changes) return
      Object.assign(row, changes)
      changed++
    })
    return changed
  },

  async addProject({ story, documents, files, chats, messages }) {
    await db.transaction(
      'rw',
      [db.stories, db.documents, db.files, db.chats, db.messages],
      async () => {
        await db.stories.add(story)
        await db.documents.bulkAdd(documents)
        await db.files.bulkAdd(files)
        await db.chats.bulkAdd(chats)
        await db.messages.bulkAdd(messages)
      }
    )
  },

  async removeProject(storyId) {
    await db.transaction(
      'rw',
      [db.stories, db.documents, db.files, db.chats, db.messages],
      async () => {
        const chatIds = await db.chats.where('storyId').equals(storyId).primaryKeys()
        await db.messages.where('chatId').anyOf(chatIds).delete()
        await db.chats.bulkDelete(chatIds)
        await db.files.where('storyId').equals(storyId).delete()
        await db.documents.where('storyId').equals(storyId).delete()
        await db.stories.delete(storyId)
      }
    )
  },

  all: table => db[table].toArray(),

  get: (table, id) => db[table].get(id),

  async getMany(table, ids) {
    const rows = await db[table].bulkGet(ids)
    return rows.filter(Boolean)
  },

  async put(table, row) {
    await db[table].put(row)
  },

  async remove(table, ids) {
    await db[table].bulkDelete(ids)
  },

  ofStory: (table, storyId) => db[table].where('storyId').equals(storyId).toArray(),

  has: table => Boolean(db[table]),

  async write(table, changes) {
    /** @type {import('dexie').Table} */
    const rows = db[table]
    await db.transaction('rw', rows, async () => {
      for (const change of changes) {
        if (change.op === 'delete') await rows.delete(change.id)
        else await rows.put(change.data)
      }
    })
  },

  async dump() {
    /** @type {Record<string, any[]>} */
    const tables = {}
    await Promise.all(
      db.tables.map(async (/** @type {import('dexie').Table} */ table) => {
        tables[table.name] = await table.toArray()
      })
    )
    return tables
  },

  async replaceAll(tables, keep = []) {
    let restored = 0
    const replaced = db.tables.filter(
      (/** @type {import('dexie').Table} */ table) => !keep.includes(table.name)
    )
    await db.transaction('rw', replaced, async () => {
      for (const table of replaced) {
        await table.clear()
        const rows = tables[table.name]
        if (!Array.isArray(rows) || rows.length === 0) continue
        await table.bulkPut(rows)
        restored += rows.length
      }
    })
    return restored
  },
}
