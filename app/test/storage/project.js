/**
 * A project to lay out, write into a memory disk, and read back.
 */

import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { countWords } from '@/utils/wordCount.js'
import { layoutProject, readProject, wantedTexts } from '@/storage/layout.js'
import { projectFiles } from '@/storage/plan.js'
import { safeName } from '@/storage/names.js'

/** @typedef {import('@/types/models.js').Document} Document */

export const STORY = 'story_test'
export const ROOT = rootIdFor(STORY)
export const SCHEMA = 25
const TIME = Date.UTC(2026, 9, 10, 9, 30, 0, 123)

export const story = () => ({
  id: STORY,
  overview: '',
  wordCount: 0,
  version: 1,
  created: TIME,
  updated: TIME,
})

/**
 * @param {string} id
 * @param {string} parentId
 * @param {Partial<Document>} [fields]
 * @returns {Document}
 */
export function doc(id, parentId, fields = {}) {
  const type = fields.type || 'text'
  const content = type === 'folder' ? '' : (fields.content ?? '')
  /** @type {Document} */
  const document = {
    id,
    storyId: STORY,
    parentId,
    order: 0,
    type,
    ordered: false,
    title: id,
    summary: '',
    version: 1,
    created: TIME,
    updated: TIME,
    ...fields,
    content,
    wordCount: type === 'folder' ? 0 : countWords(content),
  }
  if (type === 'file') document.plain = true
  return document
}

/** @param {string} id @param {string} parentId @param {Partial<Document>} [fields] */
export const folder = (id, parentId, fields = {}) =>
  doc(id, parentId, { type: 'folder', ...fields })

/** A small project with something of every kind in it. */
export function sample() {
  return [
    folder(ROOT, STORY, { title: 'My Novel', summary: 'A book.', edited: TIME + 5 }),
    folder('manuscript', ROOT, { title: 'Manuscript', ordered: true, order: 0 }),
    folder('act1', 'manuscript', { title: 'Act 1', ordered: true, order: 0 }),
    doc('ch1', 'act1', {
      title: 'Chapter 1',
      content: 'The door had been there all along.',
      order: 0,
    }),
    doc('ch2', 'act1', {
      title: 'Chapter 2',
      content: '## A heading\n\nAnd *more*.',
      summary: 'Elara: finds the door.',
      order: 1,
    }),
    folder('notes', ROOT, { title: 'Notes', order: 1 }),
    doc('elara', 'notes', { title: 'Elara', content: 'Tall.', kind: 'character', hidden: true }),
    doc('pdf', 'notes', {
      type: 'file',
      title: 'Rulebook',
      mime: 'application/pdf',
      size: 1234,
      pages: 3,
      content: 'Rules, page one.',
    }),
    folder('repo', 'notes', {
      title: 'tool',
      kind: 'repository',
      source: { from: 'github', name: 'someone/tool', imported: TIME },
    }),
    folder('src', 'repo', { title: 'src' }),
    doc('main', 'src', {
      type: 'file',
      title: 'main.js',
      mime: 'text/javascript',
      size: 20,
      content: 'console.log("hi")\n',
    }),
    doc('readme', 'repo', {
      type: 'file',
      title: 'README.md',
      mime: 'text/markdown',
      size: 7,
      content: '# tool\n',
    }),
  ]
}

/**
 * The rows as a read gives them back: places numbered from the top in the
 * order the folder shows, and versions as a read has them.
 *
 * @param {Document[]} documents
 * @returns {Document[]}
 */
export function asRead(documents) {
  const byId = new Map(documents.map(document => [document.id, document]))
  /** @type {Map<string, Document[]>} */
  const children = new Map()
  for (const document of documents) {
    if (document.id === ROOT) continue
    if (!children.has(document.parentId)) children.set(document.parentId, [])
    children.get(document.parentId)?.push(document)
  }
  const inRepository = (/** @type {Document} */ document) => {
    for (let at = byId.get(document.parentId); at; at = byId.get(at.parentId)) {
      if (at.kind === 'repository') return true
    }
    return false
  }
  /** @type {Document[]} */
  const out = []
  for (const document of documents) {
    const parent = byId.get(document.parentId)
    let order = 0
    if (parent) {
      const siblings = children.get(parent.id) || []
      const ordered =
        parent.ordered === true && !inRepository(document) && parent.kind !== 'repository'
      const sorted = siblings
        .slice()
        .sort(
          ordered
            ? (a, b) => a.order - b.order || (a.id > b.id ? 1 : -1)
            : (a, b) => a.title.localeCompare(b.title) || (a.id > b.id ? 1 : -1)
        )
      order = sorted.findIndex(sibling => sibling.id === document.id)
    }
    out.push({ ...document, order, version: 1 })
  }
  return byIdSorted(out)
}

/** @param {Document[]} documents */
export const byIdSorted = documents =>
  documents.slice().sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))

/** @param {Document[]} documents */
export const lookup = documents => {
  const byId = new Map(documents.map(document => [document.id, document]))
  return (/** @type {string} */ id) => byId.get(id)
}

/**
 * Write a project into an empty disk, the bytes of its imported files
 * included, and say where everything went.
 *
 * @param {ReturnType<typeof import('./memoryDisk.js').memoryDisk>} disk
 * @param {Document[]} documents
 */
export function writeFresh(disk, documents) {
  const entries = layoutProject(documents, ROOT)
  for (const [path, text] of projectFiles(story(), SCHEMA, entries, lookup(documents))) {
    disk.write(path, text)
  }
  for (const entry of entries.values()) {
    if (entry.kind === 'file') disk.write(entry.path, `bytes of ${entry.id}`)
  }
  return entries
}

let made = 0

/**
 * Read a project back off a disk.
 *
 * @param {ReturnType<typeof import('./memoryDisk.js').memoryDisk>} disk
 * @param {string} [name] - The project folder's name
 */
export function readBack(disk, name = safeName('My Novel')) {
  const files = disk.list()
  const texts = new Map(
    wantedTexts(files).map(path => [path, /** @type {string} */ (disk.read(path))])
  )
  const read = readProject({ files, texts, name }, { newId: () => `doc_made${++made}`, now: 99 })
  if (!read) throw new Error('No project there')
  return read
}
