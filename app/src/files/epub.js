/* global DOMParser */
/**
 * @module files/epub
 * @description An epub opened: its parts and chapters, as markdown.
 *
 * An epub is a zip of XHTML pages and a manifest. `META-INF/container.xml`
 * names the package file; the package lists every file it holds (the
 * manifest) and the order a reader goes through them (the spine); a table of
 * contents — `toc.ncx` in EPUB 2, a `nav` page in EPUB 3 — names the
 * chapters. No layout to reconstruct, unlike a PDF: the headings are `<h1>`,
 * the paragraphs `<p>`, the emphasis `<em>`.
 *
 * What is left is where the chapters are, because a book's pages are not its
 * chapters: one publisher gives every section a page, a converter cuts pages
 * by size mid-chapter, a Gutenberg book is often one page with anchors. The
 * table of contents says where they are, so the book is split where it
 * points — at an anchor, or at the top of a page — and its nesting decides
 * what is a part (a folder of chapters) and what is a chapter (a document,
 * sections and all). See `sectionsOf`.
 *
 * Each page goes through the editor's own schema and serializer, as the
 * markdown migration does, so the text is markdown the editor can show and
 * the paged tools can find their way through. Links are kept as their words,
 * since what they point at (another page of the zip, a footnote's anchor)
 * means nothing outside it, and pictures are dropped: the schema has none.
 *
 * The package and the table of contents are read with patterns rather than a
 * DOM: they are small, regular, and namespaced in ways the parsers disagree
 * about. Only the pages need a DOM. Under Node, with none, there is no text.
 *
 * A book locked with DRM has its pages encrypted; that is refused with a
 * reason, rather than read out as noise.
 */

import { unzipSync } from 'fflate'
import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model'
import { schema } from '@/editor/schema.js'
import { serializeMarkdown } from '@/editor/markdown.js'

/** The files an epub's text is in, or that say where it is. */
const READ = /\.(xml|opf|ncx|x?html?)$/i

/** What is dropped from a page whole: it is never the book's words. */
const DROPPED = 'script, style, noscript, template, svg, iframe, img, math, object, video, audio'

/**
 * The attributes of a tag, by name, without their namespace prefixes.
 *
 * @param {string} tag - An opening tag, `<item id="c1" href="c1.xhtml"/>`
 * @returns {Record<string, string>}
 */
function attributesOf(tag) {
  /** @type {Record<string, string>} */
  const found = {}
  for (const [, name, double, single] of tag.matchAll(
    /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  )) {
    found[name.replace(/^.*:/, '')] = decodeEntities(double ?? single ?? '')
  }
  return found
}

/**
 * Every opening tag of an element, namespace prefix or not.
 *
 * @param {string} source
 * @param {string} name - Without a prefix: `item`, `itemref`
 * @returns {Record<string, string>[]}
 */
function tagsNamed(source, name) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${name}(?=[\\s/>])[^>]*>`, 'g')
  return [...source.matchAll(pattern)].map(([tag]) => attributesOf(tag))
}

/**
 * The five entities XML has, and numeric ones; enough for titles and paths.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * A path inside the zip, from a reference relative to the file it was in.
 *
 * @param {string} base - The referring file's path, `OEBPS/content.opf`
 * @param {string} href - What it referred to, `Text/ch%201.xhtml#start`
 * @returns {string} `OEBPS/Text/ch 1.xhtml`
 */
