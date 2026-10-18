/* global Blob */
/**
 * @module composables/useBackup
 * @description Whole-database export and import — the manual recovery path —
 * and single chats and whole projects in the same envelope.
 *
 * Export flushes anything the sync store is still holding, reads every table,
 * adds the settings kept outside the database (see `BackedUpSettings`), and
 * hands back a JSON file. Import replaces the database wholesale: every
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
 *
 * A settings file carries the writer's setup without their projects: the
 * connections, presets, profiles, servers and skills they picked, and the
 * settings kept outside the database. It is read back by `readDataFile`,
 * which takes a whole backup too, and merged into the setup here by
 * `importSettings`, item by item; see
 * `utils/settingsFile.js`. A file left in the desktop app's data folder by a
 * script arrives by the same way, as the app opens
 * (`composables/useSettingsFile.js`).
 *
 * Export in the settings offers all of it as a tree of boxes
 * (`utils/exportTree.js`). Every box ticked is a whole backup, and settings
 * alone are a settings file. Anything else is a selection: the projects
 * ticked, whole or the documents and chats ticked of them, the character
 * cards ticked, and the settings ticked. It is read back by `readDataFile`
 * too, and taken by `importSelection`, which adds the projects beside the
 * others and the cards to the library, and merges the settings, replacing
 * nothing else.
 */

import { storage } from '@/storage/index.js'
import { useSyncStore } from '@/stores/syncStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { isBuiltInPromptId } from '@/ai/prompts/index.js'
import { isBuiltInProfileId, settingsForNewChat } from '@/ai/profiles/index.js'
import { useProfiles } from './useProfiles.js'
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
  projectsFromTables,
  projectName,
  selectionFilename,
  withFreshIds,
  serializeFiles,
  serializeCardFiles,
  deserializeFiles,
  deserializeCardFiles,
} from '@/utils/backup'
import {
  SETTINGS_TABLES,
  rowId,
  settingsItems,
  pickSettings,
  planImport,
  settingsFilename,
  changesAnything,
} from '@/utils/settingsFile.js'
import { documentsWith } from '@/utils/exportTree.js'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'
import { localStorage } from '@/utils/localStorage.js'
import { useEditor } from './useEditor.js'
import { useApplicationState } from './useApplicationState.js'
import { assembleTurn, inspectCommand } from '@/ai/commands.js'
import { obfuscateBackup } from '@/utils/obfuscate.js'
import { pictureOfKey } from '@/utils/pictures.js'

/** @typedef {import('@/utils/backup.js').Backup} Backup */
/** @typedef {import('@/utils/backup.js').BackupScope} BackupScope */
/** @typedef {import('@/utils/backup.js').ProjectRows} ProjectRows */
/** @typedef {import('@/types/models.js').Story} Story */
/** @typedef {import('@/types/models.js').StoredChatProfile} StoredChatProfile */
/** @typedef {import('@/types/models.js').Chat} Chat */
/** @typedef {import('@/types/models.js').Message} Message */
/** @typedef {import('@/types/models.js').AIPrompt} AIPrompt */
/** @typedef {import('@/utils/settingsFile.js').SettingsItem} SettingsItem */
/** @typedef {import('@/utils/settingsFile.js').SettingsImport} SettingsImport */
/** @typedef {import('@/utils/exportTree.js').Exportable} Exportable */
/** @typedef {import('@/utils/exportTree.js').ExportPick} ExportPick */
/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {import('@/types/models.js').LibraryCard} LibraryCard */
/** @typedef {import('@/types/models.js').CardFile} CardFile */

/**
 * What a selection file holds, read and ready to take. Nothing is written
 * until it is taken.
 *
 * @typedef {Object} SelectionImport
 * @property {ProjectRows[]} projects
 * @property {{rows: LibraryCard[], files: CardFile[]}} cards
 * @property {SettingsImport} plan - What its settings change here
 */

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

/**
 * Where the fingerprint of each item a settings file brought in is kept: in
 * this copy of the app, beside the settings it was imported into.
 */
const IMPORTED_KEY = 'inksprite.settings-imported'

