/* global Blob */
/**
 * @module files/inspect
 * @description A file looked at before it is written: what it is, and what
 * text is in it.
 *
 * Nothing here touches the tree. The importer asks this what a file holds and
 * then decides where it goes; a test asks it the same and checks the answer.
 */

import { languageOf } from '@/source/language.js'
import { textOfFile } from '@/source/text.js'
import { extractEpub } from './epub.js'
import { textOfHtml } from './html.js'
import { extractPdf } from './pdf.js'

/**
 * Media types by extension, for the files a browser hands over with an empty
 * `type` — which it does for anything it has never heard of, and on some
 * systems for everything.
 *
 * @type {Record<string, string>}
 */
export const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  epub: 'application/epub+zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  zip: 'application/zip',
}

/** What a file is called when nothing says otherwise. */
export const UNKNOWN_MIME = 'application/octet-stream'

/**
 * The media type of a file: what the browser said, or what its name says, or
 * nothing in particular.
 *
 * @param {string} name - The filename
 * @param {string} [declared] - The type the browser gave it
 * @returns {string}
 */
export function mimeOf(name, declared) {
  if (declared) return declared
  const extension = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
  return MIME_BY_EXTENSION[extension] || UNKNOWN_MIME
}

/**
 * The extension a file of this type is saved with, for handing one back.
 *
 * @param {string} mime
 * @returns {string} Without the dot; '' when nothing is known
 */
export function extensionFor(mime) {
  for (const [extension, known] of Object.entries(MIME_BY_EXTENSION)) {
    if (known === mime) return extension
  }
  return ''
}

/** Extensions that mark prose, which a title drops as a paper's does. */
const PROSE_EXTENSIONS = new Set(['md', 'markdown', 'txt'])

/**
 * The title a file's document takes.
 *
 * A paper, a picture, a book or a page of prose is its name without the
 * extension. The model addresses `Papers/RAG survey`, not
 * `Papers/RAG survey.pdf`; the extension is the media type's to know, and a
 * download puts it back. Anything else shown as plain text, such as code,
 * configuration or data, keeps it: there the extension is part of the name,
 * and `foo.cpp` and `foo.h` are two files.
 *
 * @param {string} name
 * @param {string} [mime] - The type it came in as; without one, the extension goes
 * @returns {string}
 */
export function titleOf(name, mime = '') {
  const extension = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
  if (showsAsText(mime) && !PROSE_EXTENSIONS.has(extension)) return name.trim() || 'Untitled'
  return name.replace(/\.[^.]+$/, '').trim() || name.trim() || 'Untitled'
}

/**
 * Whether a file of this type is a picture.
 * @param {string} mime
 * @returns {boolean}
 */
export const isImage = mime => mime.startsWith('image/')

/**
 * Whether a file of this type is text that can be read as it is.
 * @param {string} mime
 * @returns {boolean}
 */
export const isText = mime =>
  mime.startsWith('text/') ||
  mime === 'application/json' ||
  mime === 'application/xml' ||
  mime.endsWith('+xml') ||
  mime.endsWith('+json')

/**
 * Whether a file of this type is shown as the text it is, rather than as a
 * picture, a page or a book.
 * @param {string} mime
 * @returns {boolean}
 */
export const showsAsText = mime => !isImage(mime) && isText(mime) && mime !== 'text/html'

/**
 * Types kept as bytes on purpose: office files, archives, RTF, and the
 * formats read their own way. Anything else that is not text by its type is
 * looked at, in case it is.
 */
const KEPT_AS_BYTES = new Set(Object.values(MIME_BY_EXTENSION).filter(mime => !isText(mime)))

/** An epub's media type. */
export const EPUB_MIME = 'application/epub+zip'

/**
 * Whether importing a file of this type reads any text out of it, and so
 * whether reading it again could give a different answer.
 * @param {string} mime
 * @returns {boolean}
 */
export const hasText = mime => mime === 'application/pdf' || (!isImage(mime) && isText(mime))

/**
 * Whether a file of this type comes out of import with its structure already
 * there — an epub's headings, lists and emphasis — so that converting it to
 * Markdown would be paying a model to write out what is already written.
 * @param {string} mime
 * @returns {boolean}
 */
export const isStructured = mime => mime === EPUB_MIME

/**
 * A size as a person reads one: `1.2 MB`, `640 KB`, `12 bytes`.
 * @param {number} bytes
 * @returns {string}
 */
export function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return bytes === 1 ? '1 byte' : `${bytes} bytes`
}

/**
 * A file, looked at.
 *
 * @typedef {Object} InspectedFile
 * @property {string} title - What the document will be called
 * @property {string} mime
 * @property {number} size - Bytes
 * @property {string} text - What could be read out of it: a PDF's text page
 *   by page, a text file as it is, nothing for an image
 * @property {number} [pages] - For a format that has pages
 * @property {import('./epub.js').EpubSection[]} [sections] - For an epub: its
 *   parts and chapters, which it is imported as rather than as one text
 * @property {Blob} blob - The file itself
 */

/**
 * Say what a file is and what text is in it, writing nothing.
 *
 * A PDF is opened and its text read out, which is the one costly thing here
 * and the reason it is done once, now, rather than every time the model asks.
 * An epub is its parts and chapters, as markdown, and the whole book as one
 * text besides. A web page is its words, without the page around them. A
 * text file is its own text. An image has none — what it shows is for a
 * model that can see it, later — and neither does a slide deck or a Word
 * file, kept as they are until something can open them.
 *
 * Text is known by its bytes as well as its type. A file no table knows
 * (`foo.cpp`, a `Makefile`), or one the browser took for something else (a
 * TypeScript `.ts` for a video), is read, and comes in as the text it turns
 * out to be, typed by its name.
 *
 * @param {File} file
 * @returns {Promise<InspectedFile>}
 * @throws {Error} When a PDF or an epub cannot be opened
 */
export async function inspectFile(file) {
  const declared = mimeOf(file.name, file.type)
  const read = isUnread(declared) ? await textOfFile(file) : null
  const mime = read === null ? declared : languageOf(file.name).mime
  // The bytes are kept with the type they were found to have: a browser that
  // handed the file over with none would otherwise leave a PDF the viewer
  // shows as characters.
  const blob = file.type === mime ? file : new Blob([file], { type: mime })
  const found = { title: titleOf(file.name, mime), mime, size: file.size, blob }

  if (mime === 'application/pdf') {
    const { pages, text } = await extractPdf(await file.arrayBuffer())
    return { ...found, text, pages }
  }
  if (mime === EPUB_MIME) {
    const { sections, text } = extractEpub(await file.arrayBuffer())
    return { ...found, text, sections }
  }
  if (mime === 'text/html') {
    return { ...found, text: textOfHtml(await file.text()) }
  }
  if (isImage(mime) || !isText(mime)) return { ...found, text: '' }
  // A file typed as text is taken at its word, even when it is not UTF-8.
  return { ...found, text: read ?? (await textOfFile(file)) ?? (await file.text()) }
}

/**
 * Whether a file of this type is read only to see whether it is text: not
 * text by its type, not a picture, and not a type kept as bytes on purpose.
 * @param {string} mime
 * @returns {boolean}
 */
const isUnread = mime => !isText(mime) && !isImage(mime) && !KEPT_AS_BYTES.has(mime)
