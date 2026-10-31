/**
 * @module files/printPage
 * @description A document as a printed page: its text as it stands, without
 * comments or the suggestions not taken, in the editor's own styles. The
 * page takes the app's place while it prints (`style.css`'s print rules),
 * which set it closer for paper.
 *
 * - A link to another site stays a link, which a PDF keeps. A link to a
 *   document in the project is its words alone: it would lead nowhere.
 * - A picture is shown from the bytes the caller says, and one it has none
 *   for, such as a picture on the web, is left out. A paragraph that is only
 *   a picture is a figure, as in the editor.
 *
 * - Where each page's text can bring its own room above and below, the page's
 *   margins there are zero, which keeps Chrome from printing its own header
 *   and footer in them: the date, the title, the page's address.
 *
 * Drawn in a document of its own first, which loads nothing, so no picture
 * is asked for by the path in the text.
 */

import { DOMSerializer } from 'prosemirror-model'
import { parseMarkdown } from '@/editor/markdown.js'
import { schema } from '@/editor/schema.js'
import { textAsItStands } from '@/editor/suggestionText.js'
import { isDocumentHref } from '@/utils/documentLinks.js'

/**
 * The page's classes: the editor's for its text (`Editor.vue`), at the one
 * size, without the dark theme's.
 */
export const PAGE_CLASS = 'print-page prose font-sans max-w-none [&_li>*]:my-0'

/**
 * Whether each page's text can bring its own room above and below
 * (`box-decoration-break: clone`), as Chromium and Firefox can. Safari can't,
 * and prints no header or footer unless asked. Asked here rather than in
 * `style.css`, whose build would count Safari's prefixed property, which
 * clones the edges of words alone.
 *
 * @returns {boolean}
 */
const paged = () => globalThis.CSS?.supports?.('box-decoration-break', 'clone') ?? false

/** The page's margins above and below, where its text brings its own room. */
const PAGED = '@page { margin-top: 0; margin-bottom: 0; }'

/**
 * A document's page, ready to be put in the app's.
 *
 * @param {string} content - The document's markdown
 * @param {(src: string) => Promise<string|null>} picture - The address a
 *   picture is shown from, by its path in the text; null for one not shown
 * @returns {Promise<HTMLElement>}
 */
export async function printPage(content, picture) {
  const doc = parseMarkdown(textAsItStands(content))
  const inert = document.implementation.createHTMLDocument('')
  const page = inert.createElement('div')
  page.className = PAGE_CLASS
  page.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: inert }))

  for (const link of page.querySelectorAll('a[href]')) {
    if (isDocumentHref(link.getAttribute('href'))) link.replaceWith(...link.childNodes)
  }
  for (const image of page.querySelectorAll('img')) {
    const src = await picture(image.getAttribute('src') || '')
    if (src) image.setAttribute('src', src)
    else image.remove()
  }
  for (const paragraph of page.querySelectorAll('p')) {
    const [only] = paragraph.childNodes
    if (paragraph.childNodes.length === 1 && only.nodeName === 'IMG') {
      paragraph.classList.add('figure')
    }
  }
  if (paged()) {
    const style = inert.createElement('style')
    style.textContent = PAGED
    page.classList.add('paged')
    page.append(style)
  }
  return /** @type {HTMLElement} */ (document.adoptNode(page))
}
