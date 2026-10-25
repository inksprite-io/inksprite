/**
 * @module cloud/local
 * @description The app as sync's engine reaches it: projects read whole for
 * a first sync, and what other devices wrote written here.
 *
 * What comes in goes where the app reads it. A project whose tree this
 * window has loaded takes it through the stores, so that what is in memory
 * and what is stored stay one; a document open in the editor takes its new
 * text as an outside edit, merged with whatever was typed since the round
 * began. Anything not loaded is written straight to storage. Either way it
 * comes back through the storage facade to the engine, which expects it.
 *
 * The text that lost a clash is kept as a version of its document, named
 * so that it never ages out, without a word: the merge has picked a winner,
 * and the version is there to go back to. Without versions, it is kept as a
 * conflict copy beside the document.
 *
 * The setup, the account's own collection (`cloud/setup.js`), is written to
 * the app tables and the settings, and the stores that read those tables
 * read them again, in this window as in the others.
 *
 * In the desktop app each window syncs the projects it holds, and the
 * window syncing for the app syncs the rest and the setup
 * (`platform/windows.js`).
 */

import { storage } from '@/storage/index.js'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useChatsStore } from '@/stores/chatsStore'
import { useMessagesStore } from '@/stores/messagesStore'
import { useSyncStore } from '@/stores/syncStore'
import { useFilesStore } from '@/stores/filesStore'
import { useVersionsStore } from '@/stores/versionsStore'
import { useEditor } from '@/composables/useEditor'
import { useApplicationState } from '@/composables/useApplicationState'
import { dropJobsForStory } from '@/jobs/index.js'
import {
  heldProjects,
  holdsProject,
  projectsElsewhere,
  tellThisWindow,
} from '@/platform/windows.js'
import { isDesktop } from '@/platform/desktop.js'
import { pictureKey, pictureOfKey } from '@/utils/pictures.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { isSourceFile } from '@/source/tree.js'
import { settleText } from './merge.js'
import { SETTINGS, SETUP, SETUP_TABLES, settingsOf, settingsRows } from './setup.js'

/** @typedef {import('./engine.js').Local} Local */
/** @typedef {import('./engine.js').Incoming} Incoming */
/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {import('@/types/models.js').Change} Change */

/**
 * @param {string} table
 * @param {any} row
 * @returns {Change}
 */
const putOf = (table, row) => ({
  entityType: table,
  id: row.id,
  op: 'put',
  data: row,
  timestamp: 0,
})

/**
 * @param {string} table
 * @param {string} id
 * @returns {Change}
 */
const removalOf = (table, id) => ({ entityType: table, id, op: 'delete', data: null, timestamp: 0 })

/**
 * The app, for the engine.
 *
 * @param {{syncsForApp: () => boolean}} window - Whether this window syncs the
 *   projects no window holds
 * @returns {Local}
 */
