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
 * changed the same words, the document's win, as the device that syncs last
 * wins in sync between devices, and the Doc's text as it was read is handed
 * back to be kept as a version. With no base, the document is taken whole,
 * unless it is empty, and the Doc's text is handed back the same way if it
 * said something else. What the Doc lacks of the merge
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
 * The comments cross once the words have (`drive/comments`): the document's
 * new comments, replies, resolves and reopens to the Doc, against the Doc as
 * the words left it, then the Doc's into the document as it is to be, with
 * nothing awaited between its last read and the result.
 *
 * The Doc's suggested edits are the document's suggestions too
 * (`drive/suggestions`). Those settled here are settled in the Doc first,
 * and those whose words were changed here are changed there to match; the
 * words are synced as they stand on both sides, every suggestion rejected;
 * then the Doc's are laid into the document again from the Doc as the words
 * left it. The base keeps them, so that one accepted here is made
 * in it as it is in the Doc. The model's go to the Doc as suggestions after
 * the words, one at a time, and come back as the Doc's; one the Doc can't
 * take stays here.
 *
 * A document not linked to a Doc goes into a new one: an empty Doc made in
 * the writer's Drive, then synced, the first sync taking the document whole.
 * Whether the writer can send all of it is asked of an empty Doc first, so
 * no Doc is made for a document that could not go into it.
 *
 * Design: `.llm/google_docs_design.md`, part 3, Sync.
 */

import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { newSuggestionId, seeing } from '@/editor/suggestions.js'
import { nameKey } from '@/storage/names.js'
import { diffSequences } from '@/utils/diff.js'
import { pictureHref, pictureName, pictureOf } from '@/utils/pictures.js'
import { readDocument, writeDocument } from './api.js'
import { applyBatch, applyRequests } from './apply.js'
import { answersToSend, commentsIn, commentsToMake, withMade } from './comments.js'
import { readDoc, tabsOf } from './convert.js'
import { DriveError, StaleRevisionError } from './errors.js'
import { DOC_TYPE, fetchDocPictures } from './fetch.js'
import { keyOf, mergeDocs, sameDocs, settle } from './merge.js'
import {
  besideRequests,
  layOwn,
  laySuggestions,
  ownSuggestions,
  rewriteRequests,
  rewritesOf,
  settlesToSend,
  suggestionIds,
  suggestionThreads,
  takenOver,
  wholeBlock,
} from './suggestions.js'
import { withoutIdleStyles, writeDoc } from './write.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('./docsTypes.js').Document} Document
 * @typedef {import('@/types/models.js').PictureInfo} PictureInfo
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
 * @property {() => Threads} threads - Its comment threads as they stand: read
 *   with the document, as it is
 */

/** @typedef {Record<string, import('@/types/models.js').CommentThread>} Threads */

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
 * @property {Threads} threads - The document's comment threads, to go on its
 *   row with `doc`
 * @property {{came: number, tooLong: number, sent: number, changed: number}} comments -
 *   The Doc's posts that came in; the document's comments too long for
 *   Docs, not sent; what of the comments went to the Doc; and what of them
 *   the Doc changed here
 * @property {{came: number, settled: number, changed: number, sent: number}} suggestions -
 *   The Doc's suggestions new here; those settled here that were settled in
 *   the Doc; what of them the Doc changed here, replies among it; and the
 *   model's sent to the Doc as suggestions
 * @property {number} sent - The edits written to the Doc
 * @property {import('./write.js').Unsent[]} left - What kinds of change the
 *   document has that the writer can't send yet, and stay here
 * @property {boolean} changed - Whether `doc` differs from the document
 * @property {number} unsent - The document's own pictures the Doc lacks:
 *   added here, as nothing can send one yet
 * @property {string|null} lost - The Doc's text as it was read, Markdown,
 *   when words of it gave way to the document's: to keep as a version
 */

/** Why a Doc of several tabs, linked to none of them, is not synced. */
const SEVERAL_TABS = 'This Doc has several tabs, and Sync can’t choose between them yet.'

/** How many writes refused as too late a sync makes before it stops. */
const TRIES = 3

