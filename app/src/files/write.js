/* global File */
/**
 * @module files/write
 * @description A file written into the project: a document for the tree, and
 * its bytes beside it.
 *
 * The document carries what the tree and the model need — a title, a place,
 * the media type, the size, and the text that was read out of the file as
 * its `content`. The bytes go to the files table under the document's id.
 * Two writes, and the row is written first: a document without its file is
 * a document the tree can still show and the model can still read, whereas
 * bytes without a document are bytes nothing will ever find. The file opened
 * in between waits for its bytes (`filesStore`).
 *
 * The text can be read out again later, from the same bytes, when the first
 * reading was not good enough — `reextractFile`.
 */

import { useDocuments } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useFilesStore } from '@/stores/filesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { settleMarkdown } from '@/editor/markdown.js'
import { filenameFor } from './download.js'
import { inspectFile } from './inspect.js'

/** @typedef {import('./inspect.js').InspectedFile} InspectedFile */
/** @typedef {import('@/cards/write.js').Written} Written */

/**
 * Write a file into the project as a document.
 *
 * Titled after the file, in the folder it was asked for on — or at the top
 * of the project. A second file of the same name in the same folder is
 * `Name (2)`, as an import of anything is. An epub with chapters in it is
 * written holding them: `writeBook`.
 *
 * @param {string} storyId
 * @param {InspectedFile} file
 * @param {Object} [options]
 * @param {string} [options.parentId] - Where to put it; the project root otherwise
 * @returns {Promise<Written>}
 */
export async function writeFile(storyId, file, { parentId } = {}) {
  const api = useDocuments(storyId)
  await api.init()
  const store = useDocumentsStore()

  const parent = parentId || rootIdFor(storyId)
  if (file.sections?.length) return writeBook(storyId, file, file.sections, parent)

  const made = store.createDocument({
    storyId,
    parentId: parent,
    type: 'file',
    title: api.uniqueTitle(parent, file.title || 'Untitled'),
    content: file.text || '',
    mime: file.mime,
    size: file.size,
    ...(typeof file.pages === 'number' ? { pages: file.pages } : {}),
  })
  await useFilesStore().putFile(made.id, storyId, file.blob)

  return {
    folderId: made.id,
    title: made.title,
    pinnedIds: [],
    greetingIds: [],
    documents: 1,
    ...(isScan(file) && { scan: true }),
  }
}

/**
 * Write a book into the project as the epub holding its chapters.
 *
 * The epub is a file document titled after the file, with no text — the
 * chapters are its text, and a second copy would be found twice by every
 * search — so it can still be read straight through in the viewer and
 * downloaded. It holds its parts and chapters in order
 * (`.llm/nested_documents_design.md`). Each chapter is a markdown document;
 * a part that says something before its first chapter is that text, holding
 * its chapters, and one that says nothing is an ordered folder of them.
 *
 * @param {string} storyId
 * @param {InspectedFile} file
 * @param {import('./epub.js').EpubSection[]} sections
 * @param {string} parent
 * @returns {Promise<Written>}
 */
async function writeBook(storyId, file, sections, parent) {
  const api = useDocuments(storyId)
  const store = useDocumentsStore()
  let chapters = 0
  const chapter = (
    /** @type {string} */ parentId,
    /** @type {string} */ title,
    /** @type {string} */ text
  ) => {
    chapters++
    return store.createDocument({
      storyId,
      parentId,
      type: 'text',
      title: api.uniqueTitle(parentId, title),
      content: settleMarkdown(text),
    })
  }

  /**
   * @param {import('./epub.js').EpubSection[]} list
   * @param {string} parentId
   */
  const write = (list, parentId) => {
    for (const section of list) {
      if (!section.children) {
        chapter(parentId, section.title, section.text)
        continue
      }
      const part = section.text
        ? chapter(parentId, section.title, section.text)
        : store.createDocument({
            storyId,
            parentId,
            type: 'folder',
            title: api.uniqueTitle(parentId, section.title),
          })
      store.updateDocument(part.id, { ordered: true })
      write(section.children, part.id)
    }
  }

  const book = store.createDocument({
    storyId,
    parentId: parent,
    type: 'file',
    ordered: true,
    title: api.uniqueTitle(parent, file.title || 'Untitled'),
    content: '',
    mime: file.mime,
    size: file.size,
  })
  await useFilesStore().putFile(book.id, storyId, file.blob)
  write(sections, book.id)

  return {
    folderId: book.id,
    title: book.title,
    pinnedIds: [],
    greetingIds: [],
    documents: chapters + 1,
  }
}

/**
 * Read a file's text out of its bytes again and make it the document's text.
 *
 * For when the first reading was wrong — a PDF whose columns came out
 * interleaved, a text the writer cut down and wants whole again. Whatever the
 * document's text was, edits and all, is replaced; the caller asks first.
 * The bytes are not touched, and a file with no bytes to read is left as it
 * is.
 *
 * @param {string} storyId
 * @param {string} documentId - A file document
 * @returns {Promise<InspectedFile|null>} What was read, or null when there
 *   were no bytes to read it from
 * @throws {Error} When the file cannot be opened, as at import
 */
export async function reextractFile(storyId, documentId) {
  const api = useDocuments(storyId)
  await api.init()
  const document = api.get(documentId)
  if (!document || document.type !== 'file') return null

  const blob = await useFilesStore().getFile(documentId)
  if (!blob) return null

  const found = await inspectFile(new File([blob], filenameFor(document), { type: document.mime }))
  api.setContent(documentId, found.text || '')
  useDocumentsStore().updateDocument(documentId, {
    size: found.size,
    ...(typeof found.pages === 'number' ? { pages: found.pages } : {}),
  })
  return found
}

/**
 * Whether a file is a PDF with no text in it: a scan, which a model that
 * can't see the file has nothing of to read.
 *
 * @param {InspectedFile} file
 * @returns {boolean}
 */
function isScan(file) {
  return file.mime === 'application/pdf' && !file.text
}
