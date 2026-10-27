/**
 * @module files/exportDocument
 * @description A project, a folder or a document handed out as it would be
 * published, to be used somewhere else: a repository's docs, a site's build,
 * another Markdown app. Its files and directories are named as the outline
 * shows them, each text is as it stands, without comments or suggestions,
 * and each imported file is as it came in. What is made to be brought back
 * in is a backup (`composables/useBackup.js`).
 *
 * - A folder is a directory of its name, the project's own among them.
 * - A text is `<name>.md`, as every reader but the editor reads it: pending
 *   suggestions left out and the comments' markup gone. A plain one is as
 *   typed, and under its title when that ends in an extension, as a script
 *   kept as `analysis.py` does.
 * - An imported file is the file as it came in, under its name and
 *   extension. A repository's file keeps no bytes, and is its text.
 * - A document that holds others is itself, with a directory of its name
 *   beside it for what it holds, as the outline and links have it.
 * - A text's pictures go in an `images` directory beside it, numbered where
 *   two documents' share a name, and its text points there.
 * - Every link to a document in the export is written again from the names
 *   the export gave, relative, so it goes there wherever the export is put.
 *   A link to anything else is left as it was written.
 *
 * Names are the ones links are written with (`fileNameOf`), without an
 * ordered folder's place. Two made alike take `(2)`, the first in the
 * outline's order keeping the name, and the pictures' directory gives way to
 * a document's.
 *
 * Design: `.llm/export_design.md`.
 */

import { Fragment } from 'prosemirror-model'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { schema } from '@/editor/schema.js'
import { textAsItStands } from '@/editor/suggestionText.js'
import { claimName, safeName, splitExtension } from '@/storage/names.js'
import { encodeName, isDocumentHref, resolveLink } from '@/utils/documentLinks.js'
import { pictureKey, pictureName, pictureOf } from '@/utils/pictures.js'
import { filenameFor } from './download.js'
import { isText } from './inspect.js'

/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {import('@/utils/documentLinks.js').LinkTree} LinkTree */
/** @typedef {import('prosemirror-model').Node} Node */
/** @typedef {import('prosemirror-model').Mark} Mark */

/**
 * What an export is read from.
 *
 * @typedef {Object} ExportSource
 * @property {LinkTree} tree - The project, without what is in its trash
 * @property {(id: string) => string} content - A text's markdown, the
 *   editor's where it is open
 * @property {(key: string) => Promise<Blob|null>} read - A file's bytes by its
 *   document's id, or a picture's by its key (`pictureKey`); null when there
 *   are none to be had
 * @property {(id: string) => Promise<string|null>} [located] - Where a file is
 *   in the library, for an export written to a folder to copy it from; null
 *   for one to read instead
 */

/**
 * One thing in an export, by its path there: a directory, a text, or a
 * file's bytes, read or to be copied from the library.
 *
 * @typedef {{path: string, folder: true}
 *   | {path: string, text: string}
 *   | {path: string, blob: Blob}
 *   | {path: string, file: string}} ExportEntry
 */

/**
 * An export, read and ready to be written.
 *
 * @typedef {Object} Export
 * @property {string} name - What it is called: a folder's directory's name,
 *   or a document's file's
 * @property {ExportEntry[]} entries - Each directory before what is in it
 * @property {number} missing - The files left out, whose bytes couldn't be had
 */

/**
 * Where a document goes in an export.
 *
 * @typedef {Object} Place
 * @property {string} path - Its file's, or a folder's directory's
 * @property {string} dir - The directory it is in: '' at the top
 * @property {string} [inside] - Where what it holds goes: a folder's own
 *   directory, or the one beside a document that holds others
 */

/** The end of a plain text's title that is its file's extension: `.py`, `.json`. */
const OWN_EXTENSION = /\.[a-z][a-z0-9]{0,7}$/i

/** What a text with a link or a picture in it has: a `]`, or a `<` around an address. */
const MAY_LINK = /[\]<]/

/**
 * The name a document takes in an export, before any `(2)`.
 *
 * @param {Document} document
 * @returns {{stem: string, extension: string}}
 */