/**
 * The Doc's suggestions changed as they were here: the words going in beside
 * one of a letter put in as the writer's suggestion first, then each
 * rewritten in place against the Doc as read after.
 *
 * @param {string} docId
 * @param {Document} document - The Doc as read
 * @param {string|undefined} tabId
 * @param {import('./suggestions.js').Rewrite[]} rewrites
 * @param {string} token
 * @param {AbortSignal|undefined} signal
 * @returns {Promise<Document>} The Doc as read after
 */
async function rewriteSuggestions(docId, document, tabId, rewrites, token, signal) {
  let read = document
  const beside = besideRequests(read, tabId, rewrites)
  if (beside.length > 0) {
    await writeDocument(docId, beside, read.revisionId ?? null, token, { signal, suggest: true })
    read = await readDocument(docId, token, { signal })
  }
  const requests = rewriteRequests(read, tabId, rewrites)
  if (requests.length > 0) {
    await writeDocument(docId, requests, read.revisionId ?? null, token, { signal })
    read = await readDocument(docId, token, { signal })
  }
  return read
}

/**
 * The writer's requests for as much of the document as it can send: each
 * run of blocks changed that it can't send yet (a footnote put in or taken
 * out, a list item's kind or nesting, a table with merged cells reshaped,
 * words beside a newline or a style suggested in the Doc, …) left as the
 * Doc has it, tried run by run, so that the rest goes. What is left stays in
 * the document, and goes once it can.
 *
 * @param {Document} document - The Doc as read
 * @param {Node} theirs - The same in the document's form
 * @param {Node} target
 * @param {{tabId: string, pictures: Record<string, PictureInfo>}} options
 * @returns {{written: import('./write.js').Written, left: import('./write.js').Unsent[]}}
 */
function sendable(document, theirs, target, options) {
  const whole = writeDoc(document, target, options)
  if (whole.unsent.length === 0) return { written: whole, left: [] }
  /** @param {Node} doc */
  const blocks = doc => /** @type {Node[]} */ (doc.content.content)
  const [from, to] = [blocks(theirs), blocks(target)]
  /** @type {Array<{same: Node[]}|{theirs: Node[], ours: Node[]}>} */
  const parts = []
  for (const step of diffSequences(from.map(keyOf), to.map(keyOf)) ?? []) {
    const last = parts.at(-1)
    if (step.op === 'equal') {
      if (last && 'same' in last) last.same.push(to[step.b])
      else parts.push({ same: [to[step.b]] })
      continue
    }
    const run = last && 'ours' in last ? last : { theirs: [], ours: [] }
    if (run !== last) parts.push(run)
    if (step.op === 'delete') run.theirs.push(from[step.a])
    else run.ours.push(to[step.b])
  }
  /** @param {Set<object>} taken */
  const made = taken => {
    const content = parts.flatMap(part =>
      'same' in part ? part.same : taken.has(part) ? part.ours : part.theirs
    )
    return target.type.create(
      null,
      content.length > 0 ? content : [target.type.schema.nodes.paragraph.create()]
    )
  }
  /** @type {Set<object>} */
  const taken = new Set()
  /** @type {Set<import('./write.js').Unsent>} */
  const left = new Set()
  let written = writeDoc(document, made(taken), options)
  for (const part of parts) {
    if ('same' in part) continue
    const tried = writeDoc(document, made(new Set([...taken, part])), options)
    if (tried.unsent.length > 0) {
      tried.unsent.forEach(kind => left.add(kind))
      console.warn('Sync leaves here what Google Docs can’t take yet:', tried.unsent)
      continue
    }
    taken.add(part)
    written = tried
  }
  return { written, left: [...left] }
}

