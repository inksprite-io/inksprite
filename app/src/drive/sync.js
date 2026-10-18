/**
 * @module drive/sync
 * @description A linked document and its Google Doc made one: what each
 * side changed since the two last agreed goes into the Doc, and what the
 * Doc then holds comes back into the document.
 *
 * A sync reads, merges, writes, and reads again. The Doc is read through
 * the Docs API and put in the document's form, each of its pictures by the
 * name the document knows it by; one new to the document is fetched and
 * named, and one that will not come is left out, as the converter leaves
 * out what it holds. The document and the Doc are merged three ways against
 * the base, the Doc as the two last agreed (`drive/merge`). Where both
 * changed the same words, the writer chooses, and the Doc is read again
 * after, since a revision is written against only for minutes. With no
 * base, the writer chooses a side for the whole document, unless it is
 * empty or the two already say the same. What the Doc lacks of the merge
 * is written to it at once (`drive/write`), against the revision just read,
 * so that Google merges in whatever a collaborator typed since; a write
 * refused as too late starts again from the read.
 *
 * The Doc is read once more after the write, as the new base. The document
 * becomes the merge, with what was typed in it while the sync ran kept, and
 * with whatever the Doc then holds that the write did not put there: what
 * Google merged in from a collaborator, which the Doc as read with the
 * write applied to it (`drive/apply`) tells from what the write sent. So
 * nothing the Doc cannot hold, a picture added here among it, is taken
 * back out of the document.
 *
 * Design: `.llm/google_docs_design.md`, part 3, Sync.
 */

import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { nameKey } from '@/storage/names.js'
import { pictureHref, pictureName, pictureOf } from '@/utils/pictures.js'
import { readDocument, writeDocument } from './api.js'
import { applyRequests } from './apply.js'
import { readDoc, tabsOf } from './convert.js'
import { DriveError, StaleRevisionError } from './errors.js'
import { DOC_TYPE, fetchDocPictures } from './fetch.js'
import { mergeDocs, sameDocs, settle } from './merge.js'
import { writeDoc } from './write.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('./docsTypes.js').Document} Document
 * @typedef {import('./merge.js').Clash} Clash
 * @typedef {import('@/types/models.js').PictureInfo} PictureInfo
 * @typedef {'mine'|'theirs'} Side
 */

/**
 * The document to sync, and what is known of it.
 *
 * @typedef {Object} Linked
 * @property {string} documentId
 * @property {import('@/types/models.js').DriveLink} link
 * @property {import('@/types/models.js').DocBase|null} base - None for a
 *   first sync, or one kept for another Doc
 * @property {Record<string, PictureInfo>} pictures - Its pictures, as its row has them
 * @property {() => Node} current - The document as it stands: read before
 *   the merge, and again at the end for what was typed while the sync ran
 * @property {(pictures: NewPicture[]) => Promise<void>} keep - Make the Doc's
 *   pictures new to the document its own, before the document is read at
 *   the end, so that nothing typed is waited past
 */

/**
 * What the sync asks the writer.
 *
 * @typedef {Object} Questions
 * @property {() => Promise<Side|null>} first - With no base: which side's
 *   text the two are to have. Null cancels the sync
 * @property {(clashes: Clash[]) => Promise<Side[]|null>} clashes - Where both
 *   changed the same words: which side's, for each. Null cancels the sync
 */

/**
 * A picture of the Doc's that is new to the document, named for it.
 *
 * @typedef {Object} NewPicture
 * @property {string} name
 * @property {string} docsId - Its inline object's id
 * @property {string} mime
 * @property {Uint8Array} bytes
 */

/**
 * The base a sync leaves: the Doc as the two now agree.
 *
 * @typedef {Object} NewBase
 * @property {string} revisionId
 * @property {string} tabId
 * @property {string} markdown
 * @property {Record<string, string>} pictures - The names its pictures go by, by the Doc's ids
 * @property {string[]} held - The Doc's pictures the document turned down, by id
 */

/**
 * A sync done.
 *
 * @typedef {Object} Synced
 * @property {Node} doc - The document as it is to be now, to be put in
 *   place before anything else is typed in it
 * @property {NewBase} base
 * @property {number} sent - The edits written to the Doc
 * @property {boolean} changed - Whether `doc` differs from the document
 * @property {number} unsent - The document's own pictures the Doc lacks:
 *   added here, as nothing can send one yet
 */

