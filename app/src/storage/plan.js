/**
 * What to do to a project's folder: the files a project is, and the moves,
 * trashes and writes that take its folder from one layout to the next.
 *
 * A change of rows is a change of layout (layout.js), and the difference
 * between the two is the plan. A document whose path changed is moved,
 * folders whole, so a renamed folder is one rename however much is in it.
 * One that is gone goes to the trash, a folder whole unless something kept
 * is still in it. One that is new or changed is written. Nothing is written
 * that did not change, and nothing is ever deleted outright.
 *
 * A move whose way is blocked, by something itself still to move (two
 * documents trading names) or by something on its way out, first moves what
 * is there out of the way, into `.inksprite/moving/`, and on from there.
 */

import { nameKey } from './names.js'
import {
  FOLDER_FILE,
  REPOSITORY_FILE,
  textFile,
  folderFile,
  fileSidecar,
  repositoryFile,
  sidecarPath,
} from './documents.js'
import { MOVING, STORY_FILE, narrationPath } from './layout.js'

/** @typedef {import('../types/models.js').Document} Document */
/** @typedef {import('../types/models.js').Story} Story */
/** @typedef {import('./layout.js').Entry} Entry */
/** @typedef {import('./layout.js').EntryKind} EntryKind */

/**
 * One thing to do to the folder. Paths are below the project folder.
 *
 * - `move` - A file or a folder, with all that is in it, to where nothing is
 * - `trash` - A file or a folder to the system's trash
 * - `write` - A file's whole text, made whole or not at all
 *
 * @typedef {{op: 'move', from: string, to: string}
 *   | {op: 'trash', path: string}
 *   | {op: 'write', path: string, text: string}} Op
 */

/** @param {string} dir @param {string} name */
const join = (dir, name) => (dir ? `${dir}/${name}` : name)

/** @param {string} path */
const baseOf = path => path.slice(path.lastIndexOf('/') + 1)

/** @param {string} path */
const depthOf = path => (path ? path.split('/').length : 0)

/** @param {string} path @param {string} dir */
const isBelow = (path, dir) => (dir === '' ? path !== '' : path.startsWith(`${dir}/`))

/** @param {EntryKind} kind */
const isFolder = kind =>
  kind === 'root' || kind === 'folder' || kind === 'repository' || kind === 'repoFolder'

/**
 * The files an entry is, less a repository's own file, which is made from
 * all that is in it (`repositoryText`), and an imported file's bytes, which
 * are written when they come.
 *
 * @param {Entry} entry
 * @param {Document} document
 * @returns {Array<{path: string, text: string}>}
 */
function filesOf(entry, document) {
  switch (entry.kind) {
    case 'root':
    case 'folder':
      return [{ path: join(entry.path, FOLDER_FILE), text: folderFile(document) }]
    case 'text':
      return [{ path: entry.path, text: textFile(document) }]
    case 'file':
      return [{ path: sidecarPath(entry.path), text: fileSidecar(document) }]
    case 'repoFile':
      return [{ path: entry.path, text: document.content }]
    default:
      return []
  }
}

/**
 * A repository's `.repository.json`, from where everything in it is.
 *
 * @param {Entry} repository
 * @param {Map<string, Entry>} entries
 * @param {(id: string) => Document|undefined} documentOf
 * @returns {{path: string, text: string}}
 */
function repositoryText(repository, entries, documentOf) {
  /** @type {Array<{path: string, document: Document}>} */
  const below = []
  for (const entry of entries.values()) {
    if (entry.repository !== repository.id) continue
    const document = documentOf(entry.id)
    if (document) below.push({ path: entry.path.slice(repository.path.length + 1), document })
  }
  const own = /** @type {Document} */ (documentOf(repository.id))
  return { path: join(repository.path, REPOSITORY_FILE), text: repositoryFile(own, below) }
}

/**
 * A narration file's text.
 *
 * @param {Document} document
 */
const narrationText = document => `${JSON.stringify(document.speakers)}\n`

/**
 * Every file of a project but its chats and the bytes of its imported files:
 * what writing it into an empty folder writes.
 *
 * @param {Story} story
 * @param {number} schema - The schema version its rows are in
 * @param {Map<string, Entry>} entries - Its layout
 * @param {(id: string) => Document|undefined} documentOf
 * @returns {Map<string, string>} Text by path below the project folder
 */
export function projectFiles(story, schema, entries, documentOf) {
  /** @type {Map<string, string>} */
  const files = new Map([[STORY_FILE, storyText(story, schema)]])
  for (const entry of entries.values()) {
    const document = documentOf(entry.id)
    if (!document) continue
    for (const { path, text } of filesOf(entry, document)) files.set(path, text)
    if (entry.kind === 'repository') {
      const { path, text } = repositoryText(entry, entries, documentOf)
      files.set(path, text)
    }
    if (entry.narration) files.set(narrationPath(entry.id), narrationText(document))
  }
  return files
}

/**
 * The project's own file: its row, and the schema the rows are in.
 *
 * @param {Story} story
 * @param {number} schema
 * @returns {string}
 */
export function storyText(story, schema) {
  return `${JSON.stringify({ ...story, schema }, null, 2)}\n`
}

