/**
 * @module files/docx
 * @description A Word file as markdown, the way a Google Doc comes in.
 *
 * mammoth reads the `.docx` into HTML by Word's own styles: headings,
 * paragraphs, lists, tables, emphasis and links. That HTML is then read as
 * any page is for reading (`markdownOfHtml`), so the editor's schema decides
 * what comes through, and what it has no place for, such as underline or a
 * font, is left out as it would be from a paste. Pictures are counted and
 * left out, as a Google Doc's are: documents cannot hold them yet.
 *
 * mammoth is loaded with the first Word file, not with the app.
 */

import { markdownOfHtml } from './html.js'

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
 * A Word file's text as markdown, and how many pictures were left out of it.
 *
 * @param {ArrayBuffer} data - The file's bytes
 * @returns {Promise<{markdown: string, images: number}>}
 * @throws {Error} When it cannot be read as a Word file
 */
export async function docxToMarkdown(data) {
  const { default: mammoth } = await import('mammoth')
  let images = 0
  const counted = mammoth.images.imgElement(async () => {
    images++
    return { src: '' }
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
  return { markdown: markdownOfHtml(converted.value.replace(BACK_LINK, '')), images }
}