function nameOf(document) {
  const title = safeName(document.title)
  if (document.type === 'folder') return { stem: title, extension: '' }
  if (document.type === 'file') return splitExtension(safeName(filenameFor(document)))
  if (document.plain && OWN_EXTENSION.test(title)) return splitExtension(title)
  return { stem: title, extension: '.md' }
}

/** @param {string} dir @param {string} name */
const join = (dir, name) => (dir ? `${dir}/${name}` : name)

/**
 * A path from a directory to a file or directory, each name encoded as a
 * link holds it. Never all of the way up: one to the directory a link is in
 * goes up from it and down again.
 *
 * @param {string} fromDir
 * @param {string} toPath
 * @returns {string}
 */
function relative(fromDir, toPath) {
  const from = fromDir ? fromDir.split('/') : []
  const to = toPath.split('/')
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++
  const names = [...from.slice(shared).map(() => '..'), ...to.slice(shared).map(encodeName)]
  return names.join('/') || '.'
}

/**
 * A document's text with its links and pictures' sources changed as asked:
 * each one asked of, and changed where the answer is a string. A link on a
 * picture is a link too.
 *
 * @param {Node} node
 * @param {{link: (href: string) => string|null, image: (src: string) => string|null}} change
 * @returns {Node} The node itself when nothing in it changed
 */
function rewrite(node, change) {
  /** @param {Mark} mark */
  const relinked = mark => {
    if (mark.type !== schema.marks.link) return mark
    const href = change.link(mark.attrs.href)
    return href === null || href === mark.attrs.href
      ? mark
      : schema.marks.link.create({ ...mark.attrs, href })
  }
  const marks = node.marks.map(relinked)
  const remarked = marks.some((mark, at) => mark !== node.marks[at])
  if (node.isText) return remarked ? node.mark(marks) : node
  if (node.type === schema.nodes.image) {
    const src = change.image(node.attrs.src)
    if ((src === null || src === node.attrs.src) && !remarked) return node
    return node.type.create({ ...node.attrs, ...(src === null ? {} : { src }) }, null, marks)
  }
  /** @type {Node[]} */
  const children = []
  let changed = false
  node.forEach(child => {
    const next = rewrite(child, change)
    if (next !== child) changed = true
    children.push(next)
  })
  return changed ? node.copy(Fragment.fromArray(children)) : node
}

/**
 * The sources of every picture in a document's text.
 *
 * @param {Node} doc
 * @returns {string[]}
 */
function imageSources(doc) {
  /** @type {string[]} */
  const sources = []
  doc.descendants(node => {
    if (node.type === schema.nodes.image) sources.push(node.attrs.src)
  })
  return sources
}

/**
 * Read a project, a folder or a document as an export of it.
 *
 * @param {ExportSource} source
 * @param {string} topId - What is exported: the project's root, a folder, or
 *   a document
 * @returns {Promise<Export>}
 * @throws {Error} When there is no such document
 */
