/**
 * @module utils/documentPath
 * @description How a document is addressed: by its titles from the root down.
 *
 * `Characters/Elara` is a document; `/` is the project. It is the one address
 * a document has — the AI tools list and resolve it, and the outline copies
 * it — so it is spelled in exactly one place. A title nobody has given reads
 * as "Untitled".
 *
 * Being an address, a path has to lead to one document. So no two documents
 * in a folder go by one name, compared the way a tool matches a path: without
 * the spaces round it, whatever its case, and "Untitled" for none.
 */

import { rootIdFor } from '@/stores/migrations/projectTree.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * The titles a document's path is made of, from the top down, its own last.
 * Empty for no document and for the project itself.
 *
 * @param {(id: string) => Document|null|undefined} get - A document by id
 * @param {Document|null|undefined} document
 * @returns {string[]}
 */
export function documentTitles(get, document) {
  if (!document) return []
  const rootId = rootIdFor(document.storyId)
  if (document.id === rootId) return []

  const names = [document.title || 'Untitled']
  let current = get(document.parentId)
  while (current && current.id !== rootId) {
    names.unshift(current.title || 'Untitled')
    current = get(current.parentId)
  }
  return names
}

/**
 * The path of a document, given a way to find its ancestors.
 *
 * The document is taken as passed rather than looked up, so that a record of
 * a change can name the document as it was when the change was made.
 *
 * @param {(id: string) => Document|null|undefined} get - A document by id
 * @param {Document|null|undefined} document
 * @returns {string} The path, or '' for no document
 */
export function documentPath(get, document) {
  if (!document) return ''
  if (document.id === rootIdFor(document.storyId)) return '/'
  return documentTitles(get, document).join('/')
}

/**
 * A title as names in one folder are compared.
 * @param {string|null|undefined} title
 * @returns {string}
 */
export function titleKey(title) {
  return (title?.trim() || 'Untitled').toLowerCase()
}

/**
 * The document among `siblings` that already goes by `title`.
 *
 * @param {Document[]} siblings - A folder's children
 * @param {string} title
 * @param {string} [exceptId] - The document being renamed or moved, which
 *   does not stand in its own way
 * @returns {Document|null}
 */
export function namesake(siblings, title, exceptId) {
  const key = titleKey(title)
  return (
    siblings.find(sibling => sibling.id !== exceptId && titleKey(sibling.title) === key) || null
  )
}

/**
 * `title` if none of `siblings` goes by it, and otherwise the first of
 * `Title (2)`, `Title (3)`… that none does.
 *
 * @param {Document[]} siblings - A folder's children
 * @param {string} title
 * @param {string} [exceptId] - The document being renamed or moved
 * @returns {string}
 */
export function freeTitle(siblings, title, exceptId) {
  const taken = new Set(
    siblings.filter(sibling => sibling.id !== exceptId).map(sibling => titleKey(sibling.title))
  )
  if (!taken.has(titleKey(title))) return title

  const base = title.trim() || 'Untitled'
  for (let at = 2; ; at++) {
    const candidate = `${base} (${at})`
    if (!taken.has(titleKey(candidate))) return candidate
  }
}
