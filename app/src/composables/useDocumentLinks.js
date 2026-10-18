/* global Element */
/**
 * @module composables/useDocumentLinks
 * @description Links between a project's documents, followed and made.
 *
 * A link to another document opens it in a tab, as picking it in the outline
 * does; a link to anywhere else opens outside the app, as before. Following
 * one is the editor's Mod-click and its link popover, and a click on a link
 * in a chat. Making one is the link field: a path, a link as it is written,
 * or the name of a document, becomes the link from the document it goes in.
 * Copied, a link goes as a path from the top of the project, and pasted it
 * is written from the document it lands in. See `utils/documentLinks.js`
 * for how a link is written and read.
 */

import { openUrl } from '@/platform/open.js'
import { normalizeHref } from '@/editor/links.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import {
  documentNamed,
  hrefFor,
  isDocumentHref,
  projectHref,
  readableHref,
  resolveLink,
} from '@/utils/documentLinks.js'
import { pictureOf } from '@/utils/pictures.js'
import { useDocuments } from './useDocuments.js'
import { usePictures } from './usePictures.js'
import { useEditorRequest } from './useEditorRequest.js'
import { useToast } from './useToast.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * @param {string} storyId
 * @returns {{
 *   open: (href: string, fromId?: string|null) => void,
 *   target: (href: string, fromId?: string|null) => Document|null,
 *   addressFor: (input: string, fromId: string) => string,
 *   copiedHref: (href: string, fromId: string) => string,
 *   pastedHref: (href: string, toId: string) => string,
 *   onClick: (event: MouseEvent) => void,
 * }}
 */
export function useDocumentLinks(storyId) {
  const api = useDocuments(storyId)
  const toast = useToast()
  const editorRequest = useEditorRequest()

  /** @type {import('@/utils/documentLinks.js').LinkTree} */
  const tree = { get: api.get, childrenOf: api.childrenOf, rootId: rootIdFor(storyId) }

  /**
   * The document a link goes to, if it goes to one that is there.
   * @param {string} href
   * @param {string|null} [fromId] - The document the link is in
   * @returns {Document|null}
   */
  const target = (href, fromId) => resolveLink(tree, href, fromId)

  /** @param {string} href @returns {string} Its `#…`, or nothing */
  const fragmentOf = href => /#.*$/s.exec(href)?.[0] ?? ''

  /**
   * Follow a link: a document opens in a tab, and the editor with it, and a
   * document's own picture at its own size; a web or mail address opens
   * outside the app.
   * @param {string} href
   * @param {string|null} [fromId] - The document the link is in
   */
  const open = (href, fromId) => {
    if (!isDocumentHref(href)) {
      openUrl(href)
      return
    }
    if (pictureOf(href)) {
      usePictures(storyId).open(href, fromId)
      return
    }
    const document = target(href, fromId)
    if (!document) {
      toast.warning(`There is no document at ${readableHref(href)}.`)
      return
    }
    if (document.type === 'folder') {
      toast.info('This link goes to a folder.')
      return
    }
    api.open(document.id, { preview: true })
    editorRequest.show()
  }

  /**
   * What the link field's text becomes as a link in a document. A document
   * it names, by a path from either end or by its name alone, is linked as
   * links are written; a relative path that names nothing is kept as typed;
   * anything else is a web or mail address.
   * @param {string} input
   * @param {string} fromId - The document the link goes in
   * @returns {string}
   */
  const addressFor = (input, fromId) => {
    const text = input.trim()
    if (!isDocumentHref(text)) return normalizeHref(text)
    const found = target(text, fromId) || (text.includes('/') ? null : documentNamed(tree, text))
    if (found) return hrefFor(tree, fromId, found.id) + fragmentOf(text)
    if (/^\.{0,2}\//.test(text)) return text.replace(/\s/g, '%20')
    return normalizeHref(text)
  }

  /**
   * A link as the clipboard carries it: to a document, from the top of the
   * project, so that it goes to the same one pasted anywhere; anything else,
   * and a document's own picture, which is found by its id, as it is.
   *
   * @param {string} href
   * @param {string} fromId - The document it is copied from
   * @returns {string}
   */
  const copiedHref = (href, fromId) => {
    if (!isDocumentHref(href) || pictureOf(href)) return href
    const document = target(href, fromId)
    return document ? projectHref(tree, document.id) + fragmentOf(href) : href
  }

  /**
   * A link from the clipboard, written from the document it is pasted into.
   * One that names no document stays as it came, and still goes to it from
   * the top.
   *
   * @param {string} href
   * @param {string} toId - The document it is pasted into
   * @returns {string}
   */
  const pastedHref = (href, toId) => {
    if (!href.trim().startsWith('/') || !isDocumentHref(href)) return href
    const document = target(href, toId)
    if (!document) return href
    // A link to the document it is in is its place in it, as it was written.
    if (document.id === toId && fragmentOf(href)) return fragmentOf(href)
    return hrefFor(tree, toId, document.id) + fragmentOf(href)
  }

  /**
   * For a click in Markdown the app rendered, such as a chat: a link to a
   * document opens it here, where the page would otherwise go to it and
   * leave the app.
   * @param {MouseEvent} event
   */
  const onClick = event => {
    if (event.defaultPrevented || event.button !== 0) return
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!anchor || /** @type {HTMLElement} */ (anchor).isContentEditable) return
    const href = anchor.getAttribute('href') || ''
    if (!isDocumentHref(href)) return
    event.preventDefault()
    open(href)
  }

  return { open, target, addressFor, copiedHref, pastedHref, onClick }
}
