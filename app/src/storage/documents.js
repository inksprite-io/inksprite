/**
 * A document as a file, and back.
 *
 * A text document is a markdown file, its row in frontmatter and its content
 * as the body. A folder's row is its `.folder.md`, the summary as the body.
 * An imported file is itself, with a hidden markdown file beside it carrying
 * its row and the text read out of it. A repository keeps its own row and
 * the rows of everything in it in one `.repository.json` inside it; its files
 * are their text.
 *
 * The frontmatter is the row, less what the file already says (the body,
 * where the file is, what kind of file it is) and what is worked out (the
 * word count, the version). Whatever else a row holds goes in as it is, so a
 * field added to documents later reaches the disk without anything here
 * changing. Times are written as dates and read back as milliseconds.
 */

import { withFrontmatter, readFrontmatter } from './frontmatter.js'
import { countWords } from '@/utils/wordCount.js'

/** @typedef {import('../types/models.js').Document} Document */

/** Fields that are times, kept as milliseconds and written as dates. */
const TIMES = ['created', 'updated', 'edited', 'trashed']

/**
 * Fields no file writes as they are: said by where the file is and what it
 * is, worked out, or written somewhere of their own.
 */
const LEFT_OUT = new Set([
  'id',
  'title',
  'summary',
  'content',
  'storyId',
  'parentId',
  'order',
  'type',
  'ordered',
  'plain',
  'wordCount',
  'version',
  'speakers',
  'digest',
  ...TIMES,
])

/** The hidden file a folder's row is kept in. */
export const FOLDER_FILE = '.folder.md'

/** The file a repository's rows are kept in, inside it. */
export const REPOSITORY_FILE = '.repository.json'

/**
 * Where a document is, for reading it back: what the file cannot say.
 *
 * @typedef {Object} Place
 * @property {string} storyId
 * @property {string} parentId
 * @property {number} order
 */

/**
 * A row's fields for its file: `id` and `title` first, then the summary
 * when it has one and the file does not carry it as its body, the flags
 * worth saying, the rest by name, and the times last.
 *
 * @param {Document} document
 * @param {{summary?: boolean, ordered?: boolean, plain?: boolean}} carry
 * @returns {Record<string, unknown>}
 */
function fieldsOf(document, carry) {
  /** @type {Record<string, any>} */
  const doc = document
  /** @type {Record<string, unknown>} */
  const fields = { id: doc.id, title: doc.title }
  if (carry.summary && doc.summary) fields.summary = doc.summary
  if (carry.ordered && doc.ordered) fields.ordered = true
  if (carry.plain && doc.plain) fields.plain = true
  for (const key of Object.keys(doc).sort()) {
    if (LEFT_OUT.has(key) || doc[key] === undefined) continue
    fields[key] = doc[key]
  }
  for (const key of TIMES) {
    if (typeof doc[key] === 'number') fields[key] = new Date(doc[key])
  }
  return fields
}

/**
 * A row from a file's fields, with the times back in milliseconds.
 *
 * @param {Record<string, any>} fields
 * @returns {Record<string, any>}
 */
function rowOf(fields) {
  /** @type {Record<string, any>} */
  const row = { ...fields }
  for (const key of TIMES) {
    const value = row[key]
    if (value === undefined) continue
    const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
    row[key] = Number.isNaN(ms) ? 0 : ms
  }
  return row
}

/**
 * @param {Document} document - A text document
 * @returns {string} Its markdown file
 */
export function textFile(document) {
  return withFrontmatter(fieldsOf(document, { summary: true, plain: true }), document.content)
}

/**
 * @param {Document} document - A folder, the root among them
 * @returns {string} Its `.folder.md`
 */
export function folderFile(document) {
  return withFrontmatter(fieldsOf(document, { ordered: true }), document.summary)
}

/**
 * @param {Document} document - An imported file
 * @returns {string} The hidden markdown file beside it
 */
export function fileSidecar(document) {
  return withFrontmatter(fieldsOf(document, { summary: true }), document.content)
}

/**
 * The hidden file beside an imported file: `.Rulebook.pdf.md` beside
 * `Rulebook.pdf`.
 *
 * @param {string} path
 * @returns {string}
 */
export function sidecarPath(path) {
  const slash = path.lastIndexOf('/')
  return `${path.slice(0, slash + 1)}.${path.slice(slash + 1)}.md`
}

/**
 * What a read gives back: the row, or nothing when the file has no id and
 * so is no document of ours yet.
 *
 * @typedef {Object} ReadDocument
 * @property {Document} document
 * @property {boolean} adopted - It had no id and was given one, so its file wants writing
 */

/**
 * A text document from its file.
 *
 * @param {string} text
 * @param {Place} place
 * @param {string} name - The file's name less its order prefix and `.md`
 * @param {(title: string) => boolean} fits - Whether the name is the one the title makes
 * @param {() => string} newId - An id for a file that has none
 * @returns {ReadDocument}
 */