/** Why a Doc of several tabs, linked to none of them, is not synced. */
const SEVERAL_TABS = 'This Doc has several tabs, and Sync can’t choose between them yet.'

/**
 * What the writer could not send, the most telling first.
 *
 * @type {import('./write.js').Unsent[]}
 */
const ORDER = ['suggestion', 'held', 'merged', 'table', 'footnote', 'list', 'layout']

/** How many writes refused as too late a sync makes before it stops. */
const TRIES = 3

/**
 * What the writer could not send, said for the writer.
 *
 * @type {Record<import('./write.js').Unsent, string>}
 */
const UNSENT = {
  table:
    'Sync can’t send this change to a table to Google Docs yet, such as one to a table inside a table.',
  merged: 'Sync can’t change the rows or columns of a table with merged cells in Google Docs yet.',
  held: 'Part of a table deleted here has a picture or a drawing in the Doc. Delete that part in Google Docs, then sync again.',
  list: 'Sync can’t send a list item’s new kind or nesting to Google Docs yet.',
  footnote: 'Sync can’t add or remove footnotes in Google Docs yet.',
  suggestion:
    'The Doc has suggested edits open where this document changed. Accept or reject them in Google Docs, then sync again.',
  layout: 'Sync can’t send part of this document to Google Docs yet, such as a heading in a list.',
}

/**
 * Sync a linked document with its Doc.
 *
 * @param {Linked} linked
 * @param {string} token
 * @param {Object} options
 * @param {Questions} options.ask
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Synced|null>} Null when the writer cancelled
 * @throws {DriveError} When Google refuses, or the Doc cannot take the
 *   document's changes; nothing is written then
 */
export async function syncDoc(linked, token, { ask, signal }) {
  const { link } = linked
  const base = linked.base?.docId === link.id ? linked.base : null
  const tabId = link.tabId ?? base?.tabId
  const agreed = base ? parseMarkdown(base.markdown) : null
  const pictures = new Pictures(linked.documentId, linked.pictures, base)
  /** @type {Map<string, Side>} The writer's choices, by the clash. */
  const chosen = new Map()
  /** @type {Side|null} */
  let whole = null
  let tries = 0

  for (;;) {
    signal?.throwIfAborted()
    const mine = linked.current()
    const document = await readDocument(link.id, token, { signal })
    // One imported by its export may have been all its tabs at once.
    if (tabId === undefined && tabsOf(document).length > 1) throw new DriveError(SEVERAL_TABS)
    await pictures.fetchNew(link.id, token, document, tabId, signal)
    const theirs = pictures.read(document, tabId)

    /** @type {Node} */
    let target
    if (!agreed) {
      whole ??= isEmpty(mine) ? 'theirs' : sameDocs(mine, theirs.doc) ? 'mine' : null
      if (!whole) {
        whole = await ask.first()
        if (!whole) return null
        // Read again: the answer may have taken longer than a revision lasts.
        continue
      }
      // The Doc's text, with the document's comments kept where their words are.
      target = whole === 'mine' ? mine : settle(mergeDocs(mine, mine, theirs.doc))
    } else {
      const merged = mergeDocs(agreed, mine, theirs.doc)
      const keys = merged.clashes.map(clashKey)
      if (keys.some(key => !chosen.has(key))) {
        const choices = await ask.clashes(merged.clashes)
        if (!choices) return null
        keys.forEach((key, i) => chosen.set(key, choices[i] ?? 'mine'))
        continue
      }
      target = settle(
        merged,
        keys.map(key => /** @type {Side} */ (chosen.get(key)))
      )
    }

    pictures.holdUnused(target)
    const written = writeDoc(document, target, {
      tabId: theirs.tabId,
      pictures: pictures.known(target),
    })
    // The likeliest cause first: a table added also leaves nowhere for what follows it.
    const unsent = ORDER.find(kind => written.unsent.includes(kind))
    if (unsent) throw new DriveError(UNSENT[unsent])
    let expected = theirs.doc
    let after = theirs
    if (written.requests.length > 0) {
      expected = pictures.read(
        applyRequests(document, written.requests, { tabId: theirs.tabId }),
        tabId
      ).doc
      try {
        await writeDocument(link.id, written.requests, written.revisionId, token, { signal })
      } catch (error) {
        if (error instanceof StaleRevisionError && ++tries < TRIES) continue
        throw error
      }
      after = pictures.read(await readDocument(link.id, token, { signal }), tabId)
    }

    await linked.keep(pictures.newIn(target))
    // What was typed while the sync ran, and what Google merged in between
    // the read and the write, each kept.
    const now = linked.current()
    let doc = now.eq(mine) ? target : settle(mergeDocs(mine, now, target))
    if (!sameDocs(after.doc, expected)) doc = settle(mergeDocs(expected, doc, after.doc))
    return {
      doc,
      base: {
        revisionId: after.revisionId,
        tabId: after.tabId,
        markdown: after.markdown,
        pictures: pictures.namesIn(after.doc),
        held: pictures.stillHeld(),
      },
      sent: written.requests.length,
      changed: !doc.eq(now),
      unsent: pictures.onlyIn(doc, after.doc),
    }
  }
}

