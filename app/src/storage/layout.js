/**
 * A project as a folder: where each document goes, and the documents a
 * folder holds.
 *
 * ```
 * My Novel/
 *   .folder.md                the root: id, title, summary
 *   .inksprite/
 *     story.json              the project's own row, and the schema it is in
 *     narration/<id>.json     who speaks which block of a document
 *     chats/                  see chats.js
 *     moving/                 where a move puts something out of the way
 *   Manuscript/               an ordered folder
 *     .folder.md
 *     01 - Act 1/
 *       01 - Chapter 1.md
 *   Notes/
 *     Elara.md
 *     Rulebook.pdf            an imported file, as it was imported
 *     .Rulebook.pdf.md        its row and the text read out of it
 *     tool/                   a repository: its files as they are
 *       .repository.json      every row in it, by path
 *       src/main.js
 * ```
 *
 * A file is named from its title (names.js), with its place first in an
 * ordered folder. A name in use is taken by the first in the order the
 * folder shows, and the rest get `(2)` and on. Nothing internal names a
 * path: ids are in the files, so a document keeps its id however it moves.
 */

import { filenameFor } from '@/files/download.js'
import {
  safeName,
  nameKey,
  splitExtension,
  claimName,
  prefixWidth,
  withPrefix,
  readPrefix,
  stemFits,
} from './names.js'
import {
  FOLDER_FILE,
  REPOSITORY_FILE,
  sidecarPath,
  readTextFile,
  readFolderFile,
  readFileSidecar,
  readRepositoryFile,
} from './documents.js'

/** @typedef {import('../types/models.js').Document} Document */
/** @typedef {import('../types/models.js').Story} Story */

/** The project's own folder, beside its documents. */
export const META = '.inksprite'

/** The project's row. */
export const STORY_FILE = `${META}/story.json`

/** Where a move puts what stands in its way, until it can go where it goes. */
export const MOVING = `${META}/moving`

/** @param {string} id */
export const narrationPath = id => `${META}/narration/${id}.json`

/**
 * What a document is on disk.
 *
 * - `root` - The project folder itself; its row is the `.folder.md` at the top
 * - `folder` - A directory with a `.folder.md`
 * - `text` - A markdown file
 * - `file` - An imported file, with its row beside it (`sidecarPath`)
 * - `repository` - A directory with a `.repository.json`
 * - `repoFolder`, `repoFile` - What is in a repository, whose rows its `.repository.json` keeps
 *
 * @typedef {'root'|'folder'|'text'|'file'|'repository'|'repoFolder'|'repoFile'} EntryKind
 */

/**
 * Where a document is.
 *
 * @typedef {Object} Entry
 * @property {string} id
 * @property {EntryKind} kind
 * @property {string} path - Below the project folder: a folder's directory, a document's file; '' for the root
 * @property {string} [repository] - The id of the repository it is in
 * @property {true} [narration] - It has a narration file
 * @property {true} [missing] - An imported file whose row is there and whose bytes are not
 */

/** @param {string} dir @param {string} name */
const join = (dir, name) => (dir ? `${dir}/${name}` : name)

/** @param {string} path */
const parentOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** @param {string} path */
const baseOf = path => path.slice(path.lastIndexOf('/') + 1)

/** @param {Document} a @param {Document} b */
const byId = (a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0)

/**
 * A folder's children in the order the tree shows them: by place in an
 * ordered folder, by title in any other (as `getChildrenOrdered` has it).
 *
 * @param {Document[]} children
 * @param {boolean} ordered
 * @returns {Document[]}
 */
function shown(children, ordered) {
  const out = children.slice()
  if (ordered) return out.sort((a, b) => a.order - b.order || byId(a, b))
  return out.sort((a, b) => a.title.localeCompare(b.title) || byId(a, b))
}

/**
 * The name a document's file or folder takes, before any prefix or `(2)`.
 *
 * @param {Document} document
 * @returns {{stem: string, extension: string}}
 */
function nameOf(document) {
  if (document.type === 'folder') return { stem: safeName(document.title), extension: '' }
  if (document.type === 'file') return splitExtension(safeName(filenameFor(document)))
  return { stem: safeName(document.title), extension: '.md' }
}

/**
 * What a document is on disk.
 *
 * @param {Document} document
 * @param {boolean} inRepository
 * @returns {EntryKind}
 */
function kindOf(document, inRepository) {
  if (inRepository) return document.type === 'folder' ? 'repoFolder' : 'repoFile'
  if (document.type === 'folder') return document.kind === 'repository' ? 'repository' : 'folder'
  return document.type === 'file' ? 'file' : 'text'
}

