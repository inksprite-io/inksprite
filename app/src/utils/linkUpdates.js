/**
 * @module utils/linkUpdates
 * @description Links kept going where they went when the tree changes under
 * them: a document renamed, or moved, or the document a link is in moved, so
 * that a relative path from it means something else.
 *
 * Around a change, every link in the project's text is read once before
 * (`linkTargets`), for the document it goes to, and once after
 * (`relinked`). One that now goes nowhere, or to another document, is
 * written again as a link from where it is to where its document is now
 * (`hrefFor`), or from the top of the project if it was written from the
 * top, with whatever followed its path (`#…`, `?…`) kept. So is one that was
 * written as the app writes it and would be written otherwise now: a link
 * read forgivingly still opens here after a move, from the top of the
 * project, but not in another Markdown editor. A link in a form of the
 * writer's own — a title, a name without its extension — that still goes
 * there is left as it is, and a link to a document that is gone is left
 * alone.
 *
 * Links are found in the markdown as it is written, `[…](…)` and pictures'
 * `![…](…)` alike, since a picture can be a file document of the project's.
 * Only a destination that went to a document is ever written again.
 *
 * Design: `.llm/document_links_design.md`.
 */

import { hrefFor, isDocumentHref, projectHref, resolveLink } from './documentLinks.js'

/** @typedef {import('./documentLinks.js').LinkTree} LinkTree */

/**
 * A document's text, as the links in it are read and written.
 * @typedef {{id: string, content: string}} LinkedText
 */

/**
 * Where a link went: the document, and whether the link was written as the
 * app writes one to it.
 * @typedef {{id: string, exact: boolean}} LinkTarget
 */

/**
 * Where each document's links went: by document, by each destination as it
 * is written.
 * @typedef {Map<string, Map<string, LinkTarget>>} LinkTargets
 */

/**
 * A link's destination in markdown: `<…>`, or a run with balanced
 * parentheses and no spaces; then its title, if it has one, and the
 * bracket that closes it.
 */
const DESTINATION =
  /\]\((<[^>\n]*>|[^\s()<>]*(?:\([^\s()<>]*\)[^\s()<>]*)*)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\))/g

/** Whether there could be a link in a text at all, before looking for one. */
const mayLink = (/** @type {string} */ content) => content.includes('](')

/**
 * Every destination in a text, in order.
 *
 * @param {string} content
 * @returns {string[]}
 */
const destinationsIn = content => [...content.matchAll(DESTINATION)].map(found => found[1])

/**
 * A destination's path, without `<…>` and without what follows it.
 *
 * @param {string} href
 * @returns {{path: string, after: string}}
 */
function partsOf(href) {
  const bare = href.startsWith('<') && href.endsWith('>') ? href.slice(1, -1).trim() : href
  const at = bare.search(/[?#]/)
  return at === -1 ? { path: bare, after: '' } : { path: bare.slice(0, at), after: bare.slice(at) }
}

/**
 * The link the app writes from one document to another: from the top of the
 * project for one written from there, from the linking document otherwise.
 *
 * @param {LinkTree} tree
 * @param {string} path - The link's path as it is written
 * @param {string} fromId
 * @param {string} toId
 * @returns {string}
 */
const canonical = (tree, path, fromId, toId) =>
  path.startsWith('/') ? projectHref(tree, toId) : hrefFor(tree, fromId, toId)

/**
 * Where the links in these documents go now.
 *
 * @param {LinkTree} tree
 * @param {LinkedText[]} documents
 * @returns {LinkTargets}
 */
export function linkTargets(tree, documents) {
  /** @type {LinkTargets} */
  const targets = new Map()
  for (const { id, content } of documents) {
    if (!mayLink(content)) continue
    /** @type {Map<string, LinkTarget>} */
    const went = new Map()
    for (const href of destinationsIn(content)) {
      if (went.has(href) || !isDocumentHref(href)) continue
      const target = resolveLink(tree, href, id)
      const { path } = partsOf(href)
      if (target)
        went.set(href, { id: target.id, exact: path === canonical(tree, path, id, target.id) })
    }
    if (went.size > 0) targets.set(id, went)
  }
  return targets
}

/**
 * What a link should say now, or null when it should stay as it is: it
 * still goes where it went, and in the form it was written in.
 *
 * @param {LinkTree} tree
 * @param {string} href - As it is written
 * @param {string} fromId
 * @param {LinkTarget|undefined} target - Where it went
 * @returns {string|null}
 */
function rewritten(tree, href, fromId, target) {
  if (!target || !tree.get(target.id)) return null
  const { path, after } = partsOf(href)
  const now = canonical(tree, path, fromId, target.id)
  const still = resolveLink(tree, href, fromId)?.id === target.id
  if (still && (!target.exact || path === now)) return null
  return `${now}${after}`
}

/**
 * The documents whose links no longer go where they went, each with its
 * text as it should be now, links written again. Documents with nothing to
 * change are left out.
 *
 * @param {LinkTree} tree - As it is now
 * @param {LinkedText[]} documents - As they are now
 * @param {LinkTargets} targets - Where their links went, from `linkTargets`
 * @returns {LinkedText[]}
 */
export function relinked(tree, documents, targets) {
  /** @type {LinkedText[]} */
  const changed = []
  for (const { id, content } of documents) {
    const went = targets.get(id)
    if (!went) continue
    /** @type {Map<string, string|null>} */
    const now = new Map()
    const written = content.replace(DESTINATION, (whole, href, rest) => {
      if (!now.has(href)) now.set(href, rewritten(tree, href, id, went.get(href)))
      const replacement = now.get(href)
      return replacement ? `](${replacement}${rest}` : whole
    })
    if (written !== content) changed.push({ id, content: written })
  }
  return changed
}