/**
 * The model's suggestions written to the Doc as suggestions, one at a time:
 * the Doc as it stands with that one made, against the Doc as read last,
 * sent in Suggesting mode, then read again for the suggestion Docs made of
 * it. One the Doc can't take (`writeDoc`'s unsent), whose words the Doc
 * changed meanwhile, or that changes style or puts in or takes out a
 * paragraph's end, stays here; so does any after a write that failed, which
 * the next sync tries again. A change of style would be a suggestion of
 * style in the Doc, which no sync lays in here, so it would be sent again
 * each time; a newline suggested holds the writer off its paragraphs.
 *
 * @param {string} docId
 * @param {Document} document - The Doc as read last
 * @param {Object} given
 * @param {Node} given.shown - The document, its suggestions in it
 * @param {Node} given.mine - The document as it stands
 * @param {string[]} given.ids - The model's suggestions, by their ids here
 * @param {string|undefined} given.tabId
 * @param {Pictures} given.pictures
 * @param {string} given.token
 * @param {AbortSignal|undefined} given.signal
 * @returns {Promise<{document: Document, links: Record<string, string>}>} The
 *   Doc as read last, and the Doc's id for each sent, by its id here
 */
async function suggestOwn(docId, document, { shown, mine, ids, tabId, pictures, token, signal }) {
  let read = document
  /** @type {Record<string, string>} */
  const links = {}
  for (const id of ids) {
    if (wholeBlock(shown, id)) {
      console.warn('A suggestion of the model’s stays here, a paragraph put in or taken out:', id)
      continue
    }
    const merged = mergeDocs(mine, seeing(shown, [id]).doc, pictures.read(read, tabId).doc)
    if (merged.clashes.length > 0) continue
    const target = settle(merged)
    pictures.holdUnused(target)
    const written = writeDoc(read, target, { tabId, pictures: pictures.known(target) })
    if (written.unsent.length > 0 || written.requests.length === 0) {
      console.warn('A suggestion of the model’s stays here:', id, written.unsent)
      continue
    }
    const requests = withoutIdleStyles(read, written.requests, tabId)
    if (!changesWords(read, requests, tabId)) {
      console.warn(
        'A suggestion of the model’s stays here, a change of style or of paragraphs:',
        id
      )
      continue
    }
    const before = new Set(readDoc(read, { tabId }).suggested)
    try {
      await writeDocument(docId, requests, written.revisionId, token, { signal, suggest: true })
      read = await readDocument(docId, token, { signal })
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn('The model’s suggestions stay here from', id, error)
      break
    }
    const made = readDoc(read, { tabId }).suggested.find(each => !before.has(each))
    if (made) links[id] = made
  }
  return { document: read, links }
}

/**
 * Whether requests, made as a suggestion, only put words in and take them
 * out within paragraphs, styling none but those they put in: as the Doc
 * standing in makes a suggestion, which refuses anything else. A newline
 * suggested keeps the writer from the paragraphs either side of it until it
 * is settled, so one isn't sent.
 *
 * @param {Document} document
 * @param {object[]} requests
 * @param {string|undefined} tabId
 * @returns {boolean}
 */
function changesWords(document, requests, tabId) {
  if (!requests.some(request => 'insertText' in request || 'deleteContentRange' in request)) {
    return false
  }
  const probe = 'suggest.probe'
  let made
  try {
    made = applyBatch(document, requests, { tabId, suggest: probe }).document
  } catch {
    return false
  }
  const tab = tabsOf(made).find(each => !tabId || each.tabProperties?.tabId === tabId)
  /** @param {import('./docsTypes.js').StructuralElement[]} content @returns {boolean} */
  const newline = content =>
    content.some(
      element =>
        element.paragraph?.elements?.some(
          part =>
            part.textRun?.content?.includes('\n') &&
            [
              ...(part.textRun.suggestedInsertionIds ?? []),
              ...(part.textRun.suggestedDeletionIds ?? []),
            ].includes(probe)
        ) ||
        element.table?.tableRows?.some(row =>
          row.tableCells?.some(cell => newline(cell.content ?? []))
        )
    )
  return !newline(tab?.documentTab?.body?.content ?? [])
}

/**
 * A new suggestion id, not one of the threads'.
 *
 * @param {Threads} threads
 * @returns {string}
 */
function freshId(threads) {
  let id = newSuggestionId()
  while (threads[id]) id = newSuggestionId()
  return id
}

/**
 * Threads with the links to the Doc's suggestions the model's became.
 *
 * @param {Threads} threads
 * @param {Record<string, string>} links - The Doc's ids, by the ids here
 * @param {string} docId
 * @returns {Threads}
 */