/**
 * Where every document of a project goes.
 *
 * A document whose folder is not in the project, or is below itself, goes
 * at the top: it would otherwise not be written at all.
 *
 * @param {Document[]} documents - The project's, its root among them
 * @param {string} rootId
 * @param {Iterable<string>} [taken] - Paths in use by what is not a document, which no name takes
 * @returns {Map<string, Entry>}
 */
export function layoutProject(documents, rootId, taken = []) {
  /** @type {Map<string, Document>} */
  const byIdMap = new Map(documents.map(document => [document.id, document]))
  const root = byIdMap.get(rootId)
  /** @type {Map<string, Entry>} */
  const entries = new Map([[rootId, { id: rootId, kind: 'root', path: '' }]])
  if (!root) return entries

  /** @type {Map<string, Set<string>>} Names in use, by the key of their folder's path */
  const takenIn = new Map()
  const namesIn = (/** @type {string} */ dir) => {
    const key = nameKey(dir)
    let names = takenIn.get(key)
    if (!names) takenIn.set(key, (names = new Set()))
    return names
  }
  for (const path of taken) namesIn(parentOf(path)).add(nameKey(baseOf(path)))
  namesIn('').add(nameKey(META))

  // Where each document is shown: its parent when that is a folder that
  // leads up to the root, the root otherwise.
  /** @type {Map<string, boolean>} */
  const reaches = new Map([[rootId, true]])
  const leadsToRoot = (/** @type {string} */ id) => {
    /** @type {string[]} */
    const path = []
    let at = id
    while (!reaches.has(at)) {
      const document = byIdMap.get(at)
      if (!document || document.type !== 'folder' || path.includes(at)) {
        for (const seen of path) reaches.set(seen, false)
        return false
      }
      path.push(at)
      at = document.parentId
    }
    const result = /** @type {boolean} */ (reaches.get(at))
    for (const seen of path) reaches.set(seen, result)
    return result
  }
  /** @type {Map<string, Document[]>} */
  const children = new Map()
  for (const document of documents) {
    if (document.id === rootId) continue
    const parentId = leadsToRoot(document.parentId) ? document.parentId : rootId
    if (!children.has(parentId)) children.set(parentId, [])
    children.get(parentId)?.push(document)
  }

  /**
   * @param {Document} folder
   * @param {string} dir
   * @param {string} [repository]
   */
  const visit = (folder, dir, repository) => {
    const ordered = folder.ordered === true && !repository
    const kids = shown(children.get(folder.id) || [], ordered)
    const width = prefixWidth(kids.length)
    const names = namesIn(dir)
    kids.forEach((kid, at) => {
      const { stem, extension } = nameOf(kid)
      const name = claimName(names, ordered ? withPrefix(at + 1, width, stem) : stem, extension)
      const path = join(dir, name)
      const kind = kindOf(kid, Boolean(repository))
      /** @type {Entry} */
      const entry = { id: kid.id, kind, path }
      if (repository) entry.repository = repository
      if (kid.speakers?.length) entry.narration = true
      entries.set(kid.id, entry)
      if (kid.type === 'folder')
        visit(kid, path, repository || (kind === 'repository' ? kid.id : undefined))
    })
  }
  visit(root, '')
  return entries
}

/**
 * The files of a project's folder whose text a read needs: every markdown
 * file, the project's own files, and everything in a repository. Not the
 * bytes of imported files, which are read when something opens one, and not
 * the chats, which are read a chat at a time.
 *
 * @param {string[]} files - Every file below the project folder
 * @returns {string[]}
 */
export function wantedTexts(files) {
  const repositories = files
    .filter(path => baseOf(path) === REPOSITORY_FILE && !inMeta(path))
    .map(parentOf)
  const inRepository = (/** @type {string} */ path) =>
    repositories.some(dir => dir === '' || path.startsWith(`${dir}/`))
  return files.filter(path => {
    if (path === STORY_FILE) return true
    if (path.startsWith(`${META}/narration/`)) return path.endsWith('.json')
    if (inMeta(path)) return false
    return path.endsWith('.md') || baseOf(path) === REPOSITORY_FILE || inRepository(path)
  })
}

/**
 * In the project's own folder, and not something a move left there.
 *
 * @param {string} path
 */
const inMeta = path =>
  (path === META || path.startsWith(`${META}/`)) && !path.startsWith(`${MOVING}/`)

/**
 * A project read back from its folder.
 *
 * @typedef {Object} ReadProject
 * @property {Story} story
 * @property {number} schema - The schema version its rows are in
 * @property {Document[]} documents
 * @property {Map<string, Entry>} entries - Where each one was found
 * @property {string[]} adopted - Ids given to files that had none, whose files want writing
 * @property {string[]} unknown - Files that are no document: neither read nor ever written over
 */

