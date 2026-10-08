/**
 * @module files/pdf
 * @description A PDF opened: its text, page by page, and its pages for drawing.
 *
 * The text is extracted once, when the file is imported, and stored as the document's
 * `content` — which is what makes a paper a document like any other to the
 * model: it is read, searched, pinned and summarized through the same tools
 * as a chapter, on every model, including one that cannot see a PDF at all.
 *
 * pdf.js does the reading, and only when asked: it is a megabyte and a half
 * of JavaScript that nothing else in the app needs, so it is imported the
 * first time a PDF arrives and not before. The `legacy` build, because the
 * modern one assumes a browser newer than some the app runs in, and because
 * the tests run it under Node, where the legacy build is the one that works
 * without a worker.
 *
 * Each page opens with a marker line — `[p.7]` — so that what the model reads
 * says which page it is on, and a page it names can be found again. A page
 * with no text keeps its marker: the model can then tell a page that is blank
 * from one that is missing. A PDF with no text on any page — a scan — comes
 * out as no text at all, so the import can say so.
 */

import { isWebKit } from '@/utils/webkit.js'

/** The library, loaded on first use and then kept. @type {Promise<typeof import('pdfjs-dist')>|null} */
let library = null

/**
 * pdf.js, loaded once.
 *
 * In a browser the parsing runs in a worker, which has to be told where its
 * script is. Where there is no `Worker` — under Node, in the tests — pdf.js
 * falls back to running on the main thread by itself, and the worker script
 * is neither needed nor resolvable.
 *
 * @returns {Promise<typeof import('pdfjs-dist')>}
 */
export function loadPdfjs() {
  if (!library) {
    library = (async () => {
      const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
      if (typeof Worker !== 'undefined') {
        const { default: workerUrl } = await import(
          'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
        )
        lib.GlobalWorkerOptions.workerSrc = workerUrl
      }
      return lib
    })().catch(error => {
      // A failed load is not a fact about the next PDF.
      library = null
      throw error
    })
  }
  return library
}

/**
 * How a page is marked in the text: on a line of its own, ahead of the page.
 *
 * @param {number} page - Counted from one, as a reader would
 * @returns {string}
 */
export function pageMarker(page) {
  return `[p.${page}]`
}

/**
 * One page's text from the items pdf.js found on it.
 *
 * An item is a run of characters where the page put them; `hasEOL` says a
 * line ended after it. Runs are joined as they come and a line break goes in
 * where the page had one, so a column of text reads as its lines. Nothing
 * here reflows paragraphs: a paper's line breaks are what they are, and a
 * model reads through them.
 *
 * @param {Array<{str?: string, hasEOL?: boolean}>} items
 * @returns {string}
 */
