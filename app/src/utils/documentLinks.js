/**
 * @module utils/documentLinks
 * @description Links from one document to another, as Markdown files link to
 * the files beside them.
 *
 * A link is written the way Obsidian writes one with its "relative path to
 * file" setting: from the linking document's folder to the file, by the
 * names the files have on disk, with `.md` on a text document and spaces as
 * `%20`. A project kept in a folder on disk (see `storage/layout.js`) can
 * then be read by any Markdown editor and its links still go somewhere.
 * The one thing left out is an ordered folder's place prefix (`03 - `),
 * which changes whenever the folder is reordered: a link into an ordered
 * folder works here, and outside only once the prefix is added.
 *
 * Reading one is more forgiving, since links come from models and from
 * other apps: a destination in `<…>` with the spaces left in, a name with no
 * extension, a title as well as the name on disk, and a project path from
 * the top (the form every tool lists, with or without a `/` in front). A
 * link is tried from the linking document's folder first, then from the top.
 *
 * Anything with a scheme (`https:`, `mailto:`) is a link to somewhere else,
 * and not this module's.
 *
 * Design: `.llm/document_links_design.md`.
 */

import { filenameFor } from '@/files/download.js'
import { nameKey, safeName, splitExtension } from '@/storage/names.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * The tree a link is resolved in.
 *
 * @typedef {Object} LinkTree
 * @property {(id: string) => Document|null|undefined} get - A document by id
 * @property {(parentId: string) => Document[]} childrenOf - A folder's children
 * @property {string} rootId - The project's own row
 */

/** A scheme, or the `//` of an address on another host. */
const ELSEWHERE = /^([a-z][a-z0-9+.-]*:|\/\/)/i

/** A place in an ordered folder, as a file's name on disk starts with it. */
const ORDER_PREFIX = /^\d+ - /

/**
 * What a link destination cannot hold as it is, or a reader would take for
 * something else: a space or anything else outside printable ASCII, and the
 * characters the editor's Markdown reader would encode on the next save, so
 * a link it reads back is the link that was written.
 */
