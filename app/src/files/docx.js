/**
 * @module files/docx
 * @description A Word file as markdown, the way a Google Doc comes in.
 *
 * mammoth reads the `.docx` into HTML by Word's own styles: headings,
 * paragraphs, lists, tables, emphasis and links. That HTML is then read as
 * any page is for reading (`markdownOfHtml`), so the editor's schema decides
 * what comes through, and what it has no place for, such as underline or a
 * font, is left out as it would be from a paste. Each picture is taken out
 * as it is read, its bytes kept and a marker left where it was, as a Google
 * Doc's are (`files/pictures.js`), to be made the document's own.
 *
 * mammoth is loaded with the first Word file, not with the app.
 */

import { markdownOfHtml } from './html.js'
import { markerFor } from './pictures.js'

/** A Word file's media type. */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** A Word file, by its name. */
const DOCX = /\.docx$/i

/**
 * Whether a file is a Word file, by its type or its name.
 *
 * @param {{name: string, type: string}} file
 * @returns {boolean}
 */
export const isDocx = file => file.type === DOCX_MIME || DOCX.test(file.name)

/**
 * The link back from a footnote to where it was called, which mammoth ends
 * each note with. In a document it would be a link to nowhere.
 */
const BACK_LINK = /\s*<a href="#(?:foot|end)note-ref-[^"]*">↑<\/a>/g

/**
 * A Word file's text as markdown, and the pictures taken out of it.
 *
 * @param {ArrayBuffer} data - The file's bytes
 * @returns {Promise<{markdown: string, pictures: import('./pictures.js').TakenPicture[]}>}
 * @throws {Error} When it cannot be read as a Word file
 */
export async function docxToMarkdown(data) {
  const { default: mammoth } = await import('mammoth')
  /** @type {import('./pictures.js').TakenPicture[]} */
  const pictures = []
  const counted = mammoth.images.imgElement(async image => {
    const marker = markerFor(pictures.length + 1)
    const read = /** @type {ArrayBuffer|Uint8Array} */ (await image.read())
    pictures.push({
      marker,
      mime: image.contentType || 'application/octet-stream',
      bytes: new Uint8Array(read),
    })
    return { src: marker }
  })
  let converted
  try {
    // The browser build reads `arrayBuffer`, the Node one (the tests')
    // `buffer`; either takes the bytes as they are.
    const input = /** @type {{arrayBuffer: ArrayBuffer}} */ ({ arrayBuffer: data, buffer: data })
    converted = await mammoth.convertToHtml(input, { convertImage: counted })
  } catch {
    throw new Error('Couldn’t read the Word file')
  }
  const markdown = markdownOfHtml(converted.value.replace(BACK_LINK, ''), { pictures: true })
  // A picture the reading left out, in a place markdown has none, is no picture.
  return { markdown, pictures: pictures.filter(({ marker }) => markdown.includes(`](${marker})`)) }
}