export function pageText(items) {
  let out = ''
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  return out
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The pages as one text, each under its marker — or nothing, when there was
 * nothing on any of them.
 *
 * @param {string[]} pages - Each page's text, in order
 * @returns {string}
 */
export function joinPages(pages) {
  if (pages.every(page => !page.trim())) return ''
  return pages.map((page, at) => `${pageMarker(at + 1)}\n${page}`.trimEnd()).join('\n\n')
}

/**
 * Whether pdf.js may hand a PDF's JPEGs to the browser's `ImageDecoder`.
 *
 * Not in WebKit. Safari has no `ImageDecoder`, so this costs it nothing, but
 * WebKit on Linux has one, and drawing a page through it there brings down the
 * page's process. pdf.js decodes in JavaScript instead, as it already does for
 * any JPEG the API cannot take.
 *
 * @param {string} [userAgent]
 * @returns {boolean}
 */
export function imageDecoderAllowed(userAgent) {
  return !isWebKit(userAgent)
}

/**
 * A PDF opened for reading its pages, and the way to let it go.
 *
 * @typedef {Object} OpenedPdf
 * @property {import('pdfjs-dist').PDFDocumentProxy} document
 * @property {typeof import('pdfjs-dist')} lib - pdf.js itself, for what a
 *   caller draws with: the text layer
 * @property {() => Promise<void>} close - Frees the document and the worker's
 *   side of it; the pages are no good after
 */

/**
 * Open a PDF.
 *
 * For the viewer, which draws pages, and for the reader, which takes their
 * text. Fonts are laid out only when asked, since the text needs none.
 *
 * @param {ArrayBuffer|Uint8Array} data - The file
 * @param {Object} [options]
 * @param {boolean} [options.fonts] - Lay out the fonts the pages name; for drawing
 * @returns {Promise<OpenedPdf>}
 * @throws {Error} When the file is not a PDF pdf.js can open
 */
export async function openPdf(data, { fonts = false } = {}) {
  const lib = await loadPdfjs()
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const task = lib.getDocument({
    data: bytes,
    disableFontFace: !fonts,
    isImageDecoderSupported: imageDecoderAllowed(),
    verbosity: lib.VerbosityLevel.ERRORS,
  })
  try {
    const document = await task.promise
    // The task owns the worker's side of the document; letting it go is what
    // frees the pages.
    return { document, lib, close: () => task.destroy() }
  } catch (error) {
    await task.destroy()
    throw error
  }
}

/**
 * Read a PDF's text.
 *
 * @param {ArrayBuffer|Uint8Array} data - The file
 * @returns {Promise<{pages: number, text: string}>} How many pages it has, and
 *   their text under markers — '' when no page has any
 * @throws {Error} When the file is not a PDF pdf.js can open
 */
export async function extractPdf(data) {
  const { document: pdf, close } = await openPdf(data)
  try {
    /** @type {string[]} */
    const pages = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      // Marked content has no `str` and is skipped; only the text items count.
      pages.push(pageText(/** @type {Array<{str?: string, hasEOL?: boolean}>} */ (content.items)))
      page.cleanup()
    }
    return { pages: pdf.numPages, text: joinPages(pages) }
  } finally {
    await close()
  }
}

/**
 * A line of a page as it was set: its text, the size most of it is set in,
 * and how far up the page it sits.
 *
 * @typedef {Object} LayoutLine
 * @property {string} text - '' for a blank line between paragraphs
 * @property {number} size - In the page's units; a heading is set larger than the body
 * @property {number} y - Its baseline, measured from the bottom of the page
 * @property {boolean} [bold] - Set in a bold face throughout: a heading at the
 *   body's size can be told from the body by its weight
 */

/**
 * A bookmark from the PDF's own outline, placed: the page it points at, and
 * where on that page when the PDF says.
 *
 * @typedef {Object} Bookmark
 * @property {string} title
 * @property {number} level - 1 for a bookmark at the top of the outline
 * @property {number} page - Counted from one
 * @property {number|null} top - The height on the page it points at, or null for the page as a whole
 */

/**
 * What a PDF's layout says about its structure, beyond its words.
 *
 * @typedef {Object} PdfLayout
 * @property {Array<{number: number, height: number, lines: LayoutLine[]}>} pages - Each
 *   page's height, in the units its lines' heights are measured in, and its lines
 * @property {Bookmark[]} outline - In outline order; empty when the PDF has none
 */

/**
 * One page's lines from the items pdf.js found on it. The same reading as
 * `pageText`, a line where the page ended one, with each line's size and
 * height kept: the size tells a heading from the body, and the height is
 * where a bookmark on the page points.
 *
 * @param {Array<{str?: string, hasEOL?: boolean, height?: number, transform?: number[], fontName?: string}>} items
 * @param {Set<string>} [bold] - The page's fonts that are bold faces, by the names its items use
 * @returns {LayoutLine[]}
 */
