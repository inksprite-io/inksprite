/* global Blob */
/**
 * @module composables/useBackup
 * @description Whole-database export and import — the manual recovery path —
 * and single chats and whole projects in the same envelope.
 *
 * Export flushes anything the sync store is still holding, reads every table,
 * and hands back a JSON file. Import replaces the database wholesale: every
 * table is cleared and repopulated from the file. There is no merge mode,
 * because reconciling two divergent histories of the same story is guesswork
 * and a recovery tool should not guess.
 *
 * Pinia stores cache rows in memory, so a caller that restores must reload the
 * page afterwards. `restoreBackup` deliberately does not reload on its own —
 * that keeps it testable and lets the caller show a toast first.
 *
 * A chat exported on its own is read back by `readChatFile` and handed to
 * `useChats().importChat`, which adds it to a story through the stores. That
 * path replaces nothing, so it needs no reload.
 *
 * `readChatFile` also takes a chat exported from SillyTavern, which is not a
 * backup of anything but arrives by the same door: the writer has a chat in a
 * file and wants it in the project. See `cards/transcript.js`.
 *
 * A project exported on its own carries its tree, the bytes of its files, its
 * chats with their messages, and the writer's own profiles they run on. It is
 * read back by `readProjectFile` and added beside the other projects by
 * `importProject`, under new ids, so it never replaces anything either. Its
 * jobs stay behind: what a finished one made is already in the tree, and one
 * still running is work on this database, not the project's.
 */

import db from '@/stores/db'
import { useSyncStore } from '@/stores/syncStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { isBuiltInPromptId } from '@/ai/prompts/index.js'
import {
  isBuiltInProfileId,
  getBuiltInProfile,
  settingsForNewChat,
  ROLEPLAY_PROFILE_ID,
} from '@/ai/profiles/index.js'
import { isTranscript, readTranscript } from '@/cards/transcript.js'
import {
  buildBackup,
  validateBackup,
  upgradeTables,
  summarizeBackup,
  backupFilename,
  chatFilename,
  chatFromTables,
  projectFilename,
  projectFromTables,
  withFreshIds,
  serializeFiles,
  deserializeFiles,
} from '@/utils/backup'
import { useEditor } from './useEditor.js'
import { assembleTurn, inspectCommand } from '@/ai/commands.js'
import { obfuscateBackup } from '@/utils/obfuscate.js'

/** @typedef {import('@/utils/backup.js').Backup} Backup */
/** @typedef {import('@/utils/backup.js').BackupScope} BackupScope */
/** @typedef {import('@/utils/backup.js').ProjectRows} ProjectRows */
/** @typedef {import('@/types/models.js').Story} Story */
/** @typedef {import('@/types/models.js').StoredChatProfile} StoredChatProfile */
/** @typedef {import('@/types/models.js').Chat} Chat */
/** @typedef {import('@/types/models.js').Message} Message */
/** @typedef {import('@/types/models.js').AIPrompt} AIPrompt */

/**
 * Hand the user a JSON file.
 *
 * @param {string} filename
 * @param {unknown} data
 * @returns {{filename: string, bytes: number}}
 */
function downloadJson(filename, data) {
  const json = JSON.stringify(data, null, 2)

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)

  return { filename, bytes: json.length }
}

