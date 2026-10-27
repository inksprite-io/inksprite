/* global Blob, ClipboardItem */
/**
 * @module composables/useCopyLink
 * @description Copy a link to a document, or a link in one, to the clipboard.
 *
 * A link to a document goes as two things at once: a link, its words the
 * document's name, for the editor and the chat to paste as a link to it, and
 * its path (`Characters/Elara`, the one address the AI tools take) as plain
 * text, for anywhere else. Any other link goes as its address. The outline's
 * menu, the tab strip's, the editor's and its link popover all copy this way.
 */

import { rootIdFor } from '@/stores/migrations/projectTree.js'
import {
  headingHref,
  headingOf,
  isDocumentHref,
  projectHref,
  resolveLink,
} from '@/utils/documentLinks.js'
import { pictureOf } from '@/utils/pictures.js'
import { useDocuments } from './useDocuments.js'
import { useToast } from './useToast.js'

/**
 * @param {string} storyId
 * @returns {{
 *   linkFor: (documentId: string, heading?: string, words?: string) => {text: string, html: string}|null,
 *   copyLink: (documentId: string, heading?: string, words?: string) => Promise<void>,
 *   copyHref: (href: string, fromId: string, words?: string) => Promise<void>,
 * }}
 */
export function useCopyLink(storyId) {
  const api = useDocuments(storyId)
  const toast = useToast()

  /** @type {import('@/utils/documentLinks.js').LinkTree} */
  const tree = { get: api.get, childrenOf: api.childrenOf, rootId: rootIdFor(storyId) }

  /**
   * Put text on the clipboard, and a link beside it where there is one, and
   * say so in a word: it was asked for from a menu that closes, and a
   * clipboard shows nothing.
   *
   * @param {string} text
   * @param {string} [html]
   */
  const write = async (text, html) => {
    try {
      if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(text)
      }
      toast.success('Copied', { duration: 2000 })
    } catch (error) {
      console.error('Failed to copy a link:', error)
      toast.error('Could not copy the link. The browser did not allow it here.')
    }
  }

  /**
   * A link to a document, or to a heading in it, as the clipboard carries
   * it, and a drag from the outline: its path as text, and a link.
   * @param {string} documentId
   * @param {string} [heading] - The heading's words
   * @param {string} [words] - The link's own; the document's name otherwise
   * @returns {{text: string, html: string}|null}
   */
  const linkFor = (documentId, heading = '', words = '') => {
    const document = api.get(documentId)
    const path = api.pathOf(documentId)
    if (!document || !path) return null
    const href = projectHref(tree, documentId) + (heading ? headingHref(heading) : '')
    const text = (words || heading || api.displayTitle(document)).trim()
    return {
      text: heading ? `${path}#${heading}` : path,
      html: `<a href="${escape(href)}">${escape(text)}</a>`,
    }
  }

  /**
   * A link to a document, or to a heading in it.
   * @param {string} documentId
   * @param {string} [heading]
   * @param {string} [words]
   */
  const copyLink = async (documentId, heading = '', words = '') => {
    const link = linkFor(documentId, heading, words)
    if (link) await write(link.text, link.html)
  }

  /**
   * A link as a document has it: one to a document as `copyLink` copies it,
   * with the link's words; any other as its address.
   * @param {string} href
   * @param {string} fromId - The document it is in
   * @param {string} [words]
   */
  const copyHref = async (href, fromId, words = '') => {
    const document =
      isDocumentHref(href) && !pictureOf(href) ? resolveLink(tree, href, fromId) : null
    if (document && document.type !== 'folder') {
      await copyLink(document.id, headingOf(href), words)
      return
    }
    if (href) await write(href)
  }

  return { linkFor, copyLink, copyHref }
}

/**
 * Text as it is safe in HTML.
 * @param {string} text
 * @returns {string}
 */
const escape = text =>
  text.replace(
    /[&<>"]/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character
  )