/**
 * What takes a project's folder from one layout to the next.
 *
 * Moves first, folders before what is in them, then the trash, then the
 * writes. `changed` names the documents whose rows changed; one whose path
 * changed and nothing else is only moved, and one that is new is written
 * whether named or not.
 *
 * @param {Map<string, Entry>} previous - The layout the folder is in
 * @param {Map<string, Entry>} next - The layout it is to be in
 * @param {(id: string) => Document|undefined} documentOf - The rows, as they are to be
 * @param {Iterable<string>} changed
 * @returns {Op[]}
 */
export function planProject(previous, next, documentOf, changed) {
  /** @type {Op[]} */
  const ops = []
  const changedIds = new Set(changed)

  // The same document in the same kind of place; anything else is one gone
  // and one come.
  const kept = (/** @type {string} */ id) =>
    previous.has(id) && next.get(id)?.kind === previous.get(id)?.kind

  // Where everything on disk is now, as the moves go.
  /** @type {Map<string, string>} */
  const at = new Map()
  for (const [id, entry] of previous) at.set(id, entry.path)

  const occupant = (/** @type {string} */ path) => {
    const key = nameKey(path)
    for (const [id, where] of at) if (nameKey(where) === key) return id
    return null
  }

  const move = (/** @type {string} */ id, /** @type {string} */ to) => {
    const from = /** @type {string} */ (at.get(id))
    const entry = /** @type {Entry} */ (previous.get(id))
    if (!entry.missing) ops.push({ op: 'move', from, to })
    if (entry.kind === 'file') {
      ops.push({ op: 'move', from: sidecarPath(from), to: sidecarPath(to) })
    }
    for (const [other, where] of at) {
      if (where === from) at.set(other, to)
      else if (isBelow(where, from)) at.set(other, to + where.slice(from.length))
    }
  }

  const outOfTheWay = (/** @type {string} */ id) =>
    move(id, `${MOVING}/${id}/${baseOf(/** @type {string} */ (at.get(id)))}`)

  // Whatever stands where this entry is going, or where a folder it is going
  // into is to be, and is not that folder, moves out of the way.
  const clearWay = (/** @type {Entry} */ entry) => {
    const parts = entry.path.split('/')
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join('/')
      const there = occupant(path)
      if (!there || there === entry.id) continue
      const belongs = next.get(there)
      if (depth < parts.length && belongs?.path === path && isFolder(belongs.kind)) continue
      outOfTheWay(there)
    }
  }

  const movers = [...next.values()]
    .filter(entry => entry.kind !== 'root' && kept(entry.id))
    .filter(entry => previous.get(entry.id)?.path !== entry.path)
    .sort((a, b) => depthOf(a.path) - depthOf(b.path) || (a.path < b.path ? -1 : 1))
  for (const entry of movers) {
    if (at.get(entry.id) === entry.path) continue
    // A folder going into what it is in now goes out of the way first.
    if (isBelow(entry.path, /** @type {string} */ (at.get(entry.id)))) outOfTheWay(entry.id)
    clearWay(entry)
    if (at.get(entry.id) !== entry.path) move(entry.id, entry.path)
  }

  // The trash: a folder whole when nothing kept is in it, its own file and
  // what of it is gone when something is.
  const gone = [...previous.values()]
    .filter(entry => !kept(entry.id))
    .sort(
      (a, b) =>
        depthOf(/** @type {string} */ (at.get(a.id))) -
        depthOf(/** @type {string} */ (at.get(b.id)))
    )
  const keptPaths = [...next.values()].filter(entry => kept(entry.id)).map(entry => entry.path)
  /** @type {string[]} */
  const trashed = []
  for (const entry of gone) {
    const path = /** @type {string} */ (at.get(entry.id))
    if (entry.narration) ops.push({ op: 'trash', path: narrationPath(entry.id) })
    if (trashed.some(dir => path === dir || isBelow(path, dir))) continue
    if (isFolder(entry.kind)) {
      if (!keptPaths.some(kept => kept === path || isBelow(kept, path))) {
        ops.push({ op: 'trash', path })
        trashed.push(path)
      } else if (entry.kind === 'folder') {
        ops.push({ op: 'trash', path: join(path, FOLDER_FILE) })
      } else if (entry.kind === 'repository') {
        ops.push({ op: 'trash', path: join(path, REPOSITORY_FILE) })
      }
      continue
    }
    if (!entry.missing) ops.push({ op: 'trash', path })
    if (entry.kind === 'file') ops.push({ op: 'trash', path: sidecarPath(path) })
  }

  // The writes, and every repository something in it changed in.
  /** @type {Set<string>} */
  const repositories = new Set()
  for (const entry of gone) if (entry.repository) repositories.add(entry.repository)
  for (const entry of next.values()) {
    const fresh = !kept(entry.id)
    const touched = fresh || changedIds.has(entry.id)
    if (entry.repository && touched) repositories.add(entry.repository)
    if (entry.kind === 'repository' && touched) repositories.add(entry.id)
    const document = documentOf(entry.id)
    if (!document) continue
    if (touched) {
      for (const { path, text } of filesOf(entry, document)) ops.push({ op: 'write', path, text })
    }
    if (entry.narration && touched) {
      ops.push({ op: 'write', path: narrationPath(entry.id), text: narrationText(document) })
    } else if (!entry.narration && !fresh && previous.get(entry.id)?.narration) {
      ops.push({ op: 'trash', path: narrationPath(entry.id) })
    }
  }
  for (const id of repositories) {
    const repository = next.get(id)
    if (repository?.kind !== 'repository' || !documentOf(id)) continue
    const { path, text } = repositoryText(repository, next, documentOf)
    ops.push({ op: 'write', path, text })
  }

  return ops
}