export function appLocal({ syncsForApp }) {
  const storiesStore = useStoriesStore()
  const documentsStore = useDocumentsStore()
  const chatsStore = useChatsStore()
  const messagesStore = useMessagesStore()
  const syncStore = useSyncStore()
  const versionsStore = useVersionsStore()
  const editor = useEditor()

  /** Projects other windows hold, as of the start of the round. @type {Set<string>} */
  let elsewhere = new Set()

  /**
   * A document's text as it came, put where it is read: the editor's, for
   * one open there, merged with what was typed since the store last heard.
   *
   * @param {Document|undefined} before
   * @param {Document} row
   */
  function intoEditor(before, row) {
    if (!editor.holds(row.id)) return
    const stored = before?.content ?? ''
    const typed = editor.markdown(row.id)
    const settled =
      typed === stored ? { text: row.content, lost: null } : settleText(stored, typed, row.content)
    // What was typed, as it was before the merge changed it.
    if (before && typed !== stored && settled.text !== typed) {
      versionsStore.before({ ...before, content: typed }, 'sync')
    }
    if (settled.lost) {
      keepClash(row.storyId, { of: row, ...settled.lost }).catch(error =>
        console.error('Sync could not keep the text that lost a clash:', error)
      )
    }
    editor.takeStored(row.id, settled.text, row.content)
  }

  /**
   * Keep the text that lost a clash, as a version of its document.
   *
   * @param {string} _storyId
   * @param {import('./engine.js').Clash} clash
   */
  async function keepClash(_storyId, { of, content, large }) {
    await versionsStore.keepClash({ ...of, content }, large)
  }

  /**
   * Rows of the setup as they came: the tables written, the settings taken,
   * and the stores told to read their tables again.
   *
   * @param {Incoming[]} incoming
   */
  async function writeSetup(incoming) {
    /** @type {Record<string, Change[]>} */
    const byTable = {}
    /** @type {any[]} */
    const settings = []
    for (const { table, id, row } of incoming) {
      if (table === SETTINGS) {
        if (row) settings.push(row)
        continue
      }
      ;(byTable[table] ??= []).push(
        row ? { entityType: table, id, op: 'put', data: row, timestamp: 0 } : removalOf(table, id)
      )
    }
    for (const [table, changes] of Object.entries(byTable)) await storage.write(table, changes)
    if (settings.length > 0) useApplicationState().restoreSettings(settingsOf(settings))
    const tables = Object.keys(byTable)
    if (tables.length > 0) tellThisWindow({ type: 'tables', tables })
  }

  /**
   * @param {string} storyId
   * @param {Incoming[]} incoming
   */
  async function write(storyId, incoming) {
    if (storyId === SETUP) return writeSetup(incoming)
    const loaded = documentsStore.isStoryLoaded(storyId)
    const chatsLoaded = chatsStore.isStoryLoaded(storyId)
    /** @type {Record<string, Change[]>} */
    const straight = {}
    /**
     * @param {string} table
     * @param {Change} change
     */
    const toStorage = (table, change) => (straight[table] ??= []).push(change)
    let listChanged = false
    /** @type {Array<any|null>} */
    const versions = []

    for (const { table, id, row, replaced } of incoming) {
      // A merge about to change this device's text keeps it as a version.
      if (replaced) versionsStore.before(replaced, 'sync')
      if (table === 'versions') versions.push(row)
      if (table === 'stories') {
        if (row) storiesStore.receive(row)
        listChanged = true
      } else if (table === 'documents' && loaded) {
        const before = documentsStore.getDocument(id)
        documentsStore.receive(id, row)
        // One gone to the trash elsewhere is let go of here, as one deleted.
        if (row && documentsStore.getDocument(id)) intoEditor(before, row)
        else if (editor.holds(id)) editor.discard(id)
      } else if (table === 'chats' && chatsLoaded) {
        chatsStore.receive(id, row)
      } else if (
        table === 'messages' &&
        messagesStore.isChatLoaded(row?.chatId ?? messagesStore.messages.get(id)?.chatId ?? '')
      ) {
        messagesStore.receive(id, row)
      } else {
        toStorage(table, row ? putOf(table, row) : removalOf(table, id))
        if (table === 'documents' && id === rootIdFor(storyId)) listChanged = true
      }
    }
    for (const [table, changes] of Object.entries(straight)) await storage.write(table, changes)
    if (versions.length > 0) versionsStore.received(versions)
    if (listChanged) {
      await syncStore.processSync()
      await storiesStore.refresh(heldProjects())
      await documentsStore.refreshRoots([storyId])
    }
  }

  return {
    async settle() {
      editor.flush()
      await syncStore.processSync()
      elsewhere = await projectsElsewhere()
    },

    projects: async () => (await storage.stories()).map(story => story.id),

    async readProject(storyId) {
      const story = await storage.story(storyId)
      if (!story) return null
      const documents = await storage.documents(storyId)
      const chats = await storage.chats(storyId)
      const messages = (await Promise.all(chats.map(chat => storage.messages(chat.id)))).flat()
      const versions = await storage.ofStory('versions', storyId)
      // A file's bytes, and each picture's, by the document they are of. A
      // repository's source file has none: its text is all there is of it.
      const byId = new Map(documents.map(document => [document.id, document]))
      const files = documents.flatMap(document => [
        ...(document.type === 'file' && !isSourceFile(id => byId.get(id), document)
          ? [{ id: document.id, storyId }]
          : []),
        ...Object.keys(document.pictures ?? {}).map(name => ({
          id: pictureKey(document.id, name),
          storyId,
        })),
      ])
      return { story, documents, chats, messages, files, versions }
    },

    versions: storyId => storage.ofStory('versions', storyId),

    async tree(storyId) {
      if (!documentsStore.isStoryLoaded(storyId)) return storage.documents(storyId)
      return [...documentsStore.documents.values(), ...documentsStore.trash.values()].filter(
        document => document.storyId === storyId
      )
    },

    async readSetup() {
      /** @type {Record<string, any[]>} */
      const setup = {}
      for (const table of SETUP_TABLES) setup[table] = await storage.all(/** @type {any} */ (table))
      setup[SETTINGS] = settingsRows(useApplicationState().settingsForBackup())
      return setup
    },

    async storyOfChat(chatId) {
      return (
        chatsStore.getChatById(chatId)?.storyId ?? (await storage.chat(chatId))?.storyId ?? null
      )
    },

    async fileBytes(table, id) {
      if (table === 'files') return storage.fileBytes(id)
      return (await storage.get('cardFiles', id))?.image ?? null
    },

    write,

    async addProject(project) {
      const { versions = [], ...rows } = project
      await storage.addProject({ ...rows, files: [] })
      if (versions.length > 0)
        await storage.write(
          'versions',
          versions.map(row => putOf('versions', row))
        )
      await storiesStore.refresh(heldProjects())
      await documentsStore.refreshRoots([project.story.id])
    },

    async removeProject(storyId) {
      if (!storiesStore.getStory(storyId) && !storiesStore.trash.has(storyId)) return
      await dropJobsForStory(storyId)
      await storiesStore.deleteStory(storyId)
    },

    // A file's bytes wait on the server until they are wanted; a picture comes
    // with its document, which shows it, and a card's with the card.
    fetchesAtOnce: (table, id) => table !== 'files' || pictureOfKey(id) !== null,

    async putFileBytes(table, id, storyId, blob, row) {
      if (table === 'files') return useFilesStore().putFile(id, storyId, blob)
      // A library card's picture, with the card it is of; the thumbnail is
      // made when the grid first wants it.
      await storage.put('cardFiles', { ...row, id, image: blob, thumbnail: null })
      tellThisWindow({ type: 'tables', tables: ['cardFiles'] })
    },

    keepClash,

    async keptOff() {
      /** @type {Map<string, 'here'|'elsewhere'>} */
      const off = new Map()
      for (const story of await storage.stories()) {
        if (story.syncOff) off.set(story.id, 'here')
        else if (story.keptElsewhere) off.set(story.id, 'elsewhere')
      }
      return off
    },
    syncsHere: storyId =>
      isDesktop()
        ? holdsProject(storyId) || (syncsForApp() && !elsewhere.has(storyId))
        : syncsForApp(),
  }
}