/**
 * The documents a project's folder holds.
 *
 * Its files are taken as they are, edits made elsewhere and all. A file
 * renamed somewhere else is that title now. In an ordered folder the order
 * is the order of the prefixes, numbered again from the top; in any other,
 * the order of the titles. A file with no id, or frontmatter that cannot be
 * read, is a document under a new id. A folder with no `.folder.md`, or a
 * file that is neither markdown nor beside a row, is not read, and is left
 * as it is. What a move had put out of the way when the app stopped comes
 * back at the top of the project.
 *
 * @param {Object} found
 * @param {string[]} found.files - Every file below the project folder
 * @param {Map<string, string>} found.texts - The text of each file `wantedTexts` named
 * @param {string} found.name - The project folder's own name
 * @param {Object} make
 * @param {() => string} make.newId - An id for a document that has none
 * @param {number} make.now - When a document given an id is made
 * @returns {ReadProject|null} Null when the folder holds no project
 */
export function readProject({ files, texts, name }, { newId, now }) {
  /** @type {any} */
  let story
  try {
    story = JSON.parse(texts.get(STORY_FILE) || '')
  } catch {
    return null
  }
  if (!story || typeof story.id !== 'string') return null
  const { schema, ...storyRow } = story
  const storyId = storyRow.id
  const rootId = `root_${storyId}`

  /** @type {Map<string, {files: string[], dirs: string[]}>} */
  const contents = new Map()
  const dirOf = (/** @type {string} */ dir) => {
    let found = contents.get(dir)
    if (!found) contents.set(dir, (found = { files: [], dirs: [] }))
    return found
  }
  for (const path of files) {
    dirOf(parentOf(path)).files.push(baseOf(path))
    for (let dir = parentOf(path); dir; dir = parentOf(dir)) {
      const above = dirOf(parentOf(dir))
      if (above.dirs.includes(baseOf(dir))) break
      above.dirs.push(baseOf(dir))
    }
  }

  /** @type {Document[]} */
  const documents = []
  /** @type {Map<string, Entry>} */
  const entries = new Map()
  /** @type {string[]} */
  const adopted = []
  /** @type {string[]} */
  const unknown = []
  const ids = new Set()

  /** @param {{document: Document, adopted: boolean}} read */
  const keep = read => {
    let { document } = read
    if (ids.has(document.id)) {
      // Two files with one id, a copy made somewhere else: the second is a document of its own.
      document = { ...document, id: newId() }
      read = { document, adopted: true }
    }
    if (read.adopted) {
      adopted.push(document.id)
      if (!document.created) document.created = now
      if (!document.updated) document.updated = now
    }
    ids.add(document.id)
    documents.push(document)
    return document
  }

  const everythingBelow = (/** @type {string} */ dir) =>
    files.filter(path => path.startsWith(`${dir}/`))

  /**
   * Read a folder's children into the documents.
   *
   * @param {string} dir
   * @param {Document} parent
   * @param {number} [after] - Places taken in the parent already
   */
  const readChildren = (dir, parent, after = 0) => {
    const here = contents.get(dir) || { files: [], dirs: [] }
    const ordered = parent.ordered === true
    const present = new Set(here.files)

    /** @type {Array<{sortName: string, place: number|null, read: () => {document: Document, entry: Entry}|null, then?: (document: Document) => void}>} */
    const found = []
    const sidecarOf = new Set()
    for (const file of here.files) {
      const match = /^\.(.+)\.md$/s.exec(file)
      if (!match || file === FOLDER_FILE) continue
      const target = match[1]
      sidecarOf.add(target)
      const { place, rest } = readPrefix(target)
      const path = join(dir, target)
      found.push({
        sortName: rest,
        place,
        read: () => {
          const { stem } = splitExtension(rest)
          const read = readFileSidecar(
            texts.get(join(dir, file)) || '',
            { storyId, parentId: parent.id, order: 0 },
            stem,
            title => stemFits(title, stem) || stemFits(title, rest),
            newId
          )
          const document = keep(read)
          /** @type {Entry} */
          const entry = { id: document.id, kind: 'file', path }
          if (!present.has(target)) entry.missing = true
          return { document, entry }
        },
      })
    }
    for (const file of here.files) {
      if (file.startsWith('.') || sidecarOf.has(file)) continue
      const path = join(dir, file)
      if (!file.endsWith('.md')) {
        unknown.push(path)
        continue
      }
      const { place, rest } = readPrefix(file.slice(0, -3))
      found.push({
        sortName: rest,
        place,
        read: () => {
          const read = readTextFile(
            texts.get(path) || '',
            { storyId, parentId: parent.id, order: 0 },
            rest,
            title => stemFits(title, rest),
            newId
          )
          const document = keep(read)
          return { document, entry: { id: document.id, kind: 'text', path } }
        },
      })
    }
    for (const sub of here.dirs) {
      if (dir === '' && sub === META) continue
      const path = join(dir, sub)
      const inside = contents.get(path)?.files || []
      const { place, rest } = readPrefix(sub)
      if (inside.includes(REPOSITORY_FILE)) {
        found.push({
          sortName: rest,
          place,
          read: () => readRepository(path, parent, rest),
        })
      } else if (inside.includes(FOLDER_FILE)) {
        found.push({
          sortName: rest,
          place,
          read: () => {
            const read = readFolderFile(
              texts.get(join(path, FOLDER_FILE)) || '',
              { storyId, parentId: parent.id, order: 0 },
              rest,
              title => stemFits(title, rest),
              newId
            )
            const document = keep(read)
            return { document, entry: { id: document.id, kind: 'folder', path } }
          },
          then: document => readChildren(path, document),
        })
      } else {
        unknown.push(...everythingBelow(path))
      }
    }

    const read = found
      .map(item => ({ item, result: item.read() }))
      .filter(({ result }) => result !== null)
    // In an ordered folder the prefixes say the order; in any other the titles do.
    const sorted = ordered
      ? read.sort(
          (a, b) =>
            (a.item.place ?? Infinity) - (b.item.place ?? Infinity) ||
            a.item.sortName.localeCompare(b.item.sortName)
        )
      : read.sort(
          (a, b) =>
            a.result.document.title.localeCompare(b.result.document.title) ||
            byId(a.result.document, b.result.document)
        )
    sorted.forEach(({ result }, at) => {
      result.document.order = after + at
      entries.set(result.document.id, result.entry)
    })
    for (const { item, result } of sorted) item.then?.(result.document)
    return sorted.length
  }

  /**
   * A repository, from its `.repository.json` and its files.
   *
   * @param {string} path
   * @param {Document} parent
   * @param {string} folderName
   * @returns {{document: Document, entry: Entry}|null}
   */
  const readRepository = (path, parent, folderName) => {
    const rows = readRepositoryFile(
      texts.get(join(path, REPOSITORY_FILE)) || '',
      { storyId, parentId: parent.id, order: 0 },
      below => texts.get(join(path, below))
    )
    if (!rows) {
      unknown.push(...everythingBelow(path))
      return null
    }
    const [{ document: repository }, ...below] = rows
    if (typeof repository.title !== 'string' || !stemFits(repository.title, folderName)) {
      repository.title = folderName
    }
    keep({ document: repository, adopted: false })
    const listed = new Set([join(path, REPOSITORY_FILE)])
    for (const { path: at, document } of below) {
      const full = join(path, at)
      listed.add(full)
      keep({ document, adopted: false })
      entries.set(document.id, {
        id: document.id,
        kind: document.type === 'folder' ? 'repoFolder' : 'repoFile',
        path: full,
        repository: repository.id,
      })
    }
    unknown.push(...everythingBelow(path).filter(file => !listed.has(file)))
    return { document: repository, entry: { id: repository.id, kind: 'repository', path } }
  }

  const rootRead = readFolderFile(
    texts.get(FOLDER_FILE) || '',
    { storyId, parentId: storyId, order: 0 },
    name,
    title => stemFits(title, name),
    () => rootId
  )
  const root = keep({ document: { ...rootRead.document, id: rootId }, adopted: rootRead.adopted })
  entries.set(rootId, { id: rootId, kind: 'root', path: '' })
  let places = readChildren('', root)
  for (const sub of contents.get(MOVING)?.dirs || []) {
    places += readChildren(join(MOVING, sub), root, places)
  }

  for (const document of documents) {
    const text = texts.get(narrationPath(document.id))
    if (text === undefined) continue
    try {
      const speakers = JSON.parse(text)
      if (Array.isArray(speakers) && speakers.length > 0) {
        document.speakers = speakers
        const entry = entries.get(document.id)
        if (entry) entry.narration = true
      }
    } catch {
      // A narration file that cannot be read is no narration.
    }
  }

  return {
    story: /** @type {Story} */ (storyRow),
    schema: typeof schema === 'number' ? schema : 0,
    documents,
    entries,
    adopted,
    unknown,
  }
}

export { sidecarPath, FOLDER_FILE, REPOSITORY_FILE }
