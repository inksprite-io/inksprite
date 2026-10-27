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
import { parseMarkdown } from '@/editor/markdown.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import {
  documentNamed,
  headingHref,
  headingOf,
  hrefFor,
  isDocumentHref,
  ownHref,
  projectHref,
  resolveLink,
} from '@/utils/documentLinks.js'
import { pictureOf } from '@/utils/pictures.js'
import { useDocuments } from './useDocuments.js'
import { useEditor } from './useEditor.js'
import { usePictures } from './usePictures.js'
import { useEditorRequest } from './useEditorRequest.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * A document, or a heading in one, that a link can be made to: what the
 * link field and `[[` offer as the writer types.
 *
 * @typedef {Object} LinkSuggestion
 * @property {string} key
 * @property {string} title - The document's name, or the heading's words
 * @property {string} detail - Where it is: the folders above the document,
 *   or the document the heading is in
 * @property {string} href - The link, from the document it goes in
 * @property {boolean} [heading]
 */

/** The documents' headings as last read, by document, with the text read. */
const headingsRead = new Map()

/**
 * @param {string} storyId
 * @returns {{
 *   open: (href: string, fromId?: string|null) => void,
 *   target: (href: string, fromId?: string|null) => Document|null,
 *   addressFor: (input: string, fromId: string) => string,
 *   copiedHref: (href: string, fromId: string) => string,
 *   pastedHref: (href: string, toId: string) => string,
 *   suggest: (query: string, fromId: string, limit?: number) => LinkSuggestion[],
 *   chatLink: (href: string, words: string) => string|null,
 *   chatPath: (href: string) => string|null,
 *   onClick: (event: MouseEvent) => void,
 * }}
 */
export function useDocumentLinks(storyId) {
  const api = useDocuments(storyId)
  const editor = useEditor()
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
   * outside the app. A link to a folder, or to nothing, does nothing.
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
    if (!document || document.type === 'folder') return
    api.open(document.id, { preview: true })
    const heading = headingOf(href)
    if (heading && document.type === 'text') editorRequest.goToHeading(document.id, heading)
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
   * A link from the clipboard, written from the document it is pasted into,
   * with the app's own address taken off where a browser put it on. One that
   * names no document stays as it came, and still goes to it from the top.
   *
   * @param {string} pasted
   * @param {string} toId - The document it is pasted into
   * @returns {string}
   */
  const pastedHref = (pasted, toId) => {
    const href = ownHref(pasted)
    if (!href.trim().startsWith('/') || !isDocumentHref(href)) return pasted
    const document = target(href, toId)
    if (!document) return pasted
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

  /**
   * The words of a document's headings, in order: as the editor has it, if
   * it is open, or as it was last saved.
   * @param {string} documentId
   * @returns {string[]}
   */
  const headingsOf = documentId => {
    if (api.get(documentId)?.type !== 'text' || api.isPlain(documentId)) return []
    let doc = editor.stateOf(documentId)?.doc
    if (!doc) {
      const content = api.currentContent(documentId)
      const read = headingsRead.get(documentId)
      doc = read?.content === content ? read.doc : parseMarkdown(content)
      headingsRead.set(documentId, { content, doc })
    }
    /** @type {string[]} */
    const out = []
    doc.descendants(node => {
      if (node.type.name === 'heading' && node.textContent.trim()) out.push(node.textContent.trim())
      return !node.isTextblock
    })
    return out
  }

  /**
   * The project's documents a name could be, the likeliest first: named so,
   * then a name starting so, then a word in it, then anywhere in its name or
   * its path. Folders aside, as a link to one goes nowhere. Every document,
   * in the outline's order, for no name.
   * @param {string} name
   * @returns {Document[]}
   */
  const documentsLike = name => {
    const wanted = name.trim().toLowerCase()
    /** @type {Array<{document: Document, rank: number, order: number}>} */
    const found = []
    /** @param {string} parentId */
    const visit = parentId => {
      for (const child of api.childrenOf(parentId)) {
        if (child.type !== 'folder') {
          const title = api.displayTitle(child).toLowerCase()
          const rank = !wanted
            ? 0
            : title === wanted
              ? 0
              : title.startsWith(wanted)
                ? 1
                : title.split(/\s+/).some(word => word.startsWith(wanted))
                  ? 2
                  : title.includes(wanted)
                    ? 3
                    : api.pathOf(child.id).toLowerCase().includes(wanted)
                      ? 4
                      : -1
          if (rank >= 0) found.push({ document: child, rank, order: found.length })
        }
        visit(child.id)
      }
    }
    visit(tree.rootId)
    return found.sort((a, b) => a.rank - b.rank || a.order - b.order).map(each => each.document)
  }

  /**
   * What a link could go to, for what the writer has typed: the documents
   * it could name, or after a `#` the headings of the document named before
   * it, or of this one with nothing before it.
   * @param {string} query
   * @param {string} fromId - The document the link goes in
   * @param {number} [limit]
   * @returns {LinkSuggestion[]}
   */
  const suggest = (query, fromId, limit = 8) => {
    const hash = query.indexOf('#')
    if (hash < 0) {
      return documentsLike(query)
        .slice(0, limit)
        .map(document => ({
          key: document.id,
          title: api.displayTitle(document),
          detail: api.titlesOf(document.id).slice(0, -1).join(' / '),
          href: hrefFor(tree, fromId, document.id),
        }))
    }
    const name = query.slice(0, hash).trim()
    const wanted = query
      .slice(hash + 1)
      .trim()
      .toLowerCase()
    const document = name ? documentsLike(name)[0] : api.get(fromId)
    if (!document) return []
    const path = document.id === fromId ? '' : hrefFor(tree, fromId, document.id)
    return headingsOf(document.id)
      .map((words, at) => ({ words, at }))
      .filter(({ words }) => !wanted || words.toLowerCase().includes(wanted))
      .slice(0, limit)
      .map(({ words, at }) => ({
        key: `${document.id}#${at}`,
        title: words,
        detail: api.displayTitle(document),
        href: path + headingHref(words),
        heading: true,
      }))
  }

  /**
   * A link to a document as a chat's message holds it, pasted or dropped
   * there: Markdown, its words and the document's path from the top of the
   * project as the document tools take it, which both the writer and the
   * model can read. Null for a link to no document of the project's.
   * @param {string} href - From the top of the project, as the clipboard has it
   * @param {string} words
   * @returns {string|null}
   */
  const chatLink = (href, words) => {
    const path = chatPath(href)
    const document = path ? target(href) : null
    if (!path || !document) return null
    const heading = headingOf(href)
    const text = (words || heading || api.displayTitle(document)).replace(/[[\]\\]/g, '\\$&')
    return `[${text}](<${path.replace(/[<>\\]/g, '\\$&')}>)`
  }

  /**
   * A link to a document as the path the document tools take, and a chat's
   * commands, from the top of the project: `/Notes/Cast list`, its heading
   * after a `#`. Null for a link to no document of the project's.
   * @param {string} href - From the top of the project
   * @returns {string|null}
   */
  const chatPath = href => {
    if (!href.trim().startsWith('/') || !isDocumentHref(href) || pictureOf(href)) return null
    const document = target(href)
    if (!document || document.type === 'folder') return null
    const heading = headingOf(href)
    return `/${api.pathOf(document.id)}${heading ? `#${heading}` : ''}`
  }

  return {
    open,
    target,
    addressFor,
    copiedHref,
    pastedHref,
    suggest,
    chatLink,
    chatPath,
    onClick,
  }
}
