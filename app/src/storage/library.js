/* global Blob, structuredClone */

/**
 * Storage in the library: the desktop app's projects as folders of files in
 * the folder the writer chose, and the app's own tables in IndexedDB, as on
 * the web.
 *
 * The disk is the main process's (`electron/src/library.js`), reached through
 * `disk`: paths below the library, and the few things that can be done there.
 * What a project is as files is `layout.js`, and what a change of rows does to
 * them `plan.js`; this keeps where each project is, what it last saw of each
 * file, and turns the stores' changes into plans.
 *
 * Only a sketch of each project is kept here, its rows without their text:
 * the stores hold the text, and what is asked for is read from the disk
 * again. Everything is done one call at a time, in the order asked.
 *
 * A file's bytes are asked for by its document's id, and a text document's
 * picture's by its key (`utils/pictures.js`), which names the document; the
 * picture is in the `.images` beside it (`picturePath`).
 */

import { nanoid } from 'nanoid'
import { dexieStorage } from './dexie.js'
import {
  audioDir,
  audioPath,
  basePath,
  layoutProject,
  picturePath,
  readProject,
  wantedTexts,
  META,
  STORY_FILE,
} from './layout.js'
import { planProject, projectFiles, storyText } from './plan.js'
import {
  chatPath,
  messagesPath,
  chatText,
  readChat,
  readMessages,
  planMessages,
  mergeMessages,
  messagesText,
  inFileOrder,
} from './chats.js'
import { FOLDER_FILE, readFolderFile, sidecarPath } from './documents.js'
import { safeName, claimName, nameKey, stemFits } from './names.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { upgradeTables } from '@/utils/backup.js'
import { pictureKey, pictureOfKey } from '@/utils/pictures.js'
import { PROJECT_TABLES as PROJECT_TABLE_NAMES } from './index.js'

/** @typedef {import('./index.js').Storage} Storage */
/** @typedef {import('./plan.js').Op} Op */
/** @typedef {import('./layout.js').Entry} Entry */
/** @typedef {import('./chats.js').MessageLines} MessageLines */
/** @typedef {import('../types/models.js').Story} Story */
/** @typedef {import('../types/models.js').Document} Document */
/** @typedef {import('../types/models.js').Chat} Chat */
/** @typedef {import('../types/models.js').Message} Message */
/** @typedef {import('../types/models.js').StoredFile} StoredFile */
/** @typedef {import('../types/models.js').Change} Change */

/**
 * When a file was last written and how long it is.
 * @typedef {{mtime: number, size: number}} Seen
 */

/**
 * What may be done in the library, by paths below it. See
 * `electron/src/library.js`, which this is the page's view of.
 *
 * @typedef {{op: 'write', path: string, text?: string, bytes?: Uint8Array, expect?: Seen|null}
 *   | {op: 'append', path: string, at: number, text: string, size: number}
 *   | {op: 'move', from: string, to: string}
 *   | {op: 'trash', path: string}
 *   | {op: 'delete', path: string}} LibraryOp
 *
 * @typedef {Object} LibraryDisk
 * @property {() => Promise<{projects: string[], taken: string[]}>} projects
 * @property {(dir: string) => Promise<{files: Array<{path: string} & Seen>, closed: string[]}>} walk
 * @property {(dir: string) => Promise<string[]>} list - The names of the files in a folder
 * @property {(paths: string[]) => Promise<Record<string, string>>} read
 * @property {(path: string) => Promise<Uint8Array|null>} readBytes
 * @property {(ops: LibraryOp[]) => Promise<{seen: Record<string, Seen>, conflicts: string[]}>} apply
 */

/**
 * A file changed somewhere else since the app last saw it, which went to the
 * trash before the app's version was written.
 *
 * @typedef {Object} ChangedElsewhere
 * @property {string} path - Below the library
 * @property {string} title - The document it is, or its name when it is none
 */

/**
 * What the library keeps of a project.
 *
 * @typedef {Object} Project
 * @property {string} id - Its story's
 * @property {string|null} dir - Its folder below the library; null until first written
 * @property {Story|null} story
 * @property {Document|null} root
 * @property {boolean} loaded - Its folder walked and read, and what follows kept
 * @property {Map<string, Document>} rows - Its documents, without their text
 * @property {Map<string, Entry>} entries - Where each is
 * @property {Map<string, Seen>} seen - Its files as last read or written, by path below its folder
 * @property {string[]} taken - Paths in its folder that are no document
 * @property {Map<string, Chat>|null} chats - Read when first asked for
 * @property {Map<string, MessageLines>} lines - Each chat's messages file, as last read or written
 * @property {Map<string, Blob>} bytes - Imported files' and pictures' bytes that came before their rows
 * @property {Map<string, Chat>} freshChats - Chats of a project not written yet
 */

/**
 * The tables a project is made of; the rest stay in IndexedDB.
 * @type {Set<string>}
 */
const PROJECT_TABLES = new Set(PROJECT_TABLE_NAMES)

/** @param {Document} document */
const sketch = document => ({ ...document, content: '' })

/**
 * How much of a new project's folder goes to the disk at once: enough that
 * it goes quickly, and little enough to say how far it has got, and to hold
 * no more than a few files' bytes at a time.
 */
const BATCH_FILES = 50
const BATCH_BYTES = 16 * 1024 * 1024

/** @typedef {import('./index.js').Progress} Progress */

/** @param {string} dir @param {string} path */
const under = (dir, path) => (path ? `${dir}/${path}` : dir)

