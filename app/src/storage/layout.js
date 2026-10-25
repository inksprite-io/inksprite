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
 *     digests/<id>.json       what explore made of a document or a folder
 *     bases/<id>.json         a linked document's Google Doc as last synced
 *     audio/<id>/<key>.wav    a document's narration, a clip to a block
 *     chats/                  see chats.js
 *     moving/                 where a move puts something out of the way
 *   Manuscript/               an ordered folder
 *     .folder.md
 *     01 - Act 1/
 *       01 - Chapter 1.md
 *   Notes/
 *     Elara.md
 *     .images/                the pictures of the documents beside it
 *       doc_x7Kp…/map.png     Elara.md's own, by its id
 *     Rulebook.pdf            an imported file, as it was imported
 *     .Rulebook.pdf.md        its row and the text read out of it
 *     Wren/                   an imported file that holds others
 *       Wren.png              the file itself, named as its directory is
 *       .Wren.png.md
 *       Description.md        what it holds
 *     tool/                   a repository: its files as they are
 *       .repository.json      every row in it, by path
 *       src/main.js
 * ```
 *
 * A file is named from its title (names.js), with its place first in an
 * ordered folder. A name in use is taken by the first in the order the
 * folder shows, and the rest get `(2)` and on. Nothing internal names a
 * path: ids are in the files, so a document keeps its id however it moves.
 *
 * A text or an imported file that holds others, as an import may make one,
 * is a directory of its name with no `.folder.md`, holding its own file
 * under that name and what it holds beside it. No other name in there has
 * that stem, so its own file is the only one it can be.
 */

import { compareNames } from '@/utils/compareNames.js'
import { PICTURES_DIR } from '@/utils/pictures.js'
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
 * Where what explore made of a document or a folder is kept.
 *
 * @param {string} id - The document's
 */
export const digestPath = id => `${META}/digests/${id}.json`

/**
 * A field of a row kept in a file of its own in the project's folder rather
 * than in its frontmatter: something only the app reads. Its entry has the
 * flag while the file is there. Trashed with the document, and in a backup
 * with the rest of the row.
 *
 * @typedef {Object} RowFile
 * @property {'narration'|'digest'} flag
 * @property {'speakers'|'digest'} field - The row's field it holds
 * @property {(id: string) => string} path
 * @property {(value: any) => boolean} keeps - Whether a value is worth a file:
 *   the row's, or one read back from the file
 */

/** @type {RowFile[]} */
export const ROW_FILES = [
  {
    flag: 'narration',
    field: 'speakers',
    path: narrationPath,
    keeps: value => Array.isArray(value) && value.length > 0,
  },
  {
    flag: 'digest',
    field: 'digest',
    path: digestPath,
    keeps: value =>
      Boolean(value) && typeof value.line === 'string' && typeof value.text === 'string',
  },
]

/** Whether a path is one of the row files, by the folder it is in. @param {string} path */
const isRowFile = path =>
  path.endsWith('.json') && ROW_FILES.some(kept => parentOf(path) === parentOf(kept.path('')))

/**
 * Flag the row files a document has on its entry.
 *
 * @param {Entry} entry
 * @param {Document} document
 */
function flagRowFiles(entry, document) {
  for (const kept of ROW_FILES) if (kept.keeps(document[kept.field])) entry[kept.flag] = true
}

/**
 * Where a linked document's base is kept: a copy of Google's, trashed with
 * the document, and left out of a backup.
 *
 * @param {string} id - The document's
 */
export const basePath = id => `${META}/bases/${id}.json`

/**
 * Where a document's narration audio is kept: made again on asking, so
 * deleted rather than trashed, and left out of a backup.
 *
 * @param {string} id - The document's
 */
export const audioDir = id => `${META}/audio/${id}`

/**
 * One clip of a document's narration.
 *
 * @param {string} id - The document's
 * @param {string} key - What was said, hashed; see `tts/reading.js`
 */
export const audioPath = (id, key) => `${audioDir(id)}/${key}.wav`

/**
 * What a document is on disk.
 *
 * - `root` - The project folder itself; its row is the `.folder.md` at the top
 * - `folder` - A directory with a `.folder.md`
 * - `text` - A markdown file
 * - `file` - An imported file, with its row beside it (`sidecarPath`)
 * - `repository` - A directory with a `.repository.json`
 * - `repoFolder`, `repoFile` - What is in a repository, whose rows its `.repository.json` keeps
 * - `holder` - The directory a text or an imported file holds others in, as a
 *   plan sees it (plan.js); never in a layout, whose entry has it as `dir`
 *
 * @typedef {'root'|'folder'|'text'|'file'|'repository'|'repoFolder'|'repoFile'|'holder'} EntryKind
 */

/**
 * Where a document is.
 *
 * @typedef {Object} Entry
 * @property {string} id
 * @property {EntryKind} kind
 * @property {string} path - Below the project folder: a folder's directory, a document's file; '' for the root
 * @property {string} [dir] - A text or an imported file that holds others: the
 *   directory they are in, which its own file is in too
 * @property {string} [repository] - The id of the repository it is in
 * @property {true} [narration] - It has a narration file
 * @property {true} [digest] - It has a digest file
 * @property {true} [missing] - An imported file whose row is there and whose bytes are not
 * @property {string[]} [pictures] - A text document's own pictures, by name, in
 *   `picturesDir` beside it
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
 * Where a text document's own pictures are: a folder of its id's in the
 * `.images` beside it, as its text refers to them. The same path whatever
 * the document is called, and moved with it when it changes folders.
 *
 * @param {string} path - The document's file
 * @param {string} id - The document's
 */
export const picturesDir = (path, id) => join(parentOf(path), `${PICTURES_DIR}/${id}`)

/**
 * One of a text document's own pictures.
 *
 * @param {string} path - The document's file
 * @param {string} id - The document's
 * @param {string} name - The picture's
 */
export const picturePath = (path, id, name) => `${picturesDir(path, id)}/${name}`

/**
 * Whether a path is in a folder of pictures, which holds no document.
 *
 * @param {string} path
 */
const inPictures = path => path.split('/').includes(PICTURES_DIR)

/**
 * The names of a text document's own pictures, for its entry, or nothing.
 *
 * @param {Document} document
 * @returns {{pictures?: string[]}}
 */
const picturesOf = document => {
  const names = document.type === 'text' ? Object.keys(document.pictures || {}) : []
  return names.length > 0 ? { pictures: names.sort() } : {}
}

/**
 * A folder's children in the order the tree shows them: by place in an
 * ordered folder, by title in any other (as `getChildrenOrdered` has it).
 * What is in the trash comes after them, so that it never takes the name or
 * the number of a document that isn't.
 *
 * @param {Document[]} children
 * @param {boolean} ordered
 * @returns {Document[]}
 */
function shown(children, ordered) {
  const out = children.slice()
  const trashedLast = (/** @type {Document} */ a, /** @type {Document} */ b) =>
    Number(Boolean(a.trashed)) - Number(Boolean(b.trashed))
  if (ordered) return out.sort((a, b) => trashedLast(a, b) || a.order - b.order || byId(a, b))
  return out.sort((a, b) => trashedLast(a, b) || compareNames(a.title, b.title) || byId(a, b))
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
  flagRowFiles(/** @type {Entry} */ (entries.get(rootId)), root)

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

  // Whether a document is in a repository, whose files hold nothing: its
  // list keeps their rows by path.
  const inRepository = (/** @type {Document} */ document) => {
    const seen = new Set()
    for (let at = byIdMap.get(document.parentId); at && !seen.has(at.id); ) {
      if (at.type === 'folder' && at.kind === 'repository') return true
      seen.add(at.id)
      at = byIdMap.get(at.parentId)
    }
    return false
  }
  const holds = (/** @type {Document} */ document) =>
    document.type === 'folder' || !inRepository(document)

  // Where each document is shown: its parent when that holds others and
  // leads up to the root, the root otherwise.
  /** @type {Map<string, boolean>} */
  const reaches = new Map([[rootId, true]])
  const leadsToRoot = (/** @type {string} */ id) => {
    /** @type {string[]} */
    const path = []
    let at = id
    while (!reaches.has(at)) {
      const document = byIdMap.get(at)
      if (!document || path.includes(at) || !holds(document)) {
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
   * @param {Document} folder - Or a document that holds others
   * @param {string} dir
   * @param {string} [repository]
   * @param {string} [own] - In a document's directory, its own file's stem,
   *   which nothing beside it may take
   */
  const visit = (folder, dir, repository, own) => {
    const ordered = folder.ordered === true && !repository
    const kids = shown(children.get(folder.id) || [], ordered)
    const width = prefixWidth(kids.length)
    const names = namesIn(dir)
    kids.forEach((kid, at) => {
      const { stem, extension } = nameOf(kid)
      const placed = ordered ? withPrefix(at + 1, width, stem) : stem
      const kind = kindOf(kid, Boolean(repository))
      if (own !== undefined) names.add(nameKey(`${own}${extension}`))
      /** @type {Entry} */
      let entry
      if (kid.type !== 'folder' && !repository && children.has(kid.id)) {
        const holder = join(dir, claimName(names, placed, ''))
        const name = claimName(namesIn(holder), baseOf(holder), extension)
        entry = { id: kid.id, kind, path: join(holder, name), dir: holder }
      } else {
        entry = { id: kid.id, kind, path: join(dir, claimName(names, placed, extension)) }
      }
      if (repository) entry.repository = repository
      flagRowFiles(entry, kid)
      if (kind === 'text') Object.assign(entry, picturesOf(kid))
      entries.set(kid.id, entry)
      if (kid.type === 'folder')
        visit(kid, entry.path, repository || (kind === 'repository' ? kid.id : undefined))
      else if (entry.dir) visit(kid, entry.dir, undefined, baseOf(entry.dir))
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
    if (isRowFile(path)) return true
    if (inMeta(path)) return false
    if (inRepository(path)) return true
    if (inPictures(path)) return false
    return path.endsWith('.md') || baseOf(path) === REPOSITORY_FILE
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
 * read, is a document under a new id. A directory holding a document of its
 * own name, and no `.folder.md`, is that document, holding the rest. A
 * folder with neither, or a file that is neither markdown nor beside a row,
 * is not read, and is left as it is. What a move had put out of the way
 * when the app stopped comes back at the top of the project.
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
   * A text document from its file.
   *
   * @param {string} dir
   * @param {string} file - Its name, `.md` and all
   * @param {Document} parent
   * @returns {{document: Document, entry: Entry}}
   */
  const readText = (dir, file, parent) => {
    const path = join(dir, file)
    const { rest } = readPrefix(file.slice(0, -3))
    const read = readTextFile(
      texts.get(path) || '',
      { storyId, parentId: parent.id, order: 0 },
      rest,
      title => stemFits(title, rest),
      newId
    )
    const document = keep(read)
    return { document, entry: { id: document.id, kind: 'text', path, ...picturesOf(document) } }
  }

  /**
   * An imported file from the row beside it.
   *
   * @param {string} dir
   * @param {string} target - The file's name, whose row is `.<target>.md`
   * @param {Document} parent
   * @param {Set<string>} present - The files in its directory
   * @returns {{document: Document, entry: Entry}}
   */
  const readFile = (dir, target, parent, present) => {
    const { rest } = readPrefix(target)
    const { stem } = splitExtension(rest)
    const read = readFileSidecar(
      texts.get(join(dir, `.${target}.md`)) || '',
      { storyId, parentId: parent.id, order: 0 },
      stem,
      title => stemFits(title, stem) || stemFits(title, rest),
      newId
    )
    const document = keep(read)
    /** @type {Entry} */
    const entry = { id: document.id, kind: 'file', path: join(dir, target) }
    if (!present.has(target)) entry.missing = true
    return { document, entry }
  }

  /**
   * The file a directory with no `.folder.md` is the document of: the text
   * or the imported file named as it is, if it holds one.
   *
   * @param {string} name - The directory's
   * @param {string[]} inside - The files in it
   * @returns {{text: string}|{target: string}|null}
   */
  const ownFile = (name, inside) => {
    if (inside.includes(`${name}.md`)) return { text: `${name}.md` }
    for (const file of inside) {
      const match = /^\.(.+)\.md$/s.exec(file)
      if (!match || file === FOLDER_FILE) continue
      const target = match[1]
      if (target === name || splitExtension(target).stem === name) return { target }
    }
    return null
  }

  /**
   * Read a folder's children into the documents.
   *
   * @param {string} dir
   * @param {Document} parent - A folder, or a document that holds others
   * @param {number} [after] - Places taken in the parent already
   * @param {Set<string>} [own] - In a document's directory, its own files
   */
  const readChildren = (dir, parent, after = 0, own = new Set()) => {
    const here = contents.get(dir) || { files: [], dirs: [] }
    const ordered = parent.ordered === true
    const files = here.files.filter(file => !own.has(file))
    const present = new Set(here.files)

    /** @type {Array<{sortName: string, place: number|null, read: () => {document: Document, entry: Entry}|null, then?: (document: Document) => void}>} */
    const found = []
    const sidecarOf = new Set()
    for (const file of files) {
      const match = /^\.(.+)\.md$/s.exec(file)
      if (!match || file === FOLDER_FILE) continue
      const target = match[1]
      sidecarOf.add(target)
      const { place, rest } = readPrefix(target)
      found.push({ sortName: rest, place, read: () => readFile(dir, target, parent, present) })
    }
    for (const file of files) {
      if (file.startsWith('.') || sidecarOf.has(file)) continue
      if (!file.endsWith('.md')) {
        unknown.push(join(dir, file))
        continue
      }
      const { place, rest } = readPrefix(file.slice(0, -3))
      found.push({ sortName: rest, place, read: () => readText(dir, file, parent) })
    }
    for (const sub of here.dirs) {
      if (dir === '' && sub === META) continue
      // The pictures of the documents beside it, which are read as they are shown.
      if (sub === PICTURES_DIR) continue
      const path = join(dir, sub)
      const inside = contents.get(path)?.files || []
      const { place, rest } = readPrefix(sub)
      const holder = inside.includes(FOLDER_FILE) ? null : ownFile(sub, inside)
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
      } else if (holder && 'text' in holder) {
        const { text } = holder
        found.push({
          sortName: rest,
          place,
          read: () => {
            const { document, entry } = readText(path, text, parent)
            return { document, entry: { ...entry, dir: path } }
          },
          then: document => readChildren(path, document, 0, new Set([text])),
        })
      } else if (holder && 'target' in holder) {
        const { target } = holder
        found.push({
          sortName: rest,
          place,
          read: () => {
            const { document, entry } = readFile(path, target, parent, new Set(inside))
            return { document, entry: { ...entry, dir: path } }
          },
          then: document => readChildren(path, document, 0, new Set([target, `.${target}.md`])),
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
            compareNames(a.item.sortName, b.item.sortName)
        )
      : read.sort(
          (a, b) =>
            compareNames(a.result.document.title, b.result.document.title) ||
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
    for (const kept of ROW_FILES) {
      const text = texts.get(kept.path(document.id))
      if (text === undefined) continue
      try {
        const value = JSON.parse(text)
        if (!kept.keeps(value)) continue
        document[kept.field] = value
        const entry = entries.get(document.id)
        if (entry) entry[kept.flag] = true
      } catch {
        // A file that cannot be read holds nothing.
      }
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