function linkedTo(threads, links, docId) {
  if (Object.keys(links).length === 0) return threads
  return Object.fromEntries(
    Object.entries(threads).map(([id, thread]) => [
      id,
      links[id] ? { ...thread, google: { doc: docId, id: links[id], status: 'open' } } : thread,
    ])
  )
}

/**
 * Sync a linked document with its Doc.
 *
 * @param {Linked} linked
 * @param {string} token
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<Synced>}
 * @throws {DriveError} When Google refuses, or the Doc cannot take the
 *   document's changes; nothing is written then
 */
export async function syncDoc(linked, token, { signal } = {}) {
  const { link } = linked
  const base = linked.base?.docId === link.id ? linked.base : null
  const tabId = link.tabId ?? base?.tabId
  const pictures = new Pictures(linked.documentId, linked.pictures, base)
  let tries = 0

  const laidBefore = base ? parseMarkdown(base.markdown) : null
  /** @type {Document|null} */
  let fresh = await readDocument(link.id, token, { signal })
  // The Doc's suggestions changed here, to be changed there to match; one
  // that can't be stops the sync before anything is written.
  const { rewrites, stuck } = laidBefore
    ? rewritesOf({
        doc: linked.current(),
        agreed: laidBefore,
        threads: linked.threads(),
        docId: link.id,
        document: fresh,
        tabId,
      })
    : { rewrites: [], stuck: [] }
  // Those that can't be changed in place: rejected there, and the words here
  // a suggestion of the writer's own, which goes as the model's do.
  const swaps = new Map(stuck.map(id => [id, freshId(linked.threads())]))
  const at = Date.now()
  /** The document and its threads, those it can't be given taken over. */
  const current = () => takenOver(linked.current(), linked.threads(), swaps, at)
  // The Doc's suggestions settled here, settled there first, so that the
  // words compare as both now have them.
  const settles = settlesToSend({
    open: new Set(readDoc(fresh, { tabId }).suggested),
    threads: current().threads,
    docId: link.id,
  })
  if (settles.requests.length > 0) {
    await writeDocument(link.id, settles.requests, null, token, { signal })
    fresh = await readDocument(link.id, token, { signal })
  }
  if (rewrites.length > 0) {
    fresh = await rewriteSuggestions(link.id, fresh, tabId, rewrites, token, signal)
  }
  // As the two agree now: the suggestions accepted here made in it, as they
  // now are in the Doc, and every other rejected.
  const agreed = laidBefore ? seeing(laidBefore, settles.accepted).doc : null

  for (;;) {
    signal?.throwIfAborted()
    const { doc: shown, threads: had } = current()
    // The words as they stand: the Doc's suggestions are laid in again after.
    const mine = seeing(shown, []).doc
    const document = fresh ?? (await readDocument(link.id, token, { signal }))
    fresh = null
    // One imported by its export may have been all its tabs at once.
    if (tabId === undefined && tabsOf(document).length > 1) throw new DriveError(SEVERAL_TABS)
    await pictures.fetchNew(link.id, token, document, tabId, signal)
    const theirs = pictures.read(document, tabId)

    /** @type {Node} */
    let target
    /** Whether words of the Doc's gave way to the document's. */
    let gave
    if (!agreed) {
      // An empty document takes the Doc's text, and any other is the Doc's now.
      target = isEmpty(mine) ? settle(mergeDocs(mine, mine, theirs.doc)) : mine
      gave = !isEmpty(mine) && !isEmpty(theirs.doc) && !sameDocs(mine, theirs.doc)
    } else {
      const merged = mergeDocs(agreed, mine, theirs.doc)
      target = settle(merged)
      gave = merged.clashes.length > 0
    }

    pictures.holdUnused(target)
    // What the writer can't send yet stays here, and the rest goes.
    const { written, left } = sendable(document, theirs.doc, target, {
      tabId: theirs.tabId,
      pictures: pictures.known(target),
    })
    let expected = theirs.doc
    let after = theirs
    let afterDocument = document
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
      afterDocument = await readDocument(link.id, token, { signal })
      after = pictures.read(afterDocument, tabId)
    }

    // The model's suggestions, each one of the Doc's now, in the writer's
    // name, as its comments are; their replies go with the comments'.
    const own = await suggestOwn(link.id, afterDocument, {
      shown,
      mine,
      ids: ownSuggestions(shown, had, link.id),
      tabId,
      pictures,
      token,
      signal,
    })
    if (own.document !== afterDocument) {
      afterDocument = own.document
      after = pictures.read(afterDocument, tabId)
    }

    const crossed = await sendComments(
      link.id,
      afterDocument,
      target,
      linkedTo(carried(had, settles.threads), own.links, link.id),
      token,
      { tabId, signal }
    )

    await linked.keep(pictures.newIn(target))
    // What was typed while the sync ran, and what Google merged in between
    // the read and the write, each kept.
    const { doc: now, threads: having } = current()
    const standing = seeing(now, []).doc
    let doc = standing.eq(mine) ? target : settle(mergeDocs(mine, standing, target))
    if (!sameDocs(after.doc, expected)) doc = settle(mergeDocs(expected, doc, after.doc))
    // The Doc's comments into the document as it is to be, with what was
    // said or resolved here while the sync ran.
    const brought = commentsIn({
      document: crossed.document,
      read: readDoc(crossed.document, { tabId }),
      doc,
      threads: carried(having, crossed.threads),
      docId: link.id,
      tabId: after.tabId || tabId,
    })
    // The Doc's suggestions laid in again, from the Doc as the words left
    // it, and the base with them by the same ids.
    const formOf = formsOf(pictures, afterDocument, tabId)
    const open = readDoc(afterDocument, { tabId }).suggested
    // As the document is kept, markdown, which drops what the Doc's read
    // drops too: a paragraph's leading space, say. Two the same then lie
    // alike in the document and the base.
    const kept = parseMarkdown(serializeMarkdown(brought.doc))
    const laid = laySuggestions({
      formOf,
      suggested: open,
      doc: kept,
      ids: suggestionIds(brought.threads, link.id),
    })
    const threaded = suggestionThreads({
      document: crossed.document,
      doc: laid.doc,
      threads: brought.threads,
      laid: laid.laid,
      open: new Set(open),
      docId: link.id,
    })
    // In the order they were laid in the document, so that two put in at
    // one place lie in the base as they lie there.
    const agreedNow = laySuggestions({
      formOf,
      suggested: [...laid.laid.keys()],
      doc: after.doc,
      ids: laid.laid,
    })
    // The model's the Doc couldn't take, or made here while the sync ran,
    // laid in again as they were.
    doc = layOwn({
      shown: now,
      formOf,
      doc: kept,
      marked: laid.doc,
      ids: ownSuggestions(now, threaded.threads, link.id),
    })
    return {
      doc,
      threads: threaded.threads,
      comments: {
        came: brought.came + threaded.posts,
        tooLong: crossed.tooLong,
        sent: crossed.sent,
        changed: brought.changed,
      },
      suggestions: {
        came: threaded.came,
        settled: settles.requests.length,
        changed: threaded.changed,
        sent: Object.keys(own.links).length,
      },
      base: {
        revisionId: after.revisionId,
        tabId: after.tabId,
        markdown: serializeMarkdown(agreedNow.doc),
        pictures: pictures.namesIn(after.doc),
        held: pictures.stillHeld(),
      },
      sent: written.requests.length,
      left,
      changed: !doc.eq(now),
      unsent: pictures.onlyIn(doc, after.doc),
      lost: gave ? theirs.markdown : null,
    }
  }
}