export function pageLines(items, bold = new Set()) {
  /** @type {LayoutLine[]} */
  const lines = []
  let text = ''
  /** @type {Map<number, number>} */
  let sizes = new Map()
  /** @type {number|null} */
  let y = null
  let heavy = 0
  let light = 0

  const end = () => {
    const clean = text.replace(/[ \t\u00a0]+/g, ' ').trim()
    if (clean) {
      let size = 0
      let most = -1
      for (const [candidate, chars] of sizes) {
        if (chars > most) {
          most = chars
          size = candidate
        }
      }
      lines.push({
        text: clean,
        size,
        y: y ?? 0,
        ...(heavy > 0 && light === 0 ? { bold: true } : {}),
      })
    } else if (lines.length > 0 && lines[lines.length - 1].text !== '') {
      // A run of blank lines is one paragraph break.
      lines.push({ text: '', size: 0, y: y ?? 0 })
    }
    text = ''
    sizes = new Map()
    y = null
    heavy = 0
    light = 0
  }

  for (const item of items) {
    if (typeof item.str !== 'string') continue
    if (item.str.trim()) {
      const transform = item.transform || []
      if (y === null) y = transform[5] ?? 0
      const height = item.height || Math.hypot(transform[2] || 0, transform[3] || 0)
      const size = Math.round(height * 10) / 10
      sizes.set(size, (sizes.get(size) || 0) + item.str.length)
      const letters = item.str.replace(/[^\p{L}\p{N}]/gu, '').length
      if (bold.has(item.fontName || '')) heavy += letters
      else light += letters
    }
    text += item.str
    if (item.hasEOL) end()
  }
  end()
  while (lines.length > 0 && lines[lines.length - 1].text === '') lines.pop()
  return lines
}

/**
 * The PDF's outline, each bookmark placed on its page. A bookmark that
 * points nowhere this file can find — a web link, a broken destination — is
 * left out, and its children keep their own levels.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @returns {Promise<Bookmark[]>}
 */
export async function outlineOf(pdf) {
  const outline = await pdf.getOutline().catch(() => null)
  /** @type {Bookmark[]} */
  const placed = []

  /**
   * @param {any[]|undefined} items
   * @param {number} level
   */
  const walk = async (items, level) => {
    for (const item of items || []) {
      let page = null
      let top = null
      try {
        let dest = item.dest
        if (typeof dest === 'string') dest = await pdf.getDestination(dest)
        if (Array.isArray(dest) && dest[0] != null) {
          page = typeof dest[0] === 'number' ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1
          const kind = dest[1]?.name
          const height =
            kind === 'XYZ' ? dest[3] : kind === 'FitH' || kind === 'FitBH' ? dest[2] : null
          top = typeof height === 'number' ? height : null
        }
      } catch {
        page = null
      }
      const title = String(item.title || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (title && page) placed.push({ title, level, page, top })
      await walk(item.items, level + 1)
    }
  }
  await walk(outline || [], 1)
  return placed
}

/** A font's name that says it is a bold face. */
const BOLD_FACE = /bold|black|heavy|semibold|demi/i

/**
 * Which of a page's fonts are bold faces. The text items name a font only
 * by an id; its real name — `LMRoman12-Bold` — is known once the page's
 * drawing has been read, which loads the fonts it uses.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {{items: any[]}} content
 * @returns {Promise<Set<string>>}
 */
async function boldFonts(page, content) {
  const ids = new Set(content.items.map(item => item.fontName).filter(Boolean))
  const bold = new Set()
  if (ids.size === 0) return bold
  try {
    await page.getOperatorList()
  } catch {
    return bold
  }
  for (const id of ids) {
    try {
      const font = page.commonObjs.has(id) ? page.commonObjs.get(id) : null
      if (font && (font.bold || BOLD_FACE.test(String(font.name || '')))) bold.add(id)
    } catch {
      // A font the page never drew; its weight does not matter.
    }
  }
  return bold
}

/**
 * Read a PDF's layout: every page's lines, with their sizes and heights,
 * and the outline the PDF carries. What a conversion plans its sections
 * from; the importer's text is the same words without the layout.
 *
 * @param {ArrayBuffer|Uint8Array} data - The file
 * @returns {Promise<PdfLayout>}
 * @throws {Error} When the file is not a PDF pdf.js can open
 */
export async function readPdfLayout(data) {
  const { document: pdf, close } = await openPdf(data)
  try {
    /** @type {PdfLayout['pages']} */
    const pages = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const [, bottom, , top] = page.view
      pages.push({
        number,
        height: top - bottom,
        lines: pageLines(/** @type {any[]} */ (content.items), await boldFonts(page, content)),
      })
      page.cleanup()
    }
    return { pages, outline: await outlineOf(pdf) }
  } finally {
    await close()
  }
}