/**
 * Whether a document holds nothing: one empty textblock.
 *
 * @param {Node} doc
 */
const isEmpty = doc =>
  doc.childCount === 1 && !!doc.firstChild?.isTextblock && doc.firstChild.content.size === 0

/**
 * A clash, known again when a fresh read gives the same one.
 *
 * @param {Clash} clash
 * @returns {string}
 */
const clashKey = clash =>
  JSON.stringify([clash.base, clash.mine, clash.theirs].map(blocks => blocks.map(b => b.toJSON())))

/**
 * A Doc in the document's form.
 *
 * @typedef {Object} DocForm
 * @property {Node} doc
 * @property {string} markdown
 * @property {string} revisionId
 * @property {string} tabId
 */

/**
 * The Doc's pictures as the document knows them, for one sync: each by the
 * name its row has for the Doc's id, or the base's, or one given it when it
 * is fetched, new to the document. One the document turned down, keeping
 * its own words over the Doc's around it, is held from then on, as one the
 * document never had: it stays in the Doc and out of the document.
 */
class Pictures {
  /**
   * @param {string} documentId
   * @param {Record<string, PictureInfo>} row - The document's, by name
   * @param {import('@/types/models.js').DocBase|null} base
   */
  constructor(documentId, row, base) {
    this.documentId = documentId
    this.row = row
    /** @type {Record<string, string>} The base's names, by the Doc's ids. */
    this.base = base?.pictures ?? {}
    /** @type {Map<string, string>} Names, by the Doc's ids. */
    this.names = new Map()
    for (const [name, info] of Object.entries(row)) {
      if (info.docsId) this.names.set(info.docsId, name)
    }
    /** The Doc's ids the document has bytes for. */
    this.owned = new Set(this.names.keys())
    /** @type {Set<string>} Names in use, as `nameKey` has them. */
    this.taken = new Set([...Object.keys(row), ...Object.values(this.base)].map(nameKey))
    /** @type {Map<string, NewPicture>} Those fetched, by the Doc's id. */
    this.fetched = new Map()
    /** @type {Set<string>} Those that would not come. */
    this.missing = new Set()
    /** @type {Set<string>} Those the document turned down. */
    this.held = new Set(base?.held ?? [])
    /** @type {Set<string>} The Doc's, by id, in the read last put in form. */
    this.seen = new Set()
  }

  /**
   * Fetch the Doc's pictures the document has no bytes for, and name them:
   * by the base's name for one the base had, which keeps them the same
   * picture to the merge.
   *
   * @param {string} docId
   * @param {string} token
   * @param {Document} document
   * @param {string|undefined} tabId
   * @param {AbortSignal} [signal]
   */
  async fetchNew(docId, token, document, tabId, signal) {
    const read = readDoc(document, { tabId })
    const wanted = new Set(
      read.pictures
        .map(each => each.object)
        .filter(
          id =>
            !this.owned.has(id) &&
            !this.held.has(id) &&
            !this.fetched.has(id) &&
            !this.missing.has(id)
        )
    )
    if (wanted.size === 0) return
    const picked = { id: docId, name: docId, mimeType: DOC_TYPE }
    const got = await fetchDocPictures(picked, token, document, read, { wanted, signal })
    for (const id of wanted) {
      const picture = got.get(id)
      if (!picture) {
        this.missing.add(id)
        continue
      }
      // The base's name, unless the document has since given it to another.
      const named = this.base[id]
      const name =
        named && !(named in this.row) ? named : pictureName('image', picture.mime, this.taken)
      this.names.set(id, name)
      this.fetched.set(id, { name, docsId: id, ...picture })
    }
  }