export async function exportEntries(source, topId) {
  const { tree } = source
  const top = tree.get(topId)
  if (!top) throw new Error(`No document ${topId} to export`)

  /** The names taken in each directory, by `nameKey`. @type {Map<string, Set<string>>} */
  const taken = new Map()
  /** @param {string} dir */
  const takenIn = dir => {
    let names = taken.get(dir)
    if (!names) taken.set(dir, (names = new Set()))
    return names
  }

  /** @type {Map<string, Place>} In the outline's order, each before what it holds */
  const places = new Map()
  /**
   * @param {Document} document
   * @param {string} dir
   */
  const place = (document, dir) => {
    const names = takenIn(dir)
    const { stem, extension } = nameOf(document)
    const name = claimName(names, stem, extension)
    const path = join(dir, name)
    const children = tree.childrenOf(document.id)
    const inside =
      document.type === 'folder'
        ? path
        : children.length > 0
          ? join(dir, claimName(names, splitExtension(name).stem, ''))
          : undefined
    places.set(document.id, inside === undefined ? { path, dir } : { path, dir, inside })
    if (inside !== undefined) for (const child of children) place(child, inside)
  }
  place(top, '')

  /** @type {ExportEntry[]} */
  const entries = []
  let missing = 0

  /**
   * Each directory's pictures: what its `images` is called once one is put
   * in it, the names taken there, and the source a text gives each picture
   * by its key, or null for one with no bytes.
   *
   * @type {Map<string, {folder: string|null, names: Set<string>, byKey: Map<string, string|null>}>}
   */
  const shelves = new Map()

  /**
   * A picture put in a directory's `images`, once however many texts there
   * show it, and the source they show it by; null when it has no bytes.
   *
   * @param {string} dir
   * @param {{documentId: string, name: string}} picture
   * @returns {Promise<string|null>}
   */
  const shelve = async (dir, picture) => {
    let shelf = shelves.get(dir)
    if (!shelf) shelves.set(dir, (shelf = { folder: null, names: new Set(), byKey: new Map() }))
    const key = pictureKey(picture.documentId, picture.name)
    const known = shelf.byKey.get(key)
    if (known !== undefined) return known
    const blob = await source.read(key)
    if (!blob) {
      shelf.byKey.set(key, null)
      return null
    }
    shelf.folder ??= claimName(takenIn(dir), 'images', '')
    const name = pictureName(picture.name, blob.type, shelf.names)
    entries.push({ path: join(join(dir, shelf.folder), name), blob })
    const src = `${encodeName(shelf.folder)}/${encodeName(name)}`
    shelf.byKey.set(key, src)
    return src
  }

  /**
   * Where a link goes in the export, from the directory a text is in, with
   * what followed its path; null for one that goes nowhere in it, or only to
   * a place in the text it is in.
   *
   * @param {string} href
   * @param {string} fromId
   * @param {string} fromDir
   * @returns {string|null}
   */
  const linkTo = (href, fromId, fromDir) => {
    if (!isDocumentHref(href)) return null
    const bare = href
      .trim()
      .replace(/^<([\s\S]*)>$/, '$1')
      .trim()
    const at = bare.search(/[?#]/)
    if (at === 0) return null
    const to = resolveLink(tree, bare, fromId)
    const there = to ? places.get(to.id) : undefined
    if (!there) return null
    return relative(fromDir, there.path) + (at < 0 ? '' : bare.slice(at))
  }

  /**
   * A text as it is exported.
   *
   * @param {Document} document
   * @param {Place} at
   * @returns {Promise<string>}
   */
  const textOf = async (document, at) => {
    const content = source.content(document.id)
    if (document.plain) return content
    const text = textAsItStands(content)
    if (!MAY_LINK.test(text)) return text
    const doc = parseMarkdown(text)
    /** @type {Map<string, string>} */
    const shelved = new Map()
    for (const src of imageSources(doc)) {
      const picture = pictureOf(src)
      const out = picture && !shelved.has(src) ? await shelve(at.dir, picture) : null
      if (out) shelved.set(src, out)
    }
    const next = rewrite(doc, {
      link: href => linkTo(href, document.id, at.dir),
      image: src => shelved.get(src) ?? linkTo(src, document.id, at.dir),
    })
    return next === doc ? text : serializeMarkdown(next)
  }

  /**
   * An imported file as it is exported: copied from the library where it is
   * there, or its bytes, or the text of one that keeps none; null for one
   * whose bytes can't be had.
   *
   * @param {Document} document
   * @param {string} path
   * @returns {Promise<ExportEntry|null>}
   */
  const fileOf = async (document, path) => {
    const file = (await source.located?.(document.id)) ?? null
    if (file) return { path, file }
    const blob = await source.read(document.id)
    if (blob) return { path, blob }
    if (isText(document.mime || '')) return { path, text: document.content || '' }
    return null
  }

  for (const [id, at] of places) {
    const document = /** @type {Document} */ (tree.get(id))
    if (document.type === 'folder') {
      entries.push({ path: at.path, folder: true })
      continue
    }
    if (document.type === 'text') {
      entries.push({ path: at.path, text: await textOf(document, at) })
    } else {
      const entry = await fileOf(document, at.path)
      if (entry) entries.push(entry)
      else missing++
    }
    if (at.inside !== undefined) entries.push({ path: at.inside, folder: true })
  }

  const own = /** @type {Place} */ (places.get(topId))
  return { name: own.path, entries, missing }
}