/**
 * The document's comments to the Doc: those it does not have made on their
 * words, against the Doc as read (again, should it change before they go),
 * then replies, edits, resolves and reopens, which name no place in it. The
 * Doc is read once more after, for what comes back.
 *
 * @param {string} docId
 * @param {Document} document - The Doc as the words left it
 * @param {Node} target - The document as written, its comments on it
 * @param {Threads} threads
 * @param {string} token
 * @param {{tabId?: string, signal?: AbortSignal}} options
 * @returns {Promise<{document: Document, threads: Threads, tooLong: number, sent: number}>}
 */
async function sendComments(docId, document, target, threads, token, { tabId, signal }) {
  let latest = document
  let next = threads
  /** @type {Set<string>} */
  const long = new Set()
  let sent = 0
  for (let tries = 1; ; tries++) {
    const read = readDoc(latest, { tabId })
    const made = commentsToMake({
      document: latest,
      read,
      doc: target,
      threads,
      docId,
      tabId: read.tabId,
    })
    next = made.threads
    made.tooLong.forEach(id => long.add(id))
    if (made.made.length === 0) break
    try {
      const requests = made.made.map(each => each.request)
      const answer = await writeDocument(docId, requests, latest.revisionId ?? '', token, {
        signal,
      })
      next = withMade(next, made.made, answer, docId)
      sent += requests.length
      break
    } catch (error) {
      if (!(error instanceof StaleRevisionError) || tries >= TRIES) throw error
      latest = await readDocument(docId, token, { signal })
    }
  }
  const answers = answersToSend({ document: latest, threads: next, docId })
  next = answers.threads
  answers.tooLong.forEach(id => long.add(id))
  if (answers.requests.length > 0) {
    await writeDocument(docId, answers.requests, null, token, { signal })
    sent += answers.requests.length
  }
  if (sent > 0) latest = await readDocument(docId, token, { signal })
  return { document: latest, threads: next, tooLong: long.size, sent }
}