export function useBackup() {
  /**
   * Read every table currently declared on the database.
   *
   * Iterating `db.tables` rather than a hardcoded list means a table added
   * later is backed up without anyone remembering to update this. The one
   * table that cannot go into JSON as read is `files`, whose rows hold a
   * Blob; those are written out as base64 and read back the same way.
   *
   * @returns {Promise<Record<string, any[]>>}
   */
  async function readAllTables() {
    /** @type {Record<string, any[]>} */
    const tables = {}
    await Promise.all(
      db.tables.map(async (/** @type {import('dexie').Table} */ table) => {
        const rows = await table.toArray()
        tables[table.name] = table.name === 'files' ? await serializeFiles(rows) : rows
      })
    )
    return tables
  }

  /**
   * Snapshot the database.
   *
   * @param {{includeApiKeys?: boolean}} [opts]
   * @returns {Promise<Backup>}
   */
  async function createBackup({ includeApiKeys = false } = {}) {
    // Edits are debounced twice on the way to the database — the open
    // document into the store, the store into Dexie — so flush both before
    // reading, or the backup silently misses the last thing the user typed.
    useEditor().flush()
    await useSyncStore().processSync()

    const tables = await readAllTables()
    return buildBackup(tables, { dbVersion: db.verno, includeApiKeys })
  }

  /**
   * Snapshot the database and hand the user a file.
   *
   * @param {{includeApiKeys?: boolean}} [opts]
   * @returns {Promise<{filename: string, bytes: number}>}
   */
  async function downloadBackup(opts = {}) {
    return downloadJson(backupFilename(new Date()), await createBackup(opts))
  }

  /**
   * Parse an uploaded file and check it is something this build can read.
   *
   * @param {File} file
   * @param {BackupScope} scope - What the caller expects the file to hold
   * @returns {Promise<Backup>}
   * @throws {Error} If it is not, saying why
   */
  async function parseBackupFile(file, scope) {
    return parseBackup(await file.text(), scope)
  }

  /**
   * The same, for a file already read.
   *
   * @param {string} text
   * @param {BackupScope} scope
   * @returns {Backup}
   * @throws {Error} If it is not, saying why
   */
  function parseBackup(text, scope) {
    /** @type {any} */
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('That file is not valid JSON.')
    }

    const { ok, errors } = validateBackup(parsed, db.verno, scope)
    if (!ok) throw new Error(errors.join(' '))

    return parsed
  }

  /**
   * Parse and validate an uploaded file without touching the database.
   *
   * @param {File} file
   * @returns {Promise<{backup: Backup, summary: Array<{table: string, count: number}>}>}
   * @throws {Error} If the file is not readable as a backup for this build
   */
  async function readBackupFile(file) {
    const backup = await parseBackupFile(file, 'database')
    return { backup, summary: summarizeBackup(backup) }
  }

  /**
   * Replace the database contents with a backup.
   *
   * Rows are moved forward to the running schema version first, so a backup
   * taken before a migration restores into the shape the app expects. Tables
   * present in the database but absent from the backup are emptied — the
   * backup is the whole truth, not a patch.
   *
   * @param {Backup} backup
   * @returns {Promise<{restored: number}>} Total rows written
   */
  async function restoreBackup(backup) {
    const tables = upgradeTables(backup.tables, backup.dbVersion, db.verno)

    let restored = 0
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        await table.clear()
        const stored = tables[table.name]
        if (!Array.isArray(stored) || stored.length === 0) continue
        const rows = table.name === 'files' ? deserializeFiles(stored) : stored
        await table.bulkPut(rows)
        restored += rows.length
      }
    })

    return { restored }
  }

  /**
   * Snapshot one chat and its messages.
   *
   * The same envelope as a whole backup, marked as holding one chat, so a file
   * exported before a message migration is moved forward by the same
   * transforms when it is read back.
   *
   * @param {string} chatId
   * @returns {Promise<Backup>}
   * @throws {Error} If there is no such chat
   */
  async function createChatBackup(chatId) {
    await useSyncStore().processSync()

    const chat = await db.chats.get(chatId)
    if (!chat) throw new Error(`Chat '${chatId}' not found`)

    const messages = (await db.messages.where('chatId').equals(chatId).toArray()).sort(
      (/** @type {Message} */ a, /** @type {Message} */ b) => a.created - b.created
    )

    // The prompt travels with the chat when it is one of the user's own: a
    // built-in is wherever the file is opened, a saved prompt may not be.
    const prompt = await savedPromptOf(chat)

    return buildBackup(
      { chats: [chat], messages, ...(prompt ? { aiPrompts: [prompt] } : {}) },
      { dbVersion: db.verno, scope: 'chat' }
    )
  }

  /**
   * The saved profile a chat runs on, if it runs on one that is still here.
   *
   * Exported as a prompt, which is what the file format has always carried and
   * what an older build knows how to read. A profile is more than its prompt,
   * but a chat that arrives somewhere else with the right words and the wrong
   * tools is a better outcome than one that arrives with neither.
   *
   * @param {Chat} chat
   * @returns {Promise<AIPrompt|undefined>}
   */
  async function savedPromptOf(chat) {
    const id = chat.profileId || chat.promptId
    if (!id || isBuiltInProfileId(id) || isBuiltInPromptId(id)) return undefined
    const profile = await db.chatProfiles.get(id)
    if (!profile) return undefined
    return {
      id: profile.id,
      name: profile.name,
      content: profile.settings?.prompt || '',
      version: profile.version,
      created: profile.created,
      updated: profile.updated,
    }
  }

  /**
   * Snapshot one chat and hand the user a file named after it.
   *
   * Obfuscated, the file is the same chat with every letter replaced by a
   * random one of the same case: the same turns, tool calls and lengths,
   * saying nothing, for reporting a problem without sharing the story. See
   * utils/obfuscate.js for what is kept.
   *
   * @param {string} chatId
   * @param {{obfuscated?: boolean}} [options]
   * @returns {Promise<{filename: string, bytes: number}>}
   */
  async function downloadChat(chatId, { obfuscated = false } = {}) {
    const backup = await createChatBackup(chatId)
    const filename = chatFilename(backup.tables.chats[0].title)
    if (!obfuscated) return downloadJson(filename, backup)
    const scrambled = obfuscateBackup(backup, {
      consults: command =>
        inspectCommand({ name: command.name, input: command.input || '' }).consults,
      assemble: assembleTurn,
    })
    return downloadJson(filename.replace(/\.json$/, '.obfuscated.json'), scrambled)
  }

  /**
   * Read a single-chat file back into rows this build can use.
   *
   * Nothing is written. Which story the chat joins is the caller's to say; see
   * `useChats().importChat`, which also takes the prompt if the file carried
   * one.
   *
   * A SillyTavern chat is told apart by what is in it rather than by its
   * extension, and comes back as the same rows with two things beside them:
   * who it was with, which is all it knows about its card, and its Author's
   * Note. `useCardChat().attach` takes both.
   *
   * @param {File} file
   * @returns {Promise<{chat: Chat, messages: Message[], prompt?: AIPrompt, character?: string, note?: string}>}
   * @throws {Error} If the file is not a chat this build can read
   */
  async function readChatFile(file) {
    const text = await file.text()
    if (isTranscript(text)) return chatFromTranscript(text, file.name)

    const parsed = parseBackup(text, 'chat')
    return chatFromTables(upgradeTables(parsed.tables, parsed.dbVersion, db.verno))
  }

  /**
   * A SillyTavern chat as a chat of this app's.
   *
   * On the Roleplay profile, stamped the way a new chat on it would be: a
   * transcript carries none of what ran it, and a roleplay is what it was. The
   * Author's Note goes after the profile's note rather than instead of it. It
   * is the nearest thing ST has to a chat's standing instructions, but what
   * writers put in one is where the scene has got to, not how a turn is
   * written.
   *
   * @param {string} text
   * @param {string} filename
   * @returns {{chat: Chat, messages: Message[], character: string, note: string}}
   */
  function chatFromTranscript(text, filename) {
    const { title, character, user, note, messages } = readTranscript(text, filename)
    const settings = settingsForNewChat(getBuiltInProfile(ROLEPLAY_PROFILE_ID))
    const rules = [settings.rules, note].filter(Boolean).join('\n\n')
    const last = messages[messages.length - 1].created

    /** @type {Chat} */
    const chat = {
      id: '',
      storyId: '',
      title,
      titleSet: true,
      lastMessageAt: last,
      ...settings,
      ...(rules ? { rules } : {}),
      // The names it was played under, which a card's macros become in it.
      ...(user ? { userName: user } : {}),
      ...(character ? { characterName: character } : {}),
      version: 1,
      created: messages[0].created,
      updated: last,
    }

    return { chat, messages, character, note }
  }

  /**
   * Snapshot one project: its tree, the bytes behind its files, its chats
   * with their messages, and the writer's own profiles it and they run on.
   *
   * @param {string} storyId
   * @returns {Promise<Backup>}
   * @throws {Error} If there is no such project
   */
  async function createProjectBackup(storyId) {
    // Flushed both ways, as for a whole backup: the open document may be the
    // one in this project.
    useEditor().flush()
    await useSyncStore().processSync()

    const story = await db.stories.get(storyId)
    if (!story) throw new Error(`Project '${storyId}' not found`)

    const [documents, files, chats] = await Promise.all([
      db.documents.where('storyId').equals(storyId).toArray(),
      db.files.where('storyId').equals(storyId).toArray(),
      db.chats.where('storyId').equals(storyId).toArray(),
    ])
    const messages = (
      await db.messages
        .where('chatId')
        .anyOf(chats.map((/** @type {Chat} */ chat) => chat.id))
        .toArray()
    ).sort((/** @type {Message} */ a, /** @type {Message} */ b) => a.created - b.created)

    const profiles = await savedProfilesOf([
      story.options?.profileId,
      ...chats.map((/** @type {Chat} */ chat) => chat.profileId || chat.promptId),
    ])

    return buildBackup(
      {
        stories: [story],
        documents,
        files: await serializeFiles(files),
        chats,
        messages,
        chatProfiles: profiles,
      },
      { dbVersion: db.verno, scope: 'project' }
    )
  }

  /**
   * The writer's own profiles among these ids, those still here. A built-in
   * is wherever the file is opened; a saved one may not be.
   *
   * @param {Array<string|null|undefined>} ids
   * @returns {Promise<StoredChatProfile[]>}
   */
  async function savedProfilesOf(ids) {
    const own = [...new Set(ids)].filter(
      id => typeof id === 'string' && id && !isBuiltInProfileId(id) && !isBuiltInPromptId(id)
    )
    if (own.length === 0) return []
    return (await db.chatProfiles.bulkGet(own)).filter(Boolean)
  }

  /**
   * Snapshot one project and hand the user a file named after it.
   *
   * @param {string} storyId
   * @returns {Promise<{filename: string, bytes: number}>}
   */
  async function downloadProject(storyId) {
    const backup = await createProjectBackup(storyId)
    const root = backup.tables.documents.find(document => document.id === rootIdFor(storyId))
    return downloadJson(projectFilename(root?.title || ''), backup)
  }

  /**
   * Read a project file back into rows this build can use. Nothing is written.
   *
   * @param {File} file
   * @returns {Promise<ProjectRows>}
   * @throws {Error} If the file is not a project this build can read
   */
  async function readProjectFile(file) {
    const parsed = await parseBackupFile(file, 'project')
    return projectFromTables(upgradeTables(parsed.tables, parsed.dbVersion, db.verno))
  }

  /**
   * Add a project read from a file beside the others.
   *
   * Everything gets a new id, so the same file can be imported twice, or into
   * the database it came from, without touching what is there. The rows go
   * in together or not at all: a project half imported is a tree with no
   * story, or chats about documents that are not there.
   *
   * The profiles it runs on come with it, under their own ids. One the
   * library already holds is used as it stands, as for a chat imported alone:
   * the library is what the writer has been editing.
   *
   * The rows are written straight to the database, which the stores read
   * a project at a time, so they only need telling about the project itself:
   * its record and its root, which carries its name.
   *
   * A name given goes on its root before it is written, so the project is
   * never anything else here — renamed after, its old name came back with
   * the tree the project opened on, until the rename was saved.
   *
   * @param {ProjectRows} project
   * @param {object} [options]
   * @param {string} [options.title] - What to call it, if not what it was called
   * @returns {Promise<Story>} The project as it now exists here
   */
  async function importProject(project, { title } = {}) {
    const { story, documents, files, chats, messages, profiles } = withFreshIds(project)
    if (title !== undefined) {
      const root = documents.find(document => document.id === rootIdFor(story.id))
      if (root) root.title = title
    }

    await db.transaction(
      'rw',
      [db.stories, db.documents, db.files, db.chats, db.messages],
      async () => {
        await db.stories.add(story)
        await db.documents.bulkAdd(documents)
        await db.files.bulkAdd(deserializeFiles(files))
        await db.chats.bulkAdd(chats)
        await db.messages.bulkAdd(messages)
      }
    )

    const profileStore = useChatProfileStore()
    await profileStore.ensureInitialized()
    for (const { id, name, settings } of profiles) {
      if (!profileStore.getProfile(id)) profileStore.createProfile({ id, name, settings })
    }

    await useStoriesStore().loadStory(story.id)
    await useDocumentsStore().loadRoots([story.id])
    return story
  }

  return {
    createBackup,
    downloadBackup,
    readBackupFile,
    restoreBackup,
    createChatBackup,
    downloadChat,
    readChatFile,
    createProjectBackup,
    downloadProject,
    readProjectFile,
    importProject,
  }
}