/** @param {string} path @param {string} dir */
const atOrBelow = (path, dir) => path === dir || path.startsWith(`${dir}/`)

/**
 * The document a file's bytes belong to: a file document's own id, or the
 * text a picture is of.
 *
 * @param {string} id
 */
const ownerOf = id => pictureOfKey(id)?.documentId ?? id

/**
 * Where the bytes asked for by this id are in a project's folder: an
 * imported file's, or a text document's picture's. Null for a document that
 * has none there.
 *
 * @param {Map<string, Entry>} entries
 * @param {string} id
 * @returns {string|null}
 */
const bytesPath = (entries, id) => {
  const picture = pictureOfKey(id)
  if (!picture) {
    const entry = entries.get(id)
    return entry?.kind === 'file' ? entry.path : null
  }
  const entry = entries.get(picture.documentId)
  return entry?.kind === 'text' ? picturePath(entry.path, picture.documentId, picture.name) : null
}

/**
 * The keys of every picture a project's documents have.
 *
 * @param {Map<string, Entry>} entries
 * @returns {string[]}
 */
const pictureKeys = entries =>
  [...entries.values()].flatMap(entry =>
    (entry.pictures || []).map(name => pictureKey(entry.id, name))
  )

/**
 * The library as storage.
 *
 * @param {LibraryDisk} disk
 * @param {Object} [options]
 * @param {(changed: ChangedElsewhere[]) => void} [options.onConflict] - Files changed
 *   elsewhere, put in the trash before being written over
 * @param {() => string} [options.newId] - An id for a document found without one
 * @param {() => number} [options.now]
 * @returns {Storage}
 */