const UNSAFE_IN_LINK = /[^\x21-\x7e]|[%#?()<>"[\]\\^`{|}]/gu

/**
 * Whether a link goes to a document in the project rather than somewhere
 * else: it has no scheme.
 *
 * @param {string|null|undefined} href
 * @returns {boolean}
 */
export function isDocumentHref(href) {
  const text = unwrap(href)
  return Boolean(text) && !ELSEWHERE.test(text)
}

/**
 * A destination without the `<…>` CommonMark lets it be written in.
 *
 * @param {string|null|undefined} href
 * @returns {string}
 */
function unwrap(href) {
  const text = (href || '').trim()
  return text.startsWith('<') && text.endsWith('>') ? text.slice(1, -1).trim() : text
}

/**
 * The names in a link's path, decoded one by one, so an encoded `/` in a
 * name stays in it. What follows a `#` or a `?` is not part of the path.
 *
 * @param {string} href
 * @returns {{names: string[], fromTop: boolean}}
 */
function pathOf(href) {
  const text = unwrap(href).replace(/[?#].*$/s, '')
  const names = text.split('/').map(name => {
    try {
      return decodeURIComponent(name)
    } catch {
      // A `%` that is not the start of an escape is a `%`.
      return name
    }
  })
  return { names: names.filter(name => name && name !== '.'), fromTop: text.startsWith('/') }
}

/**
 * The name a document's file or folder has on disk, without the place an
 * ordered folder puts in front of it.
 *
 * @param {Document} document
 * @returns {string}
 */
export function fileNameOf(document) {
  if (document.type === 'folder') return safeName(document.title)
  if (document.type === 'file') return safeName(filenameFor(document))
  return `${safeName(document.title)}.md`
}

/**
 * The name a link's path has for a document on the way to another: a
 * folder's, or a document's that holds others, by its name without the
 * extension. Links follow the outline, not the directory such a document has
 * on disk (`.llm/nested_documents_design.md`).
 *
 * @param {Document} document
 * @returns {string}
 */
function stepNameOf(document) {
  if (document.type === 'folder') return safeName(document.title)
  return splitExtension(fileNameOf(document)).stem
}

/**
 * The names of a link's path to a document, from below the first of them.
 *
 * @param {Document[]} documents - The document last, what holds it before it
 * @returns {string[]}
 */
const pathNames = documents =>
  documents.map((document, at) =>
    encodeName(at === documents.length - 1 ? fileNameOf(document) : stepNameOf(document))
  )

/**
 * Every name a document answers to in a link, as names are compared.
 *
 * @param {Document} document
 * @returns {Set<string>}
 */
function namesOf(document) {
  const title = document.title?.trim() || 'Untitled'
  const file = fileNameOf(document)
  return new Set([title, file, safeName(title)].map(nameKey))
}

/**
 * The child of a folder a name in a link means. The name as it is first;
 * then without a place prefix, as a file in an ordered folder is named on
 * disk; then, for the last name, without its extension, which a link to a
 * file whose kind the writer did not know may have wrong.
 *
 * @param {LinkTree} tree
 * @param {string} folderId
 * @param {string} name
 * @param {boolean} last
 * @returns {Document|null}
 */
function childNamed(tree, folderId, name, last) {
  const children = tree.childrenOf(folderId)
  const find = (/** @type {string} */ wanted) => {
    const key = nameKey(wanted.trim())
    return children.find(child => namesOf(child).has(key)) || null
  }
  const unprefixed = name.replace(ORDER_PREFIX, '')
  return (
    find(name) ||
    (unprefixed !== name ? find(unprefixed) : null) ||
    (last ? find(splitExtension(unprefixed).stem) : null)
  )
}

/**
 * Follow a link's names from a folder. `..` above the project stays at its
 * top: a link cannot leave the project, and one that tries most likely
 * meant the folder it got to.
 *
 * @param {LinkTree} tree
 * @param {string} folderId
 * @param {string[]} names
 * @returns {Document|null}
 */
function walk(tree, folderId, names) {
  let at = tree.get(folderId) || null
  for (let index = 0; index < names.length && at; index++) {
    const name = names[index]
    if (name === '..') {
      if (at.id !== tree.rootId) at = tree.get(at.parentId) || null
      continue
    }
    at = childNamed(tree, at.id, name, index === names.length - 1)
  }
  return at
}

/**
 * The document a link goes to, or null for none. Only for a link
 * `isDocumentHref` says is one. A link that is only a `#` or a `?` is the
 * document it is in.
 *
 * @param {LinkTree} tree
 * @param {string} href
 * @param {string|null} [fromId] - The document the link is in. Without one,
 *   as in a chat, a link is read from the top of the project.
 * @returns {Document|null}
 */
export function resolveLink(tree, href, fromId) {
  if (!isDocumentHref(href)) return null
  const from = fromId ? tree.get(fromId) : null
  const { names, fromTop } = pathOf(href)
  if (names.length === 0) return fromTop ? tree.get(tree.rootId) || null : from || null

  const here = from && !fromTop ? (from.type === 'folder' ? from.id : from.parentId) : null
  return (here && walk(tree, here, names)) || walk(tree, tree.rootId, names)
}

/**
 * The one document anywhere in the project that goes by a name, for a link
 * the writer types as nothing but that. Null when none does, or more than
 * one: a link has to go to one document.
 *
 * @param {LinkTree} tree
 * @param {string} name
 * @returns {Document|null}
 */
export function documentNamed(tree, name) {
  const key = nameKey(name.trim())
  /** @type {Document[]} */
  const found = []
  const visit = (/** @type {string} */ parentId) => {
    for (const child of tree.childrenOf(parentId)) {
      if (child.type !== 'folder' && namesOf(child).has(key)) found.push(child)
      visit(child.id)
    }
  }
  visit(tree.rootId)
  return found.length === 1 ? found[0] : null
}

/**
 * A link as the writer should read it: its path, decoded, without `<…>`.
 *
 * @param {string} href
 * @returns {string}
 */
export function readableHref(href) {
  const text = unwrap(href)
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/**
 * The documents from the top of the project down to this one, the project
 * itself left out.
 *
 * @param {LinkTree} tree
 * @param {string} id
 * @returns {Document[]}
 */
function lineage(tree, id) {
  /** @type {Document[]} */
  const out = []
  let at = tree.get(id)
  while (at && at.id !== tree.rootId) {
    out.unshift(at)
    at = tree.get(at.parentId)
  }
  return out
}

/**
 * A name as a link destination holds it: spaces, letters outside ASCII and
 * the few characters a reader would take for something else percent-encoded,
 * the rest as it is.
 *
 * @param {string} name
 * @returns {string}
 */
export function encodeName(name) {
  return name.replace(UNSAFE_IN_LINK, character =>
    character === '(' || character === ')'
      ? `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      : encodeURIComponent(character)
  )
}

/**
 * The link from one document to another, as it is written in the first.
 *
 * @param {LinkTree} tree
 * @param {string} fromId - The document the link goes in
 * @param {string} toId - The document it goes to
 * @returns {string}
 */
export function hrefFor(tree, fromId, toId) {
  const from = lineage(tree, fromId)
  const to = lineage(tree, toId)
  const folders = from.slice(0, -1)

  // Never all of the way: a link to the document this one is under is to it.
  let shared = 0
  while (
    shared < folders.length &&
    shared < to.length - 1 &&
    folders[shared].id === to[shared].id
  ) {
    shared++
  }
  const names = [...folders.slice(shared).map(() => '..'), ...pathNames(to.slice(shared))]
  return names.join('/') || '.'
}

/**
 * A document's link from the top of the project, `/Notes/Cast%20list.md`,
 * which `resolveLink` reads from the top wherever it is written. What a link
 * is carried as on the clipboard: the document it is pasted into may be in
 * another folder, where the link as written would go somewhere else.
 *
 * @param {LinkTree} tree
 * @param {string} id
 * @returns {string}
 */
export function projectHref(tree, id) {
  return `/${pathNames(lineage(tree, id)).join('/')}`
}