export function resolvePath(base, href) {
  let target = href.replace(/#.*$/, '')
  try {
    target = decodeURIComponent(target)
  } catch {
    // A stray % in a name is a %.
  }
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/**
 * What an epub's package says: its title, its pages in reading order, and
 * where its table of contents is.
 *
 * @typedef {Object} EpubPackage
 * @property {string} title
 * @property {string[]} spine - Paths in the zip, in reading order
 * @property {string|null} toc - Path of the table of contents, nav or NCX
 */

/**
 * Read an epub's package from its files.
 *
 * @param {Record<string, string>} files - Path to text, for the files read
 * @returns {EpubPackage}
 * @throws {Error} When there is no package to read
 */
export function readPackage(files) {
  const container = files['META-INF/container.xml']
  const opfPath =
    (container && tagsNamed(container, 'rootfile')[0]?.['full-path']) ||
    Object.keys(files).find(path => path.toLowerCase().endsWith('.opf'))
  const opf = opfPath && files[opfPath]
  if (!opfPath || !opf) throw new Error('This is not an epub: it has no package file.')

  /** @type {Map<string, Record<string, string>>} */
  const manifest = new Map()
  for (const item of tagsNamed(opf, 'item')) if (item.id) manifest.set(item.id, item)

  const spine = tagsNamed(opf, 'itemref')
    .map(ref => manifest.get(ref.idref)?.href)
    .filter(href => typeof href === 'string')
    .map(href => resolvePath(opfPath, /** @type {string} */ (href)))

  const items = [...manifest.values()]
  const nav = items.find(item => /(^|\s)nav(\s|$)/.test(item.properties || ''))
  const spineTag = tagsNamed(opf, 'spine')[0]
  const ncx =
    (spineTag?.toc && manifest.get(spineTag.toc)) ||
    items.find(item => item['media-type'] === 'application/x-dtbncx+xml')
  const tocHref = nav?.href || ncx?.href

  const title = opf.match(/<(?:[\w-]+:)?title[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?title>/)?.[1]
  return {
    title: title ? decodeEntities(title.replace(/<[^>]+>/g, '')).trim() : '',
    spine,
    toc: tocHref ? resolvePath(opfPath, tocHref) : null,
  }
}

/**
 * An entry in a table of contents: a title, the place it points to, and the
 * entries under it.
 *
 * @typedef {Object} TocEntry
 * @property {string} title
 * @property {string} path - The page it opens, as a path in the zip; '' when
 *   it points nowhere (a heading in the nav with no link)
 * @property {string} fragment - The anchor in that page; '' for its top
 * @property {TocEntry[]} children
 */

/**
 * A label as plain text.
 *
 * @param {string} label - What the TOC had between the tags, markup and all
 * @returns {string}
 */
const labelText = label =>
  decodeEntities(label.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Read a table of contents as the tree it is: an NCX's nested navPoints, or
 * the nested lists of a nav page's `toc` nav. Read by walking its tags with a
 * stack rather than parsing it, since an NCX is XML an HTML parser misreads
 * (its `<content/>` is not self-closing there) and a nav is simple enough.
 *
 * An entry with no link of its own — a part heading in a nav — points where
 * its first child does.
 *
 * @param {string} source - The NCX or the nav page
 * @param {string} path - Where it is in the zip, for resolving its links
 * @returns {TocEntry[]}
 */
export function readToc(source, path) {
  /** @type {TocEntry} */
  const root = { title: '', path: '', fragment: '', children: [] }
  const stack = [root]
  const top = () => stack[stack.length - 1]
  const open = () => {
    /** @type {TocEntry} */
    const entry = { title: '', path: '', fragment: '', children: [] }
    top().children.push(entry)
    stack.push(entry)
  }
  const close = () => {
    if (stack.length > 1) stack.pop()
  }
  const point = (/** @type {string} */ href) => {
    const entry = top()
    if (entry === root || entry.path || !href) return
    entry.path = resolvePath(path, href)
    const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : ''
    try {
      entry.fragment = decodeURIComponent(fragment)
    } catch {
      entry.fragment = fragment
    }
  }
  const name = (/** @type {string} */ label) => {
    const entry = top()
    if (entry !== root && !entry.title && !entry.children.length) entry.title = labelText(label)
  }

  if (/<(?:[\w-]+:)?navMap/i.test(source)) {
    // NCX: <navPoint><navLabel><text>Title</text></navLabel><content src="…"/>…</navPoint>
    const map = source
      .slice(source.search(/<(?:[\w-]+:)?navMap/i))
      .split(/<\/(?:[\w-]+:)?navMap>/)[0]
    const tokens =
      /<(\/?)(?:[\w-]+:)?navPoint\b[^>]*>|<(?:[\w-]+:)?text>([\s\S]*?)<\/(?:[\w-]+:)?text>|<(?:[\w-]+:)?content\b([^>]*)>/g
    for (const [, closing, label, content] of map.matchAll(tokens)) {
      if (content !== undefined) point(attributesOf(content).src)
      else if (label !== undefined) name(label)
      else if (closing) close()
      else open()
    }
  } else {
    // Nav: the `toc` nav's lists; the landmarks and page lists are not chapters.
    const navs = [...source.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/g)]
    const toc = navs.find(([, attrs]) => /type\s*=\s*["']toc["']/.test(attrs)) || navs[0]
    const tokens = /<(\/?)li\b[^>]*>|<a\b([^>]*)>([\s\S]*?)<\/a>|<span\b[^>]*>([\s\S]*?)<\/span>/g
    for (const [, closing, attrs, linked, plain] of (toc?.[2] || '').matchAll(tokens)) {
      if (attrs !== undefined) {
        if (!top().title) point(attributesOf(attrs).href)
        name(linked)
      } else if (plain !== undefined) name(plain)
      else if (closing) close()
      else open()
    }
  }

  /** @param {TocEntry[]} entries @returns {TocEntry[]} */
  const settle = entries =>
    entries
      .map(entry => {
        const children = settle(entry.children)
        const first = children.find(child => child.path)
        return entry.path || !first
          ? { ...entry, children }
          : { ...entry, path: first.path, fragment: first.fragment, children }
      })
      .filter(entry => entry.path || entry.children.length)
  return settle(root.children)
}

/** What a cut is marked with in a page's markdown, on a line of its own. */
const CUT = /^EPUBCUT(\d+)EPUBCUT$/m

/** Elements a cut can go inside of; anything else it goes in front of. */
const CONTAINERS = new Set([
  'body',
  'div',
  'section',
  'article',
  'main',
  'aside',
  'header',
  'footer',
])

/**
 * One page of the book as markdown, with a marker line where each cut is.
 *
 * A cut is a place a table of contents points to: an anchor, or the top of
 * the page. Its marker goes in front of the block the anchor is in — a
 * heading, not the empty `<a id>` inside it — so the text splits between
 * blocks rather than through one.
 *
 * @param {string} source - The page's XHTML
 * @param {Map<string, number>} [cuts] - Anchor ('' for the top) to marker number
 * @returns {string}
 */
export function pageMarkdown(source, cuts = new Map()) {
  // The head is links to stylesheets and fonts, which a parser may go and fetch.
  const body = source.replace(/<head\b[\s\S]*?<\/head>/i, '')
  const page = new DOMParser().parseFromString(body, 'text/html')
  for (const [fragment, marker] of cuts) {
    const paragraph = page.createElement('p')
    paragraph.textContent = `EPUBCUT${marker}EPUBCUT`
    let at = fragment ? page.getElementById(fragment) : null
    while (at?.parentElement && !CONTAINERS.has(at.parentElement.tagName.toLowerCase())) {
      at = at.parentElement
    }
    if (at && at !== page.body && at.parentElement) at.parentElement.insertBefore(paragraph, at)
    else page.body.insertBefore(paragraph, page.body.firstChild)
  }
  for (const node of page.querySelectorAll(DROPPED)) node.remove()
  // A link is its words: what it points at is a place in the zip.
  for (const link of page.querySelectorAll('a')) link.replaceWith(...link.childNodes)
  return serializeMarkdown(ProseMirrorDOMParser.fromSchema(schema).parse(page.body)).trim()
}

/**
 * The paths whose contents are encrypted, other than fonts — which a
 * publisher may obfuscate without locking the book.
 *
 * @param {string|undefined} encryption - `META-INF/encryption.xml`
 * @returns {string[]}
 */
function lockedPages(encryption) {
  if (!encryption) return []
  return tagsNamed(encryption, 'CipherReference')
    .map(reference => reference.URI || '')
    .filter(uri => READ.test(uri))
}

/**
 * A part of the book as it goes into the tree: a chapter, which is a
 * document, or a part of several chapters, which is a folder.
 *
 * @typedef {Object} EpubSection
 * @property {string} title
 * @property {string} text - A chapter's markdown; for a part, what comes
 *   before its first chapter, when that is more than its title
 * @property {EpubSection[]} [children] - A part's chapters; absent for a chapter
 */

/**
 * An epub read out: its title, its parts and chapters, and its text whole.
 *
 * @typedef {Object} ExtractedEpub
 * @property {string} title - The title the book gives itself
 * @property {EpubSection[]} sections - In reading order
 * @property {string} text - Markdown, the whole book, each chapter under its title
 */

/**
 * When an entry with children is a part — a folder of its children — rather
 * than a chapter with its sections in it.
 *
 * A part's children each open a page of their own; a chapter's sections are
 * anchors in its page, or partway down the next one when the book's pages
 * were cut by size. That settles most books. One that is all one page —
 * many from Project Gutenberg — has no pages to go by, and there an entry
 * is a part when it has next to nothing of its own (a "BOOK I" heading)
 * and would make a document too long to read whole.
 */
const PART_WORDS = 100
const LONG_WORDS = 20000

/** What the text ahead of the first entry is called: the title page, the copyright. */
export const FRONT_MATTER = 'Front matter'

/**
 * How many words a text has, its headings aside.
 *
 * @param {string} text
 * @returns {number}
 */
const proseWords = text =>
  text
    .replace(/^#{1,6} .*$/gm, '')
    .split(/\s+/)
    .filter(Boolean).length

/**
 * A title the tree can hold: one line, and no slash, which the tools read as
 * a folder.
 *
 * @param {string} title
 * @returns {string}
 */
const treeTitle = title =>
  title
    .replace(/\s*\/\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The first heading of a text, for a chapter the table of contents does not name.
 *
 * @param {string} text
 * @returns {string}
 */
const firstHeading = text => text.match(/^#{1,6} (.+)$/m)?.[1]?.replace(/[*_`]/g, '') || ''

/**
 * Split a book's pages into its parts and chapters.
 *
 * Every place an entry points to is a cut. The pages are read in spine order
 * with a marker at each cut, and the text between one cut and the next is
 * the entry's own. A chapter takes its own text and all its sub-entries' —
 * its sections stay in it. A part takes only what comes before its first
 * child, and its children are split the same way. A book with no usable
 * table of contents is one chapter per page.
 *
 * @param {{spine: string[], toc: string|null}} book
 * @param {Record<string, string>} files
 * @returns {EpubSection[]}
 */
function sectionsOf(book, files) {
  const pages = book.spine.filter(path => files[path] !== undefined)
  const inSpine = new Set(pages)
  let entries = book.toc && files[book.toc] ? readToc(files[book.toc], book.toc) : []

  /** Every entry, in the order the table of contents gives them. @type {TocEntry[]} */
  const order = []
  const walk = (/** @type {TocEntry[]} */ list) => {
    for (const entry of list) {
      order.push(entry)
      walk(entry.children)
    }
  }
  walk(entries)
  if (!order.some(entry => inSpine.has(entry.path))) {
    entries = pages.map(path => ({ title: '', path, fragment: '', children: [] }))
    order.splice(0, order.length, ...entries)
  }

  // One marker per place, numbered in the order the places are first named.
  /** @type {Map<string, number>} */
  const markers = new Map()
  /** @type {Map<string, Map<string, number>>} */
  const cutsByPage = new Map()
  for (const entry of order) {
    if (!inSpine.has(entry.path)) continue
    const key = `${entry.path}#${entry.fragment}`
    if (markers.has(key)) continue
    markers.set(key, markers.size)
    if (!cutsByPage.has(entry.path)) cutsByPage.set(entry.path, new Map())
    cutsByPage.get(entry.path)?.set(entry.fragment, markers.size - 1)
  }

  // The book as segments, each opening at a marker; the first is what comes before any.
  /** @type {string[][]} */
  const segments = [[]]
  /** @type {Map<number, number>} */
  const segmentOf = new Map()
  /** The markers with nothing ahead of them on their page. @type {Set<number>} */
  const opening = new Set()
  for (const path of pages) {
    const parts = pageMarkdown(files[path], cutsByPage.get(path)).split(CUT)
    segments[segments.length - 1].push(parts[0])
    if (parts.length > 1 && !parts[0].trim()) opening.add(Number(parts[1]))
    for (let i = 1; i < parts.length; i += 2) {
      segmentOf.set(Number(parts[i]), segments.length)
      segments.push([parts[i + 1]])
    }
  }
  const opensPage = (/** @type {TocEntry} */ entry) =>
    opening.has(markers.get(`${entry.path}#${entry.fragment}`) ?? -1)
  const text = (/** @type {number} */ from, /** @type {number} */ to) =>
    segments
      .slice(from, to)
      .flat()
      .map(part => part.trim())
      .filter(Boolean)
      .join('\n\n')

  // Where each entry starts. One that points back to before the entry ahead of
  // it is out of order, and is left unplaced rather than tangling the ranges.
  /** @type {Map<TocEntry, number>} */
  const startOf = new Map()
  let last = 0
  for (const entry of order) {
    const at = segmentOf.get(markers.get(`${entry.path}#${entry.fragment}`) ?? -1)
    if (at === undefined || at < last) continue
    startOf.set(entry, at)
    last = at
  }
  if (!startOf.size) return []

  /**
   * Where the text from the `index`th entry on begins: the start of the first
   * placed entry at or after it, or the end of the book.
   *
   * @param {number} index - Into `order`
   * @returns {number} A segment
   */
  const startFrom = index => {
    for (let i = index; i < order.length; i++) {
      const at = startOf.get(order[i])
      if (at !== undefined) return at
    }
    return segments.length
  }
  /** @param {TocEntry} entry @returns {number} Its subtree's size, itself included */
  const size = entry => 1 + entry.children.reduce((sum, child) => sum + size(child), 0)

  /**
   * @param {TocEntry[]} list
   * @returns {EpubSection[]}
   */
  const build = list => {
    /** @type {EpubSection[]} */
    const out = []
    for (const entry of list) {
      const index = order.indexOf(entry)
      const start = startFrom(index)
      const end = startFrom(index + size(entry))
      // Nothing under it was placed: it has no text of its own to give.
      if (start >= end) continue
      const own = text(start, startFrom(index + 1))
      const whole = text(start, end)
      const children = entry.children.filter(
        child => startFrom(order.indexOf(child)) < startFrom(order.indexOf(child) + size(child))
      )
      const part =
        children.length > 0 &&
        (children.every(child => opensPage(child) && child.path !== entry.path) ||
          (proseWords(own) < PART_WORDS && proseWords(whole) > LONG_WORDS))
      if (part) {
        out.push({
          title: treeTitle(entry.title) || 'Untitled',
          text: proseWords(own) ? own : '',
          children: build(children),
        })
      } else if (whole) {
        out.push({
          title: treeTitle(entry.title || firstHeading(whole)) || 'Untitled',
          text: whole,
        })
      }
    }
    return out
  }

  const sections = build(entries)
  const front = text(0, startFrom(0))
  if (front) sections.unshift({ title: FRONT_MATTER, text: front })
  // A book with no table of contents names its pages by their headings, or by number.
  sections.forEach((section, i) => {
    if (section.title === 'Untitled') section.title = `Section ${i + 1}`
  })
  return sections
}

/**
 * The whole book as one text, each chapter under its title unless it opens
 * with a heading of its own — for reading it straight through.
 *
 * @param {EpubSection[]} sections
 * @returns {string}
 */
export function bookText(sections) {
  return sections
    .map(section => {
      const parts = []
      if (section.children || !section.text.startsWith('#')) parts.push(`# ${section.title}`)
      if (section.text) parts.push(section.text)
      if (section.children) parts.push(bookText(section.children))
      return parts.filter(Boolean).join('\n\n')
    })
    .join('\n\n')
}

/**
 * Read an epub's text out of its bytes.
 *
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {ExtractedEpub}
 * @throws {Error} When it is not a zip, not an epub, or locked
 */
export function extractEpub(data) {
  /** @type {Record<string, Uint8Array>} */
  let raw
  try {
    raw = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data), {
      // Pictures and fonts are most of a book's bytes and none of its words.
      filter: entry => READ.test(entry.name),
    })
  } catch {
    throw new Error('This epub cannot be opened: it is not a zip file.')
  }
  const decoder = new TextDecoder('utf-8')
  /** @type {Record<string, string>} */
  const files = {}
  for (const [path, bytes] of Object.entries(raw)) files[path] = decoder.decode(bytes)

  if (lockedPages(files['META-INF/encryption.xml']).length) {
    throw new Error('This epub is locked with DRM, so its text cannot be read.')
  }

  const book = readPackage(files)
  if (typeof DOMParser === 'undefined') return { title: book.title, sections: [], text: '' }

  const sections = sectionsOf(book, files)
  return { title: book.title, sections, text: bookText(sections) }
}
