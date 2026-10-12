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
 * See `utils/documentLinks.js` for how a link is written and read.
 */

import { openUrl } from '@/platform/open.js'
import { normalizeHref } from '@/editor/links.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import {
  documentNamed,
  hrefFor,
  isDocumentHref,
  readableHref,
  resolveLink,
} from '@/utils/documentLinks.js'
import { useDocuments } from './useDocuments.js'
import { useEditorRequest } from './useEditorRequest.js'
import { useToast } from './useToast.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * @param {string} storyId
 * @returns {{
 *   open: (href: string, fromId?: string|null) => void,
 *   target: (href: string, fromId?: string|null) => Document|null,
 *   addressFor: (input: string, fromId: string) => string,
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

  /**
   * Follow a link: a document opens in a tab, and the editor with it; a web
   * or mail address opens outside the app.
   * @param {string} href
   * @param {string|null} [fromId] - The document the link is in
   */
  const open = (href, fromId) => {
    if (!isDocumentHref(href)) {
      openUrl(href)
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
    if (found) return hrefFor(tree, fromId, found.id) + (/#.*$/s.exec(text)?.[0] ?? '')
    if (/^\.{0,2}\//.test(text)) return text.replace(/\s/g, '%20')
    return normalizeHref(text)
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

  return { open, target, addressFor, onClick }
}