export function libraryStorage(disk, options = {}) {
  const { onConflict = () => {}, newId = () => `doc_${nanoid()}`, now = Date.now } = options
  const schema = dexieStorage.schemaVersion()

  /** @type {Map<string, Project>} */
  const projects = new Map()
  /** @type {Set<string>} Names at the library's top, by key */
  const libraryTaken = new Set()
  /** @type {Promise<void>|null} */
  let listing = null
  /** @type {Map<string, {puts: Message[], deleted: string[]}>} Messages whose chat is not known yet */
  const waiting = new Map()

  /** @type {Promise<unknown>} */
  let doing = Promise.resolve()
  /**
   * @template T
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  const inTurn = work => {
    const done = doing.then(work)
    doing = done.catch(() => {})
    return done
  }

  /** @param {string} id @returns {Project} */
  const newProject = id => ({
    id,
    dir: null,
    story: null,
    root: null,
    loaded: false,
    rows: new Map(),
    entries: new Map(),
    seen: new Map(),
    taken: [],
    chats: null,
    lines: new Map(),
    bytes: new Map(),
    freshChats: new Map(),
  })

  // The projects there are: each folder with a story file, its story and root
  // read, nothing else until it is opened.
  const list = () => {
    listing ??= readList()
    return listing
  }

  /**
   * Read which projects the library holds, and keep those not known yet.
   * With `keep`, the list is read again after another window changed it: a
   * project known already takes its folder, story and root from the disk,
   * and one gone from it is forgotten, but for those in `keep`, which this
   * window has open and which no other window has changed.
   *
   * @param {Set<string>|null} [keep]
   */
  const readList = async (keep = null) => {
    const found = await disk.projects()
    if (keep) libraryTaken.clear()
    for (const name of found.taken) libraryTaken.add(nameKey(name))
    const texts = await disk.read(
      found.projects.flatMap(dir => [under(dir, STORY_FILE), under(dir, FOLDER_FILE)])
    )
    /** @type {Set<string>} */
    const listed = new Set()
    for (const dir of found.projects) {
      /** @type {any} */
      let story
      try {
        story = JSON.parse(texts[under(dir, STORY_FILE)] || '')
      } catch {
        continue
      }
      if (!story || typeof story.id !== 'string' || listed.has(story.id)) continue
      const { schema: written = 0, ...row } = story
      if (written > schema) {
        console.warn(`${dir} was written by a newer inksprite, and is left as it is`)
        continue
      }
      listed.add(row.id)
      const known = projects.get(row.id)
      if (known && (!keep || keep.has(row.id))) continue
      const project = known || newProject(row.id)
      project.dir = dir
      project.story = row
      project.root = readFolderFile(
        texts[under(dir, FOLDER_FILE)] || '',
        { storyId: row.id, parentId: row.id, order: 0 },
        dir,
        title => stemFits(title, dir),
        () => rootIdFor(row.id)
      ).document
      project.root.id = rootIdFor(row.id)
      projects.set(row.id, project)
    }
    if (!keep) return
    for (const [id, project] of projects) {
      if (project.dir && !listed.has(id) && !keep.has(id)) projects.delete(id)
    }
  }

  /**
   * Read a project's folder whole and hand back its documents with their
   * text. The first time, the sketch of it is kept: a document found without
   * an id has its file written again with one, and a project written at an
   * older schema is brought forward and written again. After that the sketch
   * is what the stores' own writes made it, and a read leaves it alone: a
   * read numbers each folder's documents from the top, where the stores may
   * have numbered them otherwise, and the two mixed would put a folder on
   * disk in an order the app does not show.
   *
   * @param {Project} project
   * @returns {Promise<Document[]>}
   */
  const load = async project => {
    const dir = /** @type {string} */ (project.dir)
    const { files, closed } = await disk.walk(dir)
    const paths = files.map(file => file.path)
    const texts = await disk.read(wantedTexts(paths).map(path => under(dir, path)))
    const read = readProject(
      {
        files: paths,
        texts: new Map(
          Object.entries(texts).map(([path, text]) => [path.slice(dir.length + 1), text])
        ),
        name: dir,
      },
      { newId, now: now() }
    )
    if (!read) throw new Error(`${dir} is not a project any more`)
    if (project.loaded) return read.documents
    project.story = read.story
    project.seen = new Map(files.map(file => [file.path, { mtime: file.mtime, size: file.size }]))
    project.taken = [...read.unknown, ...closed]
    project.entries = read.entries
    project.rows = new Map(read.documents.map(document => [document.id, sketch(document)]))
    project.root = project.rows.get(rootIdFor(project.id)) || project.root
    project.loaded = true

    let documents = read.documents
    if (read.schema < schema) documents = await upgrade(project, read.documents, read.schema)
    else if (read.adopted.length > 0) {
      const full = new Map(documents.map(document => [document.id, document]))
      await apply(
        project,
        planProject(project.entries, project.entries, id => full.get(id), read.adopted)
      )
    }
    return documents
  }

  /**
   * Bring a project written at an older schema forward, the way a backup is,
   * and write it all again.
   *
   * @param {Project} project
   * @param {Document[]} documents
   * @param {number} from
   * @returns {Promise<Document[]>}
   */
  const upgrade = async (project, documents, from) => {
    const chats = [...(await readChats(project)).values()]
    /** @type {Message[]} */
    const messages = []
    for (const chat of chats) messages.push(...(await readChatMessages(project, chat.id)))
    const tables = upgradeTables(
      { stories: [project.story], documents, chats, messages },
      from,
      schema
    )
    // Where the writer left it, which v26 took off the story, is not kept: the
    // view is this copy's, and a project the library wrote before then opens
    // on its first document.
    const story = tables.stories?.[0] || project.story
    const upgraded = /** @type {Document[]} */ (tables.documents || documents)
    const full = new Map(upgraded.map(document => [document.id, document]))
    const next = layoutProject(upgraded, rootIdFor(project.id), project.taken)
    /** @type {Op[]} */
    const ops = [
      ...planProject(project.entries, next, id => full.get(id), full.keys()),
      { op: 'write', path: STORY_FILE, text: storyText(story, schema) },
    ]
    for (const chat of tables.chats || []) {
      ops.push({ op: 'write', path: chatPath(chat.id), text: chatText(chat) })
    }
    /** @type {Map<string, Message[]>} */
    const byChat = new Map()
    for (const message of tables.messages || []) {
      if (!byChat.has(message.chatId)) byChat.set(message.chatId, [])
      byChat.get(message.chatId)?.push(message)
    }
    for (const [chatId, held] of byChat) {
      const written = messagesText(inFileOrder(held))
      ops.push({ op: 'write', path: messagesPath(chatId), text: written.text })
      project.lines.set(chatId, written.lines)
    }
    await apply(project, ops)
    project.story = story
    project.entries = next
    project.rows = new Map(upgraded.map(document => [document.id, sketch(document)]))
    project.chats = new Map((tables.chats || []).map(chat => [chat.id, chat]))
    return upgraded
  }

  /** @param {Project} project */
  const ensureLoaded = async project => {
    if (!project.loaded && project.dir) await load(project)
  }

  /**
   * Do a plan in a project's folder, and keep what it did: where files went,
   * how each written one was left, and which were changed elsewhere.
   *
   * @param {Project} project
   * @param {Array<Op | {op: 'write', path: string, bytes: Uint8Array} | {op: 'append', path: string, at: number, text: string}>} planned
   */
  const apply = async (project, planned) => {
    if (planned.length === 0) return
    const dir = /** @type {string} */ (project.dir)
    // What each file is expected to be when its op comes, followed through
    // the plan's own moves: a file moved and then written is expected where
    // it was moved to. One the plan wrote already is not checked again.
    /** @type {Map<string, Seen|'written'>} */
    const expected = new Map(project.seen)
    const follow = (/** @type {string} */ from, /** @type {string|null} */ to) => {
      for (const [path, seen] of [...expected]) {
        if (!atOrBelow(path, from)) continue
        expected.delete(path)
        if (to !== null) expected.set(to + path.slice(from.length), seen)
      }
    }
    const there = (/** @type {string} */ path) =>
      [...expected.keys()].some(seen => atOrBelow(seen, path))
    /** @type {typeof planned} The ops sent, which is what was done */
    const ops = []
    /** @type {LibraryOp[]} */
    const toDo = []
    for (const op of planned) {
      if (op.op === 'move') {
        // A document's pictures move only when there are some to move: their
        // bytes may not have come yet. A directory a document held others in
        // may hold nothing by now, and goes rather than stand in the way.
        if (op.optional && !there(op.from)) {
          toDo.push({ op: 'trash', path: under(dir, op.from) })
          continue
        }
        follow(op.from, op.to)
        toDo.push({ op: 'move', from: under(dir, op.from), to: under(dir, op.to) })
      } else if (op.op === 'trash') {
        follow(op.path, null)
        toDo.push({ op: 'trash', path: under(dir, op.path) })
      } else {
        const was = expected.get(op.path)
        expected.set(op.path, 'written')
        if (op.op === 'append') {
          if (was === 'written') throw new Error(`Written twice in one plan: ${op.path}`)
          toDo.push({ ...op, path: under(dir, op.path), size: was?.size ?? 0 })
        } else if (was === 'written') toDo.push({ ...op, path: under(dir, op.path) })
        else toDo.push({ ...op, path: under(dir, op.path), expect: was ?? null })
      }
      ops.push(op)
    }
    if (toDo.length === 0) return
    let result
    try {
      result = await disk.apply(toDo)
    } catch (error) {
      // Partway through, nothing here can say what the folder holds: it is
      // read again before it is next written.
      project.loaded = false
      throw error
    }
    for (const op of ops) {
      if (op.op === 'move') {
        for (const [path, seen] of [...project.seen]) {
          if (!atOrBelow(path, op.from)) continue
          project.seen.delete(path)
          project.seen.set(op.to + path.slice(op.from.length), seen)
        }
      } else if (op.op === 'trash') {
        for (const path of [...project.seen.keys()]) {
          if (atOrBelow(path, op.path)) project.seen.delete(path)
        }
      } else {
        const seen = result.seen[under(dir, op.path)]
        if (seen) project.seen.set(op.path, seen)
      }
    }
    if (result.conflicts.length > 0) {
      onConflict(result.conflicts.map(path => ({ path, title: titleAt(project, path) })))
    }
  }

  /**
   * The title of the document a file is, or the file's name.
   *
   * @param {Project} project
   * @param {string} path - Below the library
   */
  const titleAt = (project, path) => {
    const own = path.slice(/** @type {string} */ (project.dir).length + 1)
    for (const entry of project.entries.values()) {
      const files = [entry.path, sidecarPath(entry.path), `${entry.path}/${FOLDER_FILE}`]
      if (files.includes(own)) return project.rows.get(entry.id)?.title || own
    }
    return path.slice(path.lastIndexOf('/') + 1)
  }

  /**
   * The project a document is in, of those read.
   *
   * @param {string} id
   * @returns {Project|undefined}
   */
  const projectOfDocument = id => {
    for (const project of projects.values()) if (project.rows.has(id)) return project
    return undefined
  }

  /**
   * A project the library holds or is about to: one not written yet is made
   * when its story and its root have both come.
   *
   * @param {string} storyId
   */
  const projectOf = storyId => {
    let project = projects.get(storyId)
    if (!project) projects.set(storyId, (project = newProject(storyId)))
    return project
  }

  /**
   * The name a project's folder takes from its root's title.
   *
   * @param {string} title
   * @param {string|null} own - The name it has now, which it may keep
   */
  const folderName = (title, own) => {
    if (own) libraryTaken.delete(nameKey(own))
    return claimName(libraryTaken, safeName(title), '')
  }

  /**
   * Write a project for the first time, all of it, through a folder that
   * becomes the project's only once everything is in it. The files go a
   * batch at a time, and a file's bytes are read only when its batch goes.
   *
   * @param {Project} project
   * @param {Document[]} documents
   * @param {Chat[]} chats
   * @param {Message[]} messages
   * @param {Map<string, Blob>} bytes
   * @param {Progress} [progress]
   */
  const writeNew = async (project, documents, chats, messages, bytes, progress = () => {}) => {
    const rootId = rootIdFor(project.id)
    const root = documents.find(document => document.id === rootId)
    const dir = folderName(root?.title || 'Untitled', null)
    const making = `.inksprite-new-${project.id}`
    const full = new Map(documents.map(document => [document.id, document]))
    const entries = layoutProject(documents, rootId)

    /** @type {Array<{path: string, text?: string, blob?: Blob}>} */
    const files = []
    for (const [path, text] of projectFiles(
      /** @type {Story} */ (project.story),
      schema,
      entries,
      id => full.get(id)
    )) {
      files.push({ path, text })
    }
    for (const id of [...entries.keys(), ...pictureKeys(entries)]) {
      const blob = bytes.get(id)
      const path = blob && bytesPath(entries, id)
      if (path) files.push({ path, blob })
    }
    /** @type {Map<string, MessageLines>} */
    const lines = new Map()
    for (const chat of chats) {
      files.push({ path: chatPath(chat.id), text: chatText(chat) })
      const written = messagesText(
        inFileOrder(messages.filter(message => message.chatId === chat.id))
      )
      if (written.lines.ids.length > 0) {
        files.push({ path: messagesPath(chat.id), text: written.text })
      }
      lines.set(chat.id, written.lines)
    }

    // What a write that never finished left behind goes first.
    /** @type {Record<string, Seen>} */
    const seen = {}
    /** @type {LibraryOp[]} */
    let batch = [{ op: 'trash', path: making }]
    let size = 0
    let done = 0
    const send = async () => {
      Object.assign(seen, (await disk.apply(batch)).seen)
      done += batch.filter(op => op.op === 'write').length
      progress(done, files.length)
      batch = []
      size = 0
    }
    for (const { path, text, blob } of files) {
      const data = blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
      batch.push({ op: 'write', path: under(making, path), text, bytes: data, expect: null })
      size += data ? data.length : (text?.length ?? 0)
      if (batch.length >= BATCH_FILES || size >= BATCH_BYTES) await send()
    }
    batch.push({ op: 'move', from: making, to: dir })
    await send()

    project.dir = dir
    project.root = root || null
    project.entries = entries
    project.rows = new Map(documents.map(document => [document.id, sketch(document)]))
    project.seen = new Map(
      Object.entries(seen).map(([path, seen]) => [path.slice(making.length + 1), seen])
    )
    project.taken = []
    project.chats = new Map(chats.map(chat => [chat.id, chat]))
    project.lines = lines
    project.bytes = new Map()
    project.freshChats = new Map()
    project.loaded = true
  }

  /**
   * Write a project not written yet, once both its story and its root are
   * here.
   *
   * @param {Project} project
   */
  const writeIfReady = async project => {
    if (project.dir || !project.story || !project.rows.has(rootIdFor(project.id))) return
    const chats = [...project.freshChats.values()]
    await writeNew(project, [...project.rows.values()], chats, [], project.bytes)
    for (const chat of chats) {
      const held = waiting.get(chat.id)
      if (!held) continue
      waiting.delete(chat.id)
      await writeChatMessages(project, chat.id, held.puts, held.deleted)
    }
  }

  /**
   * Send a project's folder to the trash, and forget it.
   *
   * @param {Project} project
   */
  const trashProject = async project => {
    if (project.dir) {
      // Its narration is made again on asking, and would fill the trash.
      await disk.apply([
        { op: 'delete', path: under(project.dir, `${META}/audio`) },
        { op: 'trash', path: project.dir },
      ])
      libraryTaken.delete(nameKey(project.dir))
    }
    projects.delete(project.id)
  }

  /** @param {Change[]} changes */
  const writeDocuments = async changes => {
    /** @type {Map<Project, Change[]>} */
    const byProject = new Map()
    for (const change of changes) {
      const project =
        change.op === 'put' ? projectOf(change.data.storyId) : projectOfDocument(change.id)
      if (!project) continue
      if (!byProject.has(project)) byProject.set(project, [])
      byProject.get(project)?.push(change)
    }

    for (const [project, own] of byProject) {
      const rootId = rootIdFor(project.id)
      if (!project.dir) {
        // Not written yet: kept whole until it can be.
        for (const change of own) {
          if (change.op === 'put') project.rows.set(change.id, change.data)
          else project.rows.delete(change.id)
        }
        await writeIfReady(project)
        continue
      }
      await ensureLoaded(project)
      if (own.some(change => change.op === 'delete' && change.id === rootId)) {
        await trashProject(project)
        continue
      }

      /** @type {Map<string, Document>} */
      const full = new Map()
      const next = new Map(project.rows)
      for (const change of own) {
        if (change.op === 'put') {
          full.set(change.id, change.data)
          next.set(change.id, change.data)
        } else next.delete(change.id)
      }
      const documentOf = (/** @type {string} */ id) => full.get(id) ?? next.get(id)
      const entries = layoutProject([...next.values()], rootId, project.taken)

      // A project renamed is its folder renamed, before anything in it moves.
      const root = next.get(rootId)
      const was = project.rows.get(rootId)
      if (root && was && root.title !== was.title) {
        const dir = folderName(root.title, project.dir)
        if (dir !== project.dir) {
          await disk.apply([{ op: 'move', from: /** @type {string} */ (project.dir), to: dir }])
          project.dir = dir
        }
      }

      const ops = /** @type {Array<Op | {op: 'write', path: string, bytes: Uint8Array}>} */ (
        planProject(project.entries, entries, documentOf, full.keys())
      )
      for (const [id, blob] of project.bytes) {
        const path = bytesPath(entries, id)
        if (!path) continue
        ops.push({ op: 'write', path, bytes: new Uint8Array(await blob.arrayBuffer()) })
        project.bytes.delete(id)
      }
      await apply(project, ops)
      const gone = own.filter(change => change.op === 'delete').map(change => change.id)
      if (gone.length > 0) {
        const dir = /** @type {string} */ (project.dir)
        await disk.apply(gone.map(id => ({ op: 'delete', path: under(dir, audioDir(id)) })))
        // A linked document's base goes to the trash with it.
        const linked = gone.filter(id => project.rows.get(id)?.drive)
        if (linked.length > 0) {
          await disk.apply(linked.map(id => ({ op: 'trash', path: under(dir, basePath(id)) })))
        }
      }
      project.entries = entries
      project.rows = new Map([...next].map(([id, document]) => [id, sketch(document)]))
      if (root) project.root = sketch(root)
    }
  }

  /** @param {Change[]} changes */
  const writeStories = async changes => {
    for (const change of changes) {
      if (change.op === 'delete') {
        const project = projects.get(change.id)
        if (project) await trashProject(project)
        continue
      }
      const project = projectOf(change.id)
      const story = { ...change.data }
      delete story.version
      if (!project.dir) {
        project.story = story
        await writeIfReady(project)
        continue
      }
      await ensureLoaded(project)
      await apply(project, [{ op: 'write', path: STORY_FILE, text: storyText(story, schema) }])
      project.story = story
    }
  }

  /**
   * A project's chats, read the first time they are asked for.
   *
   * @param {Project} project
   * @returns {Promise<Map<string, Chat>>}
   */
  const readChats = async project => {
    if (project.chats) return project.chats
    await ensureLoaded(project)
    const dir = /** @type {string} */ (project.dir)
    const paths = [...project.seen.keys()].filter(
      path => path.startsWith('.inksprite/chats/') && path.endsWith('.json')
    )
    const texts = await disk.read(paths.map(path => under(dir, path)))
    /** @type {Map<string, Chat>} */
    const chats = new Map()
    for (const text of Object.values(texts)) {
      const chat = readChat(text)
      if (chat) chats.set(chat.id, chat)
    }
    project.chats = chats
    return chats
  }

  /**
   * The project a chat is in, of those whose chats were read.
   *
   * @param {string} chatId
   */
  const projectOfChat = chatId => {
    for (const project of projects.values()) {
      if (project.chats?.has(chatId) || project.freshChats.has(chatId)) return project
    }
    return undefined
  }

  /**
   * The project a chat is in, reading the chats of the projects not read
   * yet when it is in none of those that were.
   *
   * @param {string} chatId
   * @returns {Promise<Project|undefined>}
   */
  const findChat = async chatId => {
    const known = projectOfChat(chatId)
    if (known) return known
    await list()
    for (const project of projects.values()) {
      if (!project.dir || project.chats) continue
      if ((await readChats(project)).has(chatId)) return project
    }
    return undefined
  }

  /**
   * A chat's messages, read from its file, and its lines kept for the next
   * write.
   *
   * @param {Project} project
   * @param {string} chatId
   * @returns {Promise<Message[]>}
   */
  const readChatMessages = async (project, chatId) => {
    const path = messagesPath(chatId)
    if (!project.seen.has(path)) {
      project.lines.set(chatId, { ids: [], created: [], sizes: [] })
      return []
    }
    const texts = await disk.read([under(/** @type {string} */ (project.dir), path)])
    const { messages, lines } = readMessages(
      texts[under(/** @type {string} */ (project.dir), path)] || ''
    )
    project.lines.set(chatId, lines)
    return messages
  }

  /** @param {Change[]} changes */
  const writeChats = async changes => {
    for (const change of changes) {
      if (change.op === 'delete') {
        const project = projectOfChat(change.id)
        if (!project) continue
        project.freshChats.delete(change.id)
        if (!project.dir) continue
        await readChats(project)
        project.chats?.delete(change.id)
        project.lines.delete(change.id)
        await apply(
          project,
          [chatPath(change.id), messagesPath(change.id)]
            .filter(path => project.seen.has(path))
            .map(path => ({ op: 'trash', path }))
        )
        continue
      }
      const chat = { ...change.data }
      delete chat.version
      const project = projectOf(chat.storyId)
      if (!project.dir) {
        project.freshChats.set(chat.id, chat)
        continue
      }
      const chats = await readChats(project)
      await apply(project, [{ op: 'write', path: chatPath(chat.id), text: chatText(chat) }])
      chats.set(chat.id, chat)
      const held = waiting.get(chat.id)
      if (held) {
        waiting.delete(chat.id)
        await writeChatMessages(project, chat.id, held.puts, held.deleted)
      }
    }
  }

  /**
   * Write a chat's messages: from where the change starts when it is at the
   * end, and the file read, changed and written whole when it is not.
   *
   * @param {Project} project
   * @param {string} chatId
   * @param {Message[]} puts
   * @param {string[]} deleted
   */
  const writeChatMessages = async (project, chatId, puts, deleted) => {
    if (!project.lines.has(chatId)) await readChatMessages(project, chatId)
    const path = messagesPath(chatId)
    const plan = planMessages(project.lines.get(chatId) || null, puts, deleted)
    if (!plan) return
    if (plan.op === 'append') {
      try {
        await apply(project, [{ op: 'append', path, at: plan.at, text: plan.text }])
        project.lines.set(chatId, plan.lines)
        return
      } catch {
        // Not the file it was: read it as it is, and write it whole.
        await ensureLoaded(project)
      }
    }
    const held = await readChatMessages(project, chatId)
    const written = messagesText(mergeMessages(held, puts, deleted))
    await apply(project, [{ op: 'write', path, text: written.text }])
    project.lines.set(chatId, written.lines)
  }

  /** @param {Change[]} changes */
  const writeMessages = async changes => {
    /** @type {Map<string, {puts: Message[], deleted: string[]}>} */
    const byChat = new Map()
    for (const change of changes) {
      const chatId = change.op === 'put' ? change.data.chatId : chatOfMessage(change.id)
      if (!chatId) continue
      if (!byChat.has(chatId)) byChat.set(chatId, { puts: [], deleted: [] })
      const own = /** @type {{puts: Message[], deleted: string[]}} */ (byChat.get(chatId))
      if (change.op === 'put') {
        const message = { ...change.data }
        delete message.version
        own.puts.push(message)
      } else own.deleted.push(change.id)
    }
    for (const [chatId, { puts, deleted }] of byChat) {
      const project = projectOfChat(chatId)
      if (!project?.dir || !project.chats?.has(chatId)) {
        // Its chat is still to come in this save, or was never written.
        const held = waiting.get(chatId) || { puts: [], deleted: [] }
        held.puts.push(...puts)
        held.deleted.push(...deleted)
        waiting.set(chatId, held)
        continue
      }
      await writeChatMessages(project, chatId, puts, deleted)
    }
  }

  /**
   * The chat a message is in, of the chats whose messages were read.
   *
   * @param {string} messageId
   */
  const chatOfMessage = messageId => {
    for (const project of projects.values()) {
      for (const [chatId, lines] of project.lines) if (lines.ids.includes(messageId)) return chatId
    }
    return undefined
  }

  /**
   * The bytes of an imported file, or of a text document's picture.
   *
   * @param {Project} project
   * @param {string} id - The file document's, or the picture's key
   * @returns {Promise<Blob|null>}
   */
  const bytesOf = async (project, id) => {
    const waitingBytes = project.bytes.get(id)
    if (waitingBytes) return waitingBytes
    const path = bytesPath(project.entries, id)
    if (!path || project.entries.get(id)?.missing) return null
    const bytes = await disk.readBytes(under(/** @type {string} */ (project.dir), path))
    if (!bytes) return null
    const picture = pictureOfKey(id)
    const mime = picture
      ? project.rows.get(picture.documentId)?.pictures?.[picture.name]?.mime
      : project.rows.get(id)?.mime
    return new Blob([/** @type {BlobPart} */ (bytes)], { type: mime || '' })
  }

  /**
   * The bytes of every imported file and every picture in a project.
   *
   * @param {Project} project
   * @returns {Promise<StoredFile[]>}
   */
  const bytesOfAll = async project => {
    /** @type {StoredFile[]} */
    const files = []
    const ids = [...project.entries.values()]
      .filter(entry => entry.kind === 'file')
      .map(entry => entry.id)
    for (const id of [...ids, ...pictureKeys(project.entries)]) {
      const blob = await bytesOf(project, id)
      if (blob) files.push({ id, storyId: project.id, blob })
    }
    return files
  }

  /** Every project, read whole: what a backup holds. */
  const everything = async () => {
    await list()
    /** @type {Record<string, any[]>} */
    const tables = { stories: [], documents: [], files: [], chats: [], messages: [] }
    for (const project of projects.values()) {
      if (!project.dir) continue
      const documents = await load(project)
      tables.stories.push(project.story)
      tables.documents.push(...documents)
      tables.files.push(...(await bytesOfAll(project)))
      for (const chat of (await readChats(project)).values()) {
        tables.chats.push(chat)
        tables.messages.push(...(await readChatMessages(project, chat.id)))
      }
    }
    return tables
  }

  /**
   * Write rows of a project that is not in the library as a project of its
   * own.
   *
   * @param {import('./index.js').NewProject} rows
   * @param {Progress} [progress]
   */
  const add = async ({ story, documents, files, chats, messages }, progress) => {
    await list()
    const project = newProject(story.id)
    const own = { ...story }
    delete own.version
    project.story = own
    await writeNew(
      project,
      documents,
      chats,
      messages,
      new Map(files.map(file => [file.id, file.blob])),
      progress
    )
    projects.set(story.id, project)
  }

  /**
   * A project's folder below the library, once it has one.
   *
   * @param {string} storyId
   */
  const dirOf = async storyId => {
    await list()
    return projects.get(storyId)?.dir ?? null
  }

  /** @type {Storage} */
  const storage = {
    ...dexieStorage,

    audioKept: () => true,

    audioKeys: (storyId, documentId) =>
      inTurn(async () => {
        const dir = await dirOf(storyId)
        if (!dir) return []
        const names = await disk.list(under(dir, audioDir(documentId)))
        return names.filter(name => name.endsWith('.wav')).map(name => name.slice(0, -4))
      }),

    readAudio: (storyId, documentId, key) =>
      inTurn(async () => {
        const dir = await dirOf(storyId)
        const bytes = dir ? await disk.readBytes(under(dir, audioPath(documentId, key))) : null
        return bytes ? bytes.slice().buffer : null
      }),

    writeAudio: (storyId, documentId, key, audio) =>
      inTurn(async () => {
        const dir = await dirOf(storyId)
        if (!dir) return
        const path = under(dir, audioPath(documentId, key))
        await disk.apply([{ op: 'write', path, bytes: new Uint8Array(audio) }])
      }),

    removeAudio: (storyId, documentId, keys) =>
      inTurn(async () => {
        const dir = await dirOf(storyId)
        if (!dir) return
        const paths = keys ? keys.map(key => audioPath(documentId, key)) : [audioDir(documentId)]
        if (paths.length === 0) return
        await disk.apply(paths.map(path => ({ op: 'delete', path: under(dir, path) })))
      }),

    readBase: (storyId, documentId) =>
      inTurn(async () => {
        const dir = await dirOf(storyId)
        if (!dir) return null
        const path = under(dir, basePath(documentId))
        const text = (await disk.read([path]))[path]
        if (!text) return null
        try {
          return JSON.parse(text)
        } catch {
          return null
        }
      }),

    writeBase: base =>
      inTurn(async () => {
        const dir = await dirOf(base.storyId)
        if (!dir) return
        const text = `${JSON.stringify(base, null, 2)}\n`
        await disk.apply([{ op: 'write', path: under(dir, basePath(base.id)), text }])
      }),

    removeBase: (storyId, documentId) =>
      inTurn(async () => {
        const dir = await dirOf(storyId)
        if (dir) await disk.apply([{ op: 'trash', path: under(dir, basePath(documentId)) }])
      }),

    stories: () =>
      inTurn(async () => {
        await list()
        return [...projects.values()]
          .filter(project => project.dir && project.story)
          .map(project => structuredClone(/** @type {Story} */ (project.story)))
      }),

    reopenProject: storyId =>
      inTurn(async () => {
        await list()
        const project = projects.get(storyId)
        if (!project?.dir) return
        // What was read of its folder goes, to be read again when asked for.
        Object.assign(project, {
          loaded: false,
          rows: new Map(),
          entries: new Map(),
          seen: new Map(),
          taken: [],
          chats: null,
          lines: new Map(),
        })
        // Its folder, record and root as the disk has them now; the others
        // as they were.
        await (listing = readList(new Set([...projects.keys()].filter(id => id !== storyId))))
      }),

    refreshProjects: keep =>
      inTurn(async () => {
        // Never listed, the list is read whole when first asked for.
        if (listing) await (listing = readList(new Set(keep)))
      }),

    story: id =>
      inTurn(async () => {
        await list()
        const story = projects.get(id)?.story
        return story ? structuredClone(story) : undefined
      }),

    documents: storyId =>
      inTurn(async () => {
        await list()
        const project = projects.get(storyId)
        if (!project) return []
        if (!project.dir) return [...project.rows.values()].map(row => structuredClone(row))
        return load(project)
      }),

    roots: storyIds =>
      inTurn(async () => {
        await list()
        return storyIds
          .map(id => projects.get(id)?.root)
          .filter(root => root !== null && root !== undefined)
          .map(root => structuredClone(/** @type {Document} */ (root)))
      }),

    chats: storyId =>
      inTurn(async () => {
        await list()
        const project = projects.get(storyId)
        if (!project) return []
        if (!project.dir) return [...project.freshChats.values()].map(chat => structuredClone(chat))
        return [...(await readChats(project)).values()].map(chat => structuredClone(chat))
      }),

    chat: id =>
      inTurn(async () => {
        const project = await findChat(id)
        const chat = project?.chats?.get(id) || project?.freshChats.get(id)
        return chat ? structuredClone(chat) : undefined
      }),

    messages: chatId =>
      inTurn(async () => {
        const project = await findChat(chatId)
        if (!project?.dir) return []
        return readChatMessages(project, chatId)
      }),

    fileBytes: id =>
      inTurn(async () => {
        const project = projectOfDocument(ownerOf(id))
        return project ? bytesOf(project, id) : null
      }),

    filePath: id =>
      inTurn(async () => {
        const project = projectOfDocument(id)
        if (!project?.dir || project.bytes.has(id) || project.entries.get(id)?.missing) return null
        const entry = project.entries.get(id)
        return entry?.kind === 'file' ? under(project.dir, entry.path) : null
      }),

    documentPath: id =>
      inTurn(async () => {
        const project = [...projects.values()].find(
          known => known.rows.has(id) || known.root?.id === id
        )
        if (!project?.dir) return null
        const entry = project.entries.get(id)
        if (entry) return under(project.dir, entry.path)
        return project.root?.id === id ? project.dir : null
      }),

    projectFiles: storyId =>
      inTurn(async () => {
        await list()
        const project = projects.get(storyId)
        if (!project?.dir) return []
        await ensureLoaded(project)
        return bytesOfAll(project)
      }),

    putFileBytes: (id, storyId, blob) =>
      inTurn(async () => {
        await list()
        const project = projectOf(storyId)
        await ensureLoaded(project)
        // Kept until its document is written, when that is still to come.
        const path = project.dir ? bytesPath(project.entries, id) : null
        if (!path) {
          project.bytes.set(id, blob)
          return
        }
        await apply(project, [
          { op: 'write', path, bytes: new Uint8Array(await blob.arrayBuffer()) },
        ])
        // There now, where the project as it was read had found none: sync
        // fetching them from the server.
        const entry = project.entries.get(id)
        if (entry?.missing) delete entry.missing
      }),

    updateEach: (table, change) =>
      inTurn(async () => {
        await list()
        let changed = 0
        for (const project of projects.values()) {
          if (!project.dir) continue
          const chats = await readChats(project)
          for (const chat of [...chats.values()]) {
            if (table === 'chats') {
              const changes = change(structuredClone(chat))
              if (!changes) continue
              const next = { ...chat, ...changes }
              await apply(project, [{ op: 'write', path: chatPath(chat.id), text: chatText(next) }])
              chats.set(chat.id, next)
              changed++
              continue
            }
            const held = await readChatMessages(project, chat.id)
            /** @type {Message[]} */
            const puts = []
            for (const message of held) {
              const changes = change(structuredClone(message))
              if (changes) puts.push({ ...message, ...changes })
            }
            if (puts.length === 0) continue
            const written = messagesText(mergeMessages(held, puts, []))
            await apply(project, [{ op: 'write', path: messagesPath(chat.id), text: written.text }])
            project.lines.set(chat.id, written.lines)
            changed += puts.length
          }
        }
        return changed
      }),

    addProject: (rows, progress) => inTurn(() => add(rows, progress)),

    removeProject: storyId =>
      inTurn(async () => {
        await list()
        const project = projects.get(storyId)
        if (project) await trashProject(project)
      }),

    write: (table, changes) => {
      if (!PROJECT_TABLES.has(table)) return dexieStorage.write(table, changes)
      return inTurn(async () => {
        await list()
        if (table === 'stories') await writeStories(changes)
        else if (table === 'documents') await writeDocuments(changes)
        else if (table === 'chats') await writeChats(changes)
        else if (table === 'messages') await writeMessages(changes)
        // A file's bytes go with its document, written and trashed with it.
      })
    },

    dump: () =>
      inTurn(async () => {
        const app = await dexieStorage.dump()
        for (const table of PROJECT_TABLES) delete app[table]
        return { ...app, ...(await everything()) }
      }),

    replaceAll: tables =>
      inTurn(async () => {
        await list()
        // The window's own copy of the projects stays as it was: the way back.
        let restored = await dexieStorage.replaceAll(tables, [...PROJECT_TABLES])
        for (const project of [...projects.values()]) await trashProject(project)
        for (const story of tables.stories || []) {
          const of = (/** @type {string} */ name) =>
            (tables[name] || []).filter((/** @type {any} */ row) => row.storyId === story.id)
          const chats = of('chats')
          const chatIds = new Set(chats.map((/** @type {Chat} */ chat) => chat.id))
          const rows = {
            story,
            documents: of('documents'),
            files: of('files'),
            chats,
            messages: (tables.messages || []).filter((/** @type {Message} */ message) =>
              chatIds.has(message.chatId)
            ),
          }
          await add(rows)
          restored +=
            1 + rows.documents.length + rows.files.length + chats.length + rows.messages.length
        }
        return restored
      }),
  }
  return storage
}
