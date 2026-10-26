/* global structuredClone, URLSearchParams */
/**
 * Links between linked documents, as a Doc has them and as they are here.
 *
 * A link here to another document of the project is a path from the
 * document it is in (`utils/documentLinks.js`); in a Doc, a link to another
 * Doc is that Doc's address. A sync reads the Doc with each link to the Doc
 * of a document in the project as the link to that document, and writes
 * each link to a document with a Doc as that Doc's address, so that the two
 * compare alike. A link to a document with no Doc goes up as its words
 * alone, and a link to a Doc no document here is linked to stays as it is.
 * A link to a place inside a Doc, a heading or a bookmark, stays too: a
 * link here goes to a document, not a place in one.
 */

import { hrefFor, isDocumentHref, resolveLink } from '@/utils/documentLinks.js'

/**
 * @typedef {import('./docsTypes.js').Document} Document
 * @typedef {import('@/types/models.js').Document} Row
 * @typedef {import('@/utils/documentLinks.js').LinkTree} LinkTree
 */

/**
 * How a sync's document reads its links, either way.
 *
 * @typedef {Object} DocLinks
 * @property {(url: string) => string|null} here - The link here for a Doc's
 *   address, or null for one to leave as it is
 * @property {(href: string) => string|null} there - The Doc's address for a
 *   link to a document here, or null for one with no Doc
 */

/** A Doc's address: its id, and the query and fragment after it. */
const DOC_ADDRESS =
  /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]+)(?:\/[^?#]*)?(\?[^#]*)?(#.*)?$/

/**
 * The address a link to a Doc is written with.
 *
 * @param {import('@/types/models.js').DriveLink} drive
 * @returns {string}
 */
export const addressOf = drive =>
  `https://docs.google.com/document/d/${encodeURIComponent(drive.id)}/edit` +
  (drive.tabId ? `?tab=${encodeURIComponent(drive.tabId)}` : '')

/**
 * The links of one document of a project, either way.
 *
 * @param {LinkTree} tree
 * @param {string} fromId - The document synced
 * @returns {DocLinks}
 */
export function docLinks(tree, fromId) {
  /** @type {Map<string, Row[]>} The documents linked to each Doc, by its id */
  const linked = new Map()
  const visit = (/** @type {string} */ parentId) => {
    for (const child of tree.childrenOf(parentId)) {
      if (child.drive?.id)
        linked.set(child.drive.id, [...(linked.get(child.drive.id) ?? []), child])
      visit(child.id)
    }
  }
  visit(tree.rootId)

  return {
    here(url) {
      const found = DOC_ADDRESS.exec(url)
      if (!found || (found[3] && found[3] !== '#')) return null
      const tab = new URLSearchParams(found[2] ?? '').get('tab')
      const rows = linked.get(found[1]) ?? []
      const row =
        rows.find(each => tab && each.drive?.tabId === tab) ??
        rows.find(each => !tab || !each.drive?.tabId)
      return row ? hrefFor(tree, fromId, row.id) : null
    },
    there(href) {
      if (!isDocumentHref(href)) return null
      const row = resolveLink(tree, href, fromId)
      return row?.drive?.id ? addressOf(row.drive) : null
    },
  }
}

/** None of a document's links go to a Doc, and none of a Doc's come here. */
export const NO_LINKS = /** @type {DocLinks} */ ({ here: () => null, there: () => null })

/**
 * A Doc as read, its links to the Docs of documents here made the links to
 * them: in its runs, and in the styles suggested on them.
 *
 * @param {Document} document
 * @param {DocLinks} links
 * @returns {Document}
 */
export function linksHere(document, links) {
  const out = structuredClone(document)
  eachLink(out, link => {
    const href = typeof link.url === 'string' ? links.here(link.url) : null
    if (href) link.url = href
  })
  return out
}

/**
 * Requests, their links to documents here made the addresses of those
 * documents' Docs. One with none (the writer leaves them out) goes as no
 * link.
 *
 * @param {object[]} requests
 * @param {DocLinks} links
 * @returns {object[]}
 */
export function linksThere(requests, links) {
  const out = structuredClone(requests)
  eachLink(out, (link, holder) => {
    if (typeof link.url !== 'string' || !isDocumentHref(link.url)) return
    const url = links.there(link.url)
    if (url) link.url = url
    else delete holder.link
  })
  return out
}

/**
 * Each link in a Doc or in requests: a `link` with an address.
 *
 * @param {unknown} value
 * @param {(link: {url?: unknown}, holder: {link?: unknown}) => void} visit
 */
function eachLink(value, visit) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach(each => eachLink(each, visit))
    return
  }
  const holder = /** @type {Record<string, unknown>} */ (value)
  for (const [key, each] of Object.entries(holder)) {
    if (key === 'link' && each && typeof each === 'object' && 'url' in each) {
      visit(/** @type {{url?: unknown}} */ (each), holder)
    } else {
      eachLink(each, visit)
    }
  }
}