  /**
   * A Doc read into the document's form: its pictures by their names, those
   * with none, or held, left out.
   *
   * @param {Document} document
   * @param {string|undefined} tabId
   * @returns {DocForm}
   */
  read(document, tabId) {
    let read = readDoc(document, { tabId })
    this.seen = new Set(read.pictures.map(each => each.object))
    const out = [...this.seen].filter(id => !this.names.has(id) || this.held.has(id))
    if (out.length > 0) read = readDoc(document, { tabId, leaveOut: new Set(out) })
    let text = read.markdown
    for (const each of read.pictures) {
      const href = pictureHref(this.documentId, /** @type {string} */ (this.names.get(each.object)))
      text = text.split(`](${each.marker})`).join(`](${href})`)
    }
    const doc = parseMarkdown(text)
    return { doc, markdown: serializeMarkdown(doc), revisionId: read.revisionId, tabId: read.tabId }
  }

  /**
   * Hold those fetched that the document is not to have: from here on they
   * are the Doc's alone.
   *
   * @param {Node} target - The document as it is to be
   */
  holdUnused(target) {
    const used = this.#namesUsed(target)
    for (const picture of this.fetched.values()) {
      if (!used.has(picture.name)) this.held.add(picture.docsId)
    }
  }

  /**
   * The pictures the writer knows the Doc's ids of: the row's, the base's,
   * and those fetched that the document is to have. One fetched that it is
   * not to have stays in the Doc, as one the document never had does.
   *
   * @param {Node} target
   * @returns {Record<string, PictureInfo>}
   */
  known(target) {
    /** @type {Record<string, PictureInfo>} */
    const out = {}
    for (const [id, name] of Object.entries(this.base)) out[name] = { mime: '', docsId: id }
    const used = this.#namesUsed(target)
    for (const picture of this.fetched.values()) {
      if (used.has(picture.name)) out[picture.name] = { mime: picture.mime, docsId: picture.docsId }
    }
    return { ...out, ...this.row }
  }

  /**
   * The pictures fetched that a document has.
   *
   * @param {Node} doc
   * @returns {NewPicture[]}
   */
  newIn(doc) {
    const used = this.#namesUsed(doc)
    return [...this.fetched.values()].filter(picture => used.has(picture.name))
  }

  /**
   * The names a document's pictures from the Doc go by, by the Doc's ids.
   *
   * @param {Node} doc
   * @returns {Record<string, string>}
   */
  namesIn(doc) {
    const used = this.#namesUsed(doc)
    /** @type {Record<string, string>} */
    const out = {}
    for (const [id, name] of this.names) if (used.has(name)) out[id] = name
    return out
  }

  /**
   * How many of the document's own pictures one document has that another,
   * the Doc in the document's form, does not.
   *
   * @param {Node} doc
   * @param {Node} theirs
   */
  onlyIn(doc, theirs) {
    const there = this.#namesUsed(theirs)
    return [...this.#namesUsed(doc)].filter(name => !there.has(name)).length
  }

  /**
   * Those held that the Doc read last still has.
   *
   * @returns {string[]}
   */
  stillHeld() {
    return [...this.held].filter(id => this.seen.has(id))
  }

  /**
   * The names of the document's own pictures a document refers to.
   *
   * @param {Node} doc
   * @returns {Set<string>}
   */
  #namesUsed(doc) {
    /** @type {Set<string>} */
    const out = new Set()
    doc.descendants(node => {
      if (node.type.name !== 'image') return true
      const picture = pictureOf(node.attrs.src)
      if (picture?.documentId === this.documentId) out.add(picture.name)
      return false
    })
    return out
  }
}
