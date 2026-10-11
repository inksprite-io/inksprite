/**
 * @module files
 * @description Files that are not prose — PDFs, images, whatever the writer
 * drops in — brought into the project as documents.
 *
 * A file is a document with `type: 'file'`. It has a place in the tree, a
 * title, a summary, and `content` like any other; what it also has is a media
 * type, a size, and its bytes, which live in their own table
 * (`stores/filesStore.js`) rather than on the row. Its `content` is the text
 * that could be read out of it when it was imported — a PDF's text, page by
 * page — and that is what lets the model read, search, pin and summarize a
 * paper through the tools it already has, on every model there is.
 *
 * - **pdf** - A PDF's text, page by page, extracted with pdf.js on demand
 * - **epub** - An epub's parts and chapters, split where its table of contents
 *   points, as markdown
 * - **inspect** - A file looked at: what it is, and what text is in it
 * - **write** - A file written into the project as a document, bytes and all,
 *   and its text read out again on request
 * - **download** - The file handed back, named as it came in
 * - **batch** - Many files at once, each with the folders it came in: a
 *   folder chosen whole, or a drop from the desktop
 *
 * The editor panel shows a file as the file (`FileView.vue`: the picture,
 * the PDF, or "No preview available") and its text on request, in the plain
 * field, where it can be corrected.
 *
 * Design: `.llm/files_design.md`.
 *
 * @example
 * import { inspectFile } from '@/files/inspect.js'
 * import { writeFile } from '@/files/write.js'
 *
 * const found = await inspectFile(file)
 * await writeFile(storyId, found, { parentId })
 */

export { extractPdf, pageMarker, pageText, joinPages } from './pdf.js'
export { extractEpub } from './epub.js'
export { inspectFile, mimeOf, titleOf, hasText, isStructured, sizeLabel } from './inspect.js'
export { textOfHtml } from './html.js'
export {
  gatherFiles,
  gatherDropped,
  listFiles,
  listDropped,
  withoutJunk,
  folderOf,
  carriesFiles,
  isJunk,
} from './batch.js'
export { writeFile, reextractFile } from './write.js'