/**
 * The threads as they stand, with what sending them learned: the Doc's ids
 * for them and their posts, and how each stood when the two agreed. A
 * thread taken off here meanwhile stays off; what was said or resolved here
 * meanwhile stays, to go next time.
 *
 * @param {Threads} now
 * @param {Threads} sent
 * @returns {Threads}
 */
function carried(now, sent) {
  /** @type {Threads} */
  const out = {}
  for (const [id, thread] of Object.entries(now)) {
    const known = sent[id]
    if (!known) {
      out[id] = thread
      continue
    }
    const posts = thread.posts.map(post => {
      const same = known.posts.find(
        each => each.created === post.created && each.author === post.author && each.google
      )
      if (!same?.google) return post
      // Edited again here meanwhile: what the two agreed on stays as it was.
      return { ...post, google: same.google }
    })
    out[id] = { ...thread, posts, ...(known.google && { google: known.google }) }
  }
  return out
}

/**
 * A Doc in the document's form, as it stands or with suggestions read as
 * made, each read once.
 *
 * @param {Pictures} pictures
 * @param {Document} document
 * @param {string|undefined} tabId
 * @returns {import('./suggestions.js').FormOf}
 */
function formsOf(pictures, document, tabId) {
  /** @type {Map<string, Node>} */
  const read = new Map()
  return (accepted = new Set()) => {
    const key = [...accepted].sort().join('\n')
    let doc = read.get(key)
    if (!doc) {
      doc = pictures.formOf(document, tabId, accepted)
      read.set(key, doc)
    }
    return doc
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
    const { read, doc, all } = this.#form(document, tabId)
    this.seen = all
    return { doc, markdown: serializeMarkdown(doc), revisionId: read.revisionId, tabId: read.tabId }
  }

  /**
   * A Doc read into the document's form with suggestions read as made.
   *
   * @param {Document} document
   * @param {string|undefined} tabId
   * @param {Set<string>} accepted - The Doc's suggestions read as made, by its ids
   * @returns {Node}
   */
  formOf(document, tabId, accepted) {
    return this.#form(document, tabId, accepted).doc
  }

  /**
   * @param {Document} document
   * @param {string|undefined} tabId
   * @param {Set<string>} [accepted]
   * @returns {{read: import('./convert.js').ReadDoc, doc: Node, all: Set<string>}} With
   *   every picture of the Doc's read, by id, those left out among them
   */
  #form(document, tabId, accepted) {
    let read = readDoc(document, { tabId, accepted })
    const all = new Set(read.pictures.map(each => each.object))
    const out = [...all].filter(id => !this.names.has(id) || this.held.has(id))
    if (out.length > 0) read = readDoc(document, { tabId, leaveOut: new Set(out), accepted })
    let text = read.markdown
    for (const each of read.pictures) {
      const href = pictureHref(this.documentId, /** @type {string} */ (this.names.get(each.object)))
      text = text.split(`](${each.marker})`).join(`](${href})`)
    }
    return { read, doc: parseMarkdown(text), all }
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