export function useBackup() {
  /**
   * Read every table there is.
   *
   * Every table storage has rather than a hardcoded list, so a table added
   * later is backed up without anyone remembering to update this. The two
   * tables that cannot go into JSON as read are `files` and `cardFiles`,
   * whose rows hold Blobs; those are written out as base64 and read back the
   * same way.
   *
   * @returns {Promise<Record<string, any[]>>}
   */
  async function readAllTables() {
    const tables = await storage.dump()
    if (tables.files) tables.files = await serializeFiles(tables.files)
    if (tables.cardFiles) tables.cardFiles = await serializeCardFiles(tables.cardFiles)
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
    return buildBackup(tables, {
      dbVersion: storage.schemaVersion(),
      includeApiKeys,
      settings: useApplicationState().settingsForBackup(),
    })
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
    return checkBackup(parseJson(text), scope)
  }

  /**
   * @param {string} text
   * @returns {any}
   * @throws {Error} If it is not JSON
   */
  function parseJson(text) {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('That file is not valid JSON.')
    }
  }

  /**
   * Check that parsed JSON holds what is expected, in a shape this build can
   * read.
   *
   * @param {any} parsed
   * @param {BackupScope} scope
   * @returns {Backup}
   * @throws {Error} If it does not, saying why
   */
  function checkBackup(parsed, scope) {
    const { ok, errors } = validateBackup(parsed, storage.schemaVersion(), scope)
    if (!ok) throw new Error(errors.join(' '))
    return parsed
  }

  /**
   * Read a file picked to import from the settings: a whole backup, a
   * settings file, or a selection, which says which it is; a project file is
   * taken as a selection of one project. Nothing is written. A backup comes
   * back with what it holds; settings with what importing them would change
   * here; a selection with its projects and cards as well.
   *
   * @param {File} file
   * @returns {Promise<{kind: 'backup', backup: Backup, summary: Array<{table: string, count: number}>}
   *   | {kind: 'settings', backup: Backup, plan: SettingsImport}
   *   | {kind: 'selection', backup: Backup, selection: SelectionImport}>}
   * @throws {Error} If the file is none of them, saying why
   */
  async function readDataFile(file) {
    const parsed = parseJson(await file.text())
    if (parsed?.scope === 'settings') {
      const backup = checkBackup(parsed, 'settings')
      return { kind: 'settings', backup, plan: await planSettings(backup, { byHand: true }) }
    }
    if (parsed?.scope === 'selection' || parsed?.scope === 'project') {
      const backup = checkBackup(parsed, parsed.scope)
      return { kind: 'selection', backup, selection: await readSelection(backup) }
    }
    const backup = checkBackup(parsed, 'database')
    return { kind: 'backup', backup, summary: summarizeBackup(backup) }
  }

  /**
   * Replace the database contents with a backup.
   *
   * Rows are moved forward to the running schema version first, so a backup
   * taken before a migration restores into the shape the app expects. Tables
   * present in the database but absent from the backup are emptied — the
   * backup is the whole truth, not a patch. The settings kept outside the
   * database are taken too, when the backup has them.
   *
   * @param {Backup} backup
   * @returns {Promise<{restored: number}>} Total rows written
   */
  async function restoreBackup(backup) {
    const tables = upgradeTables(backup.tables, backup.dbVersion, storage.schemaVersion())
    const { files, cardFiles } = tables
    const restored = await storage.replaceAll({
      ...tables,
      ...(Array.isArray(files) ? { files: deserializeFiles(files) } : {}),
      ...(Array.isArray(cardFiles) ? { cardFiles: deserializeCardFiles(cardFiles) } : {}),
    })
    if (backup.settings) useApplicationState().restoreSettings(backup.settings)
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

    const chat = await storage.chat(chatId)
    if (!chat) throw new Error(`Chat '${chatId}' not found`)

    const messages = (await storage.messages(chatId)).sort((a, b) => a.created - b.created)

    // The prompt travels with the chat when it is one of the user's own: a
    // built-in is wherever the file is opened, a saved prompt may not be.
    const prompt = await savedPromptOf(chat)

    return buildBackup(
      { chats: [chat], messages, ...(prompt ? { aiPrompts: [prompt] } : {}) },
      { dbVersion: storage.schemaVersion(), scope: 'chat' }
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
    const profile = await storage.get('chatProfiles', id)
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
   * extension, and comes back as the same rows with who it was with beside
   * them, which is all it knows about its card. `useCardChat().attach` takes
   * it.
   *
   * @param {File} file
   * @returns {Promise<{chat: Chat, messages: Message[], prompt?: AIPrompt, character?: string}>}
   * @throws {Error} If the file is not a chat this build can read
   */
  async function readChatFile(file) {
    const text = await file.text()
    if (isTranscript(text)) return chatFromTranscript(text, file.name)

    const parsed = parseBackup(text, 'chat')
    return chatFromTables(upgradeTables(parsed.tables, parsed.dbVersion, storage.schemaVersion()))
  }

  /**
   * A SillyTavern chat as a chat of this app's.
   *
   * On the roleplay profile, stamped the way a new chat on it would be: a
   * transcript carries none of what ran it, and a roleplay is what it was. The
   * Author's Note goes after the profile's note rather than instead of it. It
   * is the nearest thing ST has to a chat's standing instructions, but what
   * writers put in one is where the scene has got to, not how a turn is
   * written.
   *
   * @param {string} text
   * @param {string} filename
   * @returns {{chat: Chat, messages: Message[], character: string}}
   */
  function chatFromTranscript(text, filename) {
    const { title, character, user, note, messages } = readTranscript(text, filename)
    const profiles = useProfiles()
    const settings = settingsForNewChat(profiles.getProfile(profiles.roleplayDefaultId()))
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

    return { chat, messages, character }
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

    const story = await storage.story(storyId)
    if (!story) throw new Error(`Project '${storyId}' not found`)

    const [documents, files, chats] = await Promise.all([
      storage.documents(storyId),
      storage.projectFiles(storyId),
      storage.chats(storyId),
    ])
    const messages = (await Promise.all(chats.map(chat => storage.messages(chat.id))))
      .flat()
      .sort((a, b) => a.created - b.created)

    const profiles = await savedProfilesOf([
      story.options?.profileId,
      ...chats.map(chat => chat.profileId || chat.promptId),
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
      { dbVersion: storage.schemaVersion(), scope: 'project' }
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
    return storage.getMany('chatProfiles', own)
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
    return projectFromTables(
      upgradeTables(parsed.tables, parsed.dbVersion, storage.schemaVersion())
    )
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
   * The rows are written straight to storage, which the stores read
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

    await storage.addProject({
      story,
      documents,
      files: deserializeFiles(files),
      chats,
      messages,
    })

    const profileStore = useChatProfileStore()
    await profileStore.ensureInitialized()
    for (const { id, name, settings } of profiles) {
      if (!profileStore.getProfile(id)) profileStore.createProfile({ id, name, settings })
    }

    await useStoriesStore().loadStory(story.id)
    await useDocumentsStore().loadRoots([story.id])
    return story
  }

  /**
   * The rows and outside settings a setup is made of, as they are here.
   *
   * @param {{flush?: boolean}} [options] - Save what the stores hold first
   *   (default true); nothing has been read yet as the app opens
   * @returns {Promise<{tables: Record<string, any[]>, settings: import('./useApplicationState.js').BackedUpSettings}>}
   */
  async function readSetup({ flush = true } = {}) {
    if (flush) await useSyncStore().processSync()
    const tables = await Promise.all(
      SETTINGS_TABLES.map(async table => [table, await storage.all(table)])
    )
    return {
      tables: Object.fromEntries(tables),
      settings: useApplicationState().settingsForBackup(),
    }
  }

  /**
   * Everything the writer could put in a settings file.
   *
   * @returns {Promise<SettingsItem[]>}
   */
  async function listSettings() {
    const { tables, settings } = await readSetup()
    return settingsItems(tables, settings)
  }

  /**
   * Snapshot the items picked of the writer's setup.
   *
   * @param {{picked: Set<string>, includeApiKeys?: boolean}} options - The
   *   keys of the items to put in (`SettingsItem.key`)
   * @returns {Promise<Backup>}
   */
  async function createSettingsBackup({ picked, includeApiKeys = false }) {
    const setup = await readSetup()
    const { tables, settings } = pickSettings(setup.tables, setup.settings, picked)
    return buildBackup(tables, {
      dbVersion: storage.schemaVersion(),
      includeApiKeys,
      scope: 'settings',
      settings,
    })
  }

  /**
   * Snapshot the items picked and hand the writer a file.
   *
   * @param {{picked: Set<string>, includeApiKeys?: boolean}} options
   * @returns {Promise<{filename: string, bytes: number}>}
   */
  async function downloadSettings(options) {
    return downloadJson(settingsFilename(new Date()), await createSettingsBackup(options))
  }

  /**
   * What Export can offer: every project by name, the cards in the library,
   * and the settings. A project's documents and chats are read when it is
   * opened in the tree (`readProjectContents`).
   *
   * @returns {Promise<Exportable>}
   */
  async function listExportable() {
    useEditor().flush()
    await useSyncStore().processSync()
    const stories = await storage.stories()
    const roots = new Map(
      (await storage.roots(stories.map(story => story.id))).map(root => [root.storyId, root])
    )
    const [cards, settings] = await Promise.all([storage.all('cards'), listSettings()])
    return {
      projects: stories.map(story => ({
        id: story.id,
        title: roots.get(story.id)?.title?.trim() || 'Untitled',
      })),
      cards: cards.map(card => ({ id: card.id, title: card.title || card.name || 'Untitled' })),
      settings,
    }
  }

  /**
   * A project's documents and chats, for its boxes in Export.
   *
   * @param {string} storyId
   * @returns {Promise<{documents: Document[], chats: Chat[]}>}
   */
  async function readProjectContents(storyId) {
    const [documents, chats] = await Promise.all([
      storage.documents(storyId),
      storage.chats(storyId),
    ])
    return { documents, chats }
  }

  /**
   * Snapshot what was ticked in Export: everything as a whole backup,
   * settings alone as a settings file, and anything else as a selection.
   *
   * A project goes whole, or as the documents ticked with the folders above
   * them, and the chats ticked with their messages; either way with the
   * writer's own profiles it and those chats run on, which travel with the
   * settings and are merged with them when the file is taken.
   *
   * @param {ExportPick} pick
   * @param {{includeApiKeys?: boolean}} [opts]
   * @returns {Promise<Backup>}
   */
  async function createSelectionBackup(pick, { includeApiKeys = false } = {}) {
    if (pick.everything) return createBackup({ includeApiKeys })
    if (pick.projects.length === 0 && pick.cardIds.length === 0) {
      return createSettingsBackup({ picked: pick.settings, includeApiKeys })
    }

    useEditor().flush()
    await useSyncStore().processSync()

    /** @type {Record<string, any[]>} */
    const tables = { stories: [], documents: [], files: [], chats: [], messages: [] }
    /** @type {Map<string, StoredChatProfile>} */
    const profiles = new Map()
    for (const picked of pick.projects) {
      const story = await storage.story(picked.id)
      if (!story) continue
      const [allDocuments, allFiles, allChats] = await Promise.all([
        storage.documents(story.id),
        storage.projectFiles(story.id),
        storage.chats(story.id),
      ])
      const documents = picked.whole
        ? allDocuments
        : documentsWith(allDocuments, story.id, picked.documentIds)
      const kept = new Set(documents.map(document => document.id))
      const chatIds = new Set(picked.chatIds)
      const chats = picked.whole ? allChats : allChats.filter(chat => chatIds.has(chat.id))
      const messages = (await Promise.all(chats.map(chat => storage.messages(chat.id))))
        .flat()
        .sort((a, b) => a.created - b.created)

      tables.stories.push(story)
      tables.documents.push(...documents)
      // A file document's bytes, or a text's pictures', by the document they are.
      const ownerOf = (/** @type {string} */ id) => pictureOfKey(id)?.documentId ?? id
      tables.files.push(
        ...(await serializeFiles(allFiles.filter(file => kept.has(ownerOf(file.id)))))
      )
      tables.chats.push(...chats)
      tables.messages.push(...messages)
      const own = await savedProfilesOf([
        story.options?.profileId,
        ...chats.map(chat => chat.profileId || chat.promptId),
      ])
      for (const profile of own) profiles.set(profile.id, profile)
    }

    if (pick.cardIds.length > 0) {
      tables.cards = await storage.getMany('cards', pick.cardIds)
      tables.cardFiles = await serializeCardFiles(await storage.getMany('cardFiles', pick.cardIds))
    }

    const setup = await readSetup({ flush: false })
    const { tables: settingsTables, settings } = pickSettings(
      setup.tables,
      setup.settings,
      pick.settings
    )
    for (const profile of settingsTables.chatProfiles || []) profiles.set(profile.id, profile)
    Object.assign(tables, settingsTables)
    if (profiles.size > 0) tables.chatProfiles = [...profiles.values()]

    return buildBackup(tables, {
      dbVersion: storage.schemaVersion(),
      includeApiKeys,
      scope: 'selection',
      settings,
    })
  }

  /**
   * Snapshot what was ticked in Export and hand the writer a file named for
   * what it is.
   *
   * @param {ExportPick} pick
   * @param {{includeApiKeys?: boolean}} [opts]
   * @returns {Promise<{filename: string, bytes: number}>}
   */
  async function downloadSelection(pick, opts = {}) {
    const backup = await createSelectionBackup(pick, opts)
    const now = new Date()
    const filename =
      backup.scope === 'settings'
        ? settingsFilename(now)
        : backup.scope === 'selection'
          ? selectionFilename(now)
          : backupFilename(now)
    return downloadJson(filename, backup)
  }

  /**
   * What a selection file brings: its projects and cards, and what its
   * settings change here.
   *
   * @param {Backup} backup - Checked already
   * @returns {Promise<SelectionImport>}
   */
  async function readSelection(backup) {
    const tables = upgradeTables(backup.tables, backup.dbVersion, storage.schemaVersion())
    return {
      projects: projectsFromTables(tables),
      cards: {
        rows: (tables.cards || []).filter(Boolean),
        files: deserializeCardFiles((tables.cardFiles || []).filter(Boolean)),
      },
      plan: await planSettings(backup, { byHand: true }),
    }
  }

  /**
   * Take a selection: its projects beside the others under ids of their own,
   * each numbered when its name is taken; its cards into the library, but
   * those already there; and its settings merged into those here.
   *
   * Its profiles come with its settings, so the projects bring none of their
   * own. The settings go straight to storage, so a caller must reload the
   * page afterwards when they changed anything, as for a settings file.
   *
   * @param {SelectionImport} selection
   * @returns {Promise<{projects: string[], cards: string[], settingsChanged: boolean}>} The
   *   names the projects were given, those of the cards added, and whether
   *   the settings changed
   */
  async function importSelection({ projects, cards, plan }) {
    const storiesStore = useStoriesStore()
    await storiesStore.loadNames()
    /** @type {string[]} */
    const names = []
    for (const project of projects) {
      const title = storiesStore.freeName(projectName(project))
      await importProject({ ...project, profiles: [] }, { title })
      names.push(title)
    }
    const added =
      cards.rows.length > 0
        ? (await useCardLibraryStore().addRows(cards.rows, cards.files)).added
        : []
    const settingsChanged = changesAnything(plan)
    if (settingsChanged) await importSettings(plan)
    return { projects: names, cards: added.map(card => card.title), settingsChanged }
  }

  /**
   * Work out what a settings file changes here, writing nothing.
   *
   * @param {Backup} backup - Checked already
   * @param {{byHand: boolean}} options - Picked by the writer, or left by a
   *   script; see `planImport`
   * @returns {Promise<SettingsImport>}
   */
  async function planSettings(backup, { byHand }) {
    const tables = upgradeTables(backup.tables, backup.dbVersion, storage.schemaVersion())
    return planImport({ tables, settings: backup.settings }, await readSetup({ flush: byHand }), {
      byHand,
      fingerprints: localStorage.get(IMPORTED_KEY, {}),
    })
  }

  /**
   * What a settings file's text left by a script changes here, writing
   * nothing. It is merged without the writer being asked: only what the file
   * changed since it, or one like it, was last imported.
   *
   * @param {string} text
   * @returns {Promise<SettingsImport>}
   * @throws {Error} If the text is not settings this build can read
   */
  async function planLeftSettings(text) {
    return planSettings(parseBackup(text, 'settings'), { byHand: false })
  }

  /**
   * Write what a settings file changes, and remember each item as it came.
   *
   * The rows go straight to storage, so a caller whose stores have already
   * read theirs must reload the page afterwards, as for a restore. As the app
   * opens, nothing has been read yet.
   *
   * @param {SettingsImport} plan
   * @returns {Promise<void>}
   */
  async function importSettings(plan) {
    const now = Date.now()
    for (const [table, rows] of Object.entries(plan.rows)) {
      await storage.write(
        table,
        rows.map(row => ({
          entityType: table,
          id: /** @type {string} */ (rowId(table, row)),
          op: 'put',
          data: row,
          timestamp: now,
        }))
      )
    }
    if (Object.keys(plan.settings).length > 0) {
      useApplicationState().restoreSettings(plan.settings)
    }
    localStorage.set(IMPORTED_KEY, plan.fingerprints)
  }

  return {
    createBackup,
    downloadBackup,
    readDataFile,
    restoreBackup,
    listSettings,
    createSettingsBackup,
    downloadSettings,
    listExportable,
    readProjectContents,
    createSelectionBackup,
    downloadSelection,
    importSelection,
    planLeftSettings,
    importSettings,
    createChatBackup,
    downloadChat,
    readChatFile,
    createProjectBackup,
    downloadProject,
    readProjectFile,
    importProject,
  }
}
