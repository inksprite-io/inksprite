/* global Blob */
/**
 * @module composables/useBackup
 * @description Whole-database export and import — the manual recovery path —
 * and single chats in the same envelope.
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
 */

import db from '@/stores/db'
import { useSyncStore } from '@/stores/syncStore'
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
  serializeFiles,
  deserializeFiles,
} from '@/utils/backup'
import { useEditor } from './useEditor.js'
import { assembleTurn, inspectCommand } from '@/ai/commands.js'
import { obfuscateBackup } from '@/utils/obfuscate.js'

/** @typedef {import('@/utils/backup.js').Backup} Backup */
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
   * @param {'database'|'chat'} scope - What the caller expects the file to hold
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
   * @param {'database'|'chat'} scope
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
    const { title, character, note, messages } = readTranscript(text, filename)
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
      version: 1,
      created: messages[0].created,
      updated: last,
    }

    return { chat, messages, character, note }
  }

  return {
    createBackup,
    downloadBackup,
    readBackupFile,
    restoreBackup,
    createChatBackup,
    downloadChat,
    readChatFile,
  }
}