export function readTextFile(text, place, name, fits, newId) {
  const { fields, body } = readFrontmatter(text)
  const adopted = typeof fields?.id !== 'string' || !fields.id
  const row = rowOf(adopted ? {} : fields || {})
  const title = typeof row.title === 'string' && fits(row.title) ? row.title : name
  /** @type {Document} */
  const document = {
    ...row,
    id: adopted ? newId() : row.id,
    storyId: place.storyId,
    parentId: place.parentId,
    order: place.order,
    type: 'text',
    ordered: false,
    title,
    content: body,
    summary: typeof row.summary === 'string' ? row.summary : '',
    wordCount: countWords(body),
    version: 1,
    created: row.created ?? 0,
    updated: row.updated ?? 0,
  }
  if (document.plain !== true) delete document.plain
  return { document, adopted }
}

/**
 * A folder from its `.folder.md`.
 *
 * @param {string} text
 * @param {Place} place
 * @param {string} name - The folder's name less its order prefix
 * @param {(title: string) => boolean} fits
 * @param {() => string} newId
 * @returns {ReadDocument}
 */
export function readFolderFile(text, place, name, fits, newId) {
  const { fields, body } = readFrontmatter(text)
  const adopted = typeof fields?.id !== 'string' || !fields.id
  const row = rowOf(adopted ? {} : fields || {})
  /** @type {Document} */
  const document = {
    ...row,
    id: adopted ? newId() : row.id,
    storyId: place.storyId,
    parentId: place.parentId,
    order: place.order,
    type: 'folder',
    ordered: row.ordered === true,
    title: typeof row.title === 'string' && fits(row.title) ? row.title : name,
    content: '',
    summary: adopted ? '' : body,
    wordCount: 0,
    version: 1,
    created: row.created ?? 0,
    updated: row.updated ?? 0,
  }
  return { document, adopted }
}

/**
 * An imported file from the hidden file beside it.
 *
 * @param {string} text
 * @param {Place} place
 * @param {string} name - The file's name less its order prefix and extension
 * @param {(title: string) => boolean} fits
 * @param {() => string} newId
 * @returns {ReadDocument}
 */
export function readFileSidecar(text, place, name, fits, newId) {
  const { fields, body } = readFrontmatter(text)
  const adopted = typeof fields?.id !== 'string' || !fields.id
  const row = rowOf(adopted ? {} : fields || {})
  /** @type {Document} */
  const document = {
    ...row,
    id: adopted ? newId() : row.id,
    storyId: place.storyId,
    parentId: place.parentId,
    order: place.order,
    type: 'file',
    ordered: false,
    title: typeof row.title === 'string' && fits(row.title) ? row.title : name,
    content: adopted ? '' : body,
    summary: typeof row.summary === 'string' ? row.summary : '',
    wordCount: adopted ? 0 : countWords(body),
    plain: true,
    version: 1,
    created: row.created ?? 0,
    updated: row.updated ?? 0,
  }
  return { document, adopted }
}

/**
 * A row as a repository keeps it: what its file cannot say, by path below
 * the repository. The text is the file itself.
 *
 * @typedef {Object} RepositoryEntry
 * @property {string} path
 * @property {string} id
 * @property {'folder'|'file'} type
 */

/**
 * A repository's `.repository.json`: its own row, and every row below it by
 * path. Kept as rows rather than frontmatter: nobody reads it but the app.
 *
 * @param {Document} repository
 * @param {Array<{path: string, document: Document}>} below
 * @returns {string}
 */
export function repositoryFile(repository, below) {
  const strip = (/** @type {Document} */ document) => {
    /** @type {Record<string, any>} */
    const out = {}
    for (const [key, value] of Object.entries(document)) {
      if (value === undefined) continue
      if (['content', 'storyId', 'parentId', 'order', 'wordCount', 'version'].includes(key))
        continue
      out[key] = value
    }
    return out
  }
  const entries = below.map(({ path, document }) => ({ path, ...strip(document) }))
  return `${JSON.stringify({ ...strip(repository), entries }, null, 2)}\n`
}

/**
 * A repository's rows from its `.repository.json`, with the text of each of
 * its files, which `textOf` reads from where the file is.
 *
 * @param {string} text
 * @param {Place} place - The repository's own
 * @param {(path: string) => string|undefined} textOf - A file's text by its path below the repository
 * @returns {Array<{path: string, document: Document}>|null} The repository first, at '',
 *   then what is in it; null when the file cannot be read
 */
export function readRepositoryFile(text, place, textOf) {
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed.id !== 'string') return null

  const { entries = [], ...own } = parsed
  /** @type {Document} */
  const repository = {
    ...own,
    storyId: place.storyId,
    parentId: place.parentId,
    order: place.order,
    content: '',
    wordCount: 0,
    version: 1,
  }

  /** @type {Map<string, string>} */
  const ids = new Map([['', repository.id]])
  for (const entry of entries) ids.set(entry.path, entry.id)
  /** @type {Map<string, number>} */
  const counts = new Map()

  const rows = entries
    .filter(
      (/** @type {any} */ entry) => typeof entry?.id === 'string' && typeof entry.path === 'string'
    )
    .map((/** @type {any} */ { path, ...row }) => {
      const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const parentId = ids.get(parentPath) || repository.id
      const order = counts.get(parentId) || 0
      counts.set(parentId, order + 1)
      const content = row.type === 'file' ? (textOf(path) ?? '') : ''
      /** @type {Document} */
      const document = {
        ...row,
        storyId: place.storyId,
        parentId,
        order,
        content,
        wordCount: row.type === 'file' ? countWords(content) : 0,
        version: 1,
      }
      return { path, document }
    })
  return [{ path: '', document: repository }, ...rows]
}
