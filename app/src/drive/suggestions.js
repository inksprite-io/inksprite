/**
 * @module drive/suggestions
 * @description A linked Google Doc's suggested edits as the document's own
 * suggestions, made one at each sync beside its words and its comments
 * (`drive/sync`).
 *
 * A Doc keeps its suggestions in its text, the words each puts in and takes
 * out marked with its id, and lists their threads: who suggested each, and
 * what was said on it. The converter reads the Doc as it stands, every
 * suggestion rejected, which is what the merge and the writer compare; and
 * with one of them accepted, which is what that one changes. Each that
 * changes words is laid into the document as a suggestion of its own
 * (`editor/suggestions`), by the layout the model's are made with: the Doc
 * as it stands against the Doc with it made, under one id, so one suggestion
 * there is one here whatever the layout makes of it.
 *
 * The Doc is the truth for them. A sync takes them out of the document,
 * syncs the words as they stand, and lays them in again from the Doc as it
 * then is. A change of style alone, which a suggestion here cannot make,
 * stays in the Doc only, and so does one whose words the document has since
 * changed.
 *
 * The model's suggestions go to the Doc as suggestions in the writer's name
 * (`drive/sync`), and come back as the Doc's, by their ids here; one the Doc
 * can't take stays here, laid in again after (`layOwn`).
 *
 * Words typed into one here, or taken out of it, are written into it in the
 * Doc first (`rewritesOf`), so that laying it in again brings it back as it
 * is here. No request changes a suggestion: its words are text, and what is
 * put in between two letters of them is part of it, still its author's,
 * while what is put in at either end of them is not. So each side changed
 * is put in whole after its first letter and the rest taken out
 * (`spliceInside`). A side of one letter can't be: it goes, and the words
 * here go in before it as a suggestion of the writer's own. One in pieces
 * apart here, or across paragraphs there, is rejected in the Doc, and the
 * words here go as a suggestion of the writer's own (`takenOver`).
 *
 * Its thread keeps the Doc's id for it, as a comment's does (`google`), who
 * suggested it, and the replies; a reply here goes to the Doc as a comment's
 * does, named as a suggestion's (`drive/comments`). Accepted or rejected
 * here, it is accepted or rejected in the Doc at the next sync, before
 * anything else is read; gone from the Doc's text, settled there, it is
 * settled here as the Doc lists it.
 *
 * Design: `.llm/suggestions_design.md`, Docs.
 */

import { Transform } from 'prosemirror-transform'
import { schema } from '@/editor/schema.js'
import {
  changeOf,
  newSuggestionId,
  piecesOf,
  seeing,
  suggestChange,
  suggestionsIn,
} from '@/editor/suggestions.js'
import { asComment, postFrom, postsAcross, postsIn } from './comments.js'
import { tabsOf } from './convert.js'
import { mergeDocs, sameDocs, settle } from './merge.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('@/types/models.js').CommentThread} CommentThread
 * @typedef {import('@/types/models.js').CommentSuggestion} CommentSuggestion
 * @typedef {Record<string, CommentThread>} Threads
 * @typedef {import('./docsTypes.js').Document} Document
 * @typedef {import('./docsTypes.js').DocSuggestion} DocSuggestion
 * @typedef {import('./docsTypes.js').StructuralElement} StructuralElement
 * @typedef {import('./docsTypes.js').Paragraph} Paragraph
 */

/**
 * One side of a Doc's suggestion changed here, as the Doc is to have it.
 *
 * @typedef {Object} Rewrite
 * @property {string} docsId
 * @property {'insertion'|'deletion'} side - The words it puts in, or those
 *   it takes out
 * @property {string} text - What they are to be
 * @property {boolean} beside - They are one letter in the Doc, which can't
 *   be rewritten: it goes, and `text` goes in before it as a suggestion of
 *   the writer's own
 */

/**
 * The words one side of a Doc's suggestion marks, and where they begin.
 *
 * @typedef {Object} Span
 * @property {number} start
 * @property {string} text
 */

/**
 * What one side of a Doc's suggestion marks: its words, if they are one
 * stretch, and every stretch it marks, newlines among them.
 *
 * @typedef {Object} Marked
 * @property {Span|null|undefined} words - Undefined when it marks no words,
 *   null when they are not one stretch in one paragraph
 * @property {Array<{start: number, end: number}>} stretches
 */

/**
 * The Doc in the document's form: as it stands, or with the suggestions
 * named read as made.
 *
 * @typedef {(accepted?: Set<string>) => Node} FormOf
 */

/**
 * The document's threads that are a Doc's suggestions, by the Doc's ids.
 *
 * @param {Threads} threads
 * @param {string} docId
 * @returns {Map<string, string>} The ids here, by the Doc's
 */
export function suggestionIds(threads, docId) {
  /** @type {Map<string, string>} */
  const out = new Map()
  for (const [id, thread] of Object.entries(threads)) {
    if (thread.suggestion && thread.google?.doc === docId) out.set(thread.google.id, id)
  }
  return out
}

/**
 * The suggestions in a document that are not a Doc's: the model's, which
 * the Doc cannot have yet.
 *
 * @param {Node} doc
 * @param {Threads} threads
 * @param {string} docId
 * @returns {string[]}
 */
export function ownSuggestions(doc, threads, docId) {
  return suggestionsIn(doc).filter(id => threads[id]?.google?.doc !== docId)
}

/**
 * The Doc's suggestions whose change was changed here since the two last
 * agreed: words typed into what one puts in, or taken out of it, all of
 * them it may be, though not one gone because it was settled here. A sync
 * lays them in again from the Doc, which would lose that, so they are
 * changed in the Doc first (`rewritesOf`).
 *
 * @param {Node} doc - The document as it stands here
 * @param {Node} agreed - The base, the Doc's suggestions laid in
 * @param {Threads} threads
 * @param {string} docId
 * @returns {string[]} Their ids here
 */
export function changedHere(doc, agreed, threads, docId) {
  const here = new Set(suggestionsIn(doc))
  const there = new Set(suggestionsIn(agreed))
  return [...suggestionIds(threads, docId).values()].filter(id => {
    if (!there.has(id) || (!here.has(id) && threads[id].status === 'resolved')) return false
    // Its words, whatever pieces they lie in: another's words between two
    // of its pieces, settled, leave them one.
    const [now, then] = [piecesOf(doc, id), piecesOf(agreed, id)]
    return now.in.join('') !== then.in.join('') || now.out.join('') !== then.out.join('')
  })
}

/**
 * How the Doc's suggestions changed here are to be changed there first, so
 * that laying them in again brings them back as they are here: each side of
 * one whose words changed, its words in the Doc made the words here. Those
 * that can't be are stuck: in pieces apart here, across paragraphs there,
 * old words of one letter, or words in the Doc that aren't the words here
 * as the two last agreed: laid out otherwise here, as a paragraph parted
 * there is, or changed there too.
 *
 * @param {Object} given
 * @param {Node} given.doc - The document as it stands here
 * @param {Node} given.agreed - The base, the Doc's suggestions laid in
 * @param {Threads} given.threads
 * @param {string} given.docId
 * @param {Document} given.document - The Doc as read
 * @param {string} [given.tabId]
 * @returns {{rewrites: Rewrite[], stuck: string[]}} With the ids here of
 *   those stuck
 */
export function rewritesOf({ doc, agreed, threads, docId, document, tabId }) {
  /** @type {Rewrite[]} */
  const rewrites = []
  /** @type {string[]} */
  const stuck = []
  for (const id of changedHere(doc, agreed, threads, docId)) {
    const docsId = /** @type {NonNullable<CommentThread['google']>} */ (threads[id].google).id
    const marked = {
      insertion: markedBy(document, tabId, docsId, 'insertion'),
      deletion: markedBy(document, tabId, docsId, 'deletion'),
    }
    // Settled or deleted in the Doc since: it is settled here, as any is,
    // and what was typed into it is in the version a sync keeps.
    if (marked.insertion.stretches.length + marked.deletion.stretches.length === 0) continue
    const [now, then] = [piecesOf(doc, id), piecesOf(agreed, id)]
    /** @type {Rewrite[]} */
    const its = []
    const fits = /** @type {const} */ ([
      ['insertion', 'in'],
      ['deletion', 'out'],
    ]).every(([side, key]) => {
      if (now[key].join('') === then[key].join('')) return true
      const text = now[key].join('')
      const span = marked[side].words
      if (now[key].length > 1 || text.includes('\n') || span === null) return false
      // Already so in the Doc: written there by a sync that went no further.
      if ((span?.text ?? '') === text) return true
      // Its words in the Doc are the words here as the two last agreed,
      // else they are laid out otherwise here, or changed there too.
      if (then[key].length > 1 || (then[key][0] ?? '') !== (span?.text ?? '')) return false
      // Words put in where it had none.
      if (!span) return false
      const beside = !!text && span.text.length < 2
      if (beside && side === 'deletion') return false
      its.push({ docsId, side, text, beside })
      return true
    })
    if (fits) rewrites.push(...its)
    else stuck.push(id)
  }
  return { rewrites, stuck }
}

/**
 * The requests, sent as a suggestion, that put in the words of the rewrites
 * going in beside: each before the letter it takes the place of, so that it
 * is not part of that suggestion.
 *
 * @param {Document} document - The Doc as read
 * @param {string|undefined} tabId
 * @param {Rewrite[]} rewrites
 * @returns {object[]}
 */
export function besideRequests(document, tabId, rewrites) {
  /** @type {Array<{start: number, request: object}>} */
  const out = []
  for (const rewrite of rewrites.filter(each => each.beside)) {
    const span = markedBy(document, tabId, rewrite.docsId, rewrite.side).words
    if (!span) continue
    const location = { index: span.start, ...(tabId && { tabId }) }
    out.push({ start: span.start, request: { insertText: { text: rewrite.text, location } } })
  }
  return out.sort((a, b) => b.start - a.start).map(each => each.request)
}

/**
 * The requests that rewrite the Doc's suggestions in place: each side's
 * words made the words here (`spliceInside`), and the letter of each going
 * in beside taken out. A side whose words all went here goes whole, the
 * newlines it marks too: a paragraph put in, emptied here, is not put in.
 * The last in the Doc first, so none moves another.
 *
 * @param {Document} document - The Doc as read
 * @param {string|undefined} tabId
 * @param {Rewrite[]} rewrites
 * @returns {object[]}
 */
export function rewriteRequests(document, tabId, rewrites) {
  /** @type {Array<{start: number, requests: object[]}>} */
  const out = []
  for (const rewrite of rewrites) {
    const marked = markedBy(document, tabId, rewrite.docsId, rewrite.side)
    if (!rewrite.text) {
      for (const { start, end } of marked.stretches) {
        const range = { startIndex: start, endIndex: end, ...(tabId && { tabId }) }
        out.push({ start, requests: [{ deleteContentRange: { range } }] })
      }
      continue
    }
    const span = marked.words
    if (!span) continue
    const words = { ...span, tabId }
    const requests = spliceInside(words, 0, span.text.length, rewrite.beside ? '' : rewrite.text)
    if (requests) out.push({ start: span.start, requests })
  }
  return out.sort((a, b) => b.start - a.start).flatMap(each => each.requests)
}

/**
 * The requests that make letters `from` to `to` of a suggestion's words
 * `text` instead, so that what is put in is part of the suggestion. Letters
 * put in between two of its own are, and letters put in at either end of
 * them are not (checked live, 22 Oct 2026). So what is put in goes in
 * between two of its own, and a letter of its own at an end is taken into
 * the change, put in again with it. Null when the words are too short for
 * that.
 *
 * @param {Span & {tabId?: string}} words - The suggestion's words, and
 *   where they begin in the Doc
 * @param {number} from
 * @param {number} to
 * @param {string} text
 * @returns {object[]|null}
 */
export function spliceInside(words, from, to, text) {
  const size = words.text.length
  const tab = words.tabId ? { tabId: words.tabId } : {}
  /** @param {number} start @param {number} end */
  const cut = (start, end) => ({
    deleteContentRange: {
      range: { startIndex: words.start + start, endIndex: words.start + end, ...tab },
    },
  })
  if (!text) return from < to ? [cut(from, to)] : []
  let [a, b, put] = [from, to, text]
  if (a === b && a === 0) [b, put] = [1, put + words.text.slice(0, 1)]
  else if (a === b && a === size) [a, put] = [size - 1, words.text.slice(size - 1) + put]
  // Where it goes in: before the letters it replaces, else after them.
  const at = a > 0 && a < size ? a : b > 0 && b < size ? b : size > 1 ? 1 : null
  if (at === null) return null
  /** @type {object[]} */
  const requests = [{ insertText: { text: put, location: { index: words.start + at, ...tab } } }]
  // What it replaces after where it went in, then before, so neither moves the other.
  if (b > at) requests.push(cut(Math.max(a, at) + put.length, b + put.length))
  if (a < at) requests.push(cut(a, Math.min(b, at)))
  return requests
}

/**
 * What one side of a Doc's suggestion marks in a tab. Its words are those
 * of one paragraph, the newline that ends one aside: a paragraph put in is
 * a newline in the one before and its words.
 *
 * @param {Document} document
 * @param {string|undefined} tabId
 * @param {string} docsId
 * @param {'insertion'|'deletion'} side
 * @returns {Marked}
 */
function markedBy(document, tabId, docsId, side) {
  const key = side === 'insertion' ? 'suggestedInsertionIds' : 'suggestedDeletionIds'
  const tabs = tabsOf(document)
  const tab = tabId ? tabs.find(each => each.tabProperties?.tabId === tabId) : tabs[0]
  /** @param {object} element */
  const marks = element =>
    Object.entries(element).some(
      ([name, value]) => !name.endsWith('Index') && value?.[key]?.includes(docsId)
    )
  /** @type {Marked} */
  const out = { words: undefined, stretches: [] }
  for (const paragraph of paragraphsIn(tab?.documentTab?.body?.content ?? [])) {
    const marked = (paragraph.elements ?? []).filter(marks)
    for (const element of marked) {
      const [start, end] = [element.startIndex ?? 0, element.endIndex ?? 0]
      const last = out.stretches.at(-1)
      if (last?.end === start) last.end = end
      else out.stretches.push({ start, end })
    }
    if (marked.length === 0 || out.words === null) continue
    const start = marked[0].startIndex ?? 0
    const text = marked.map(element => element.textRun?.content ?? '').join('')
    const words = text.endsWith('\n') ? text.slice(0, -1) : text
    // Text, run after run.
    const whole = marked.every(element => element.textRun)
    if (!whole || (marked.at(-1)?.endIndex ?? 0) - start !== text.length) out.words = null
    else if (!words) continue
    // In one paragraph only.
    else if (out.words || words.includes('\n')) out.words = null
    else out.words = { start, text: words }
  }
  return out
}

/**
 * Every paragraph in a body, those in its tables' cells too.
 *
 * @param {StructuralElement[]} content
 * @returns {Generator<Paragraph>}
 */
function* paragraphsIn(content) {
  for (const element of content) {
    if (element.paragraph) yield element.paragraph
    for (const row of element.table?.tableRows ?? []) {
      for (const cell of row.tableCells ?? []) yield* paragraphsIn(cell.content ?? [])
    }
  }
}

/**
 * The Doc's suggestions laid into a document, each that changes words, whose
 * words the document still has as the Doc does, and which comes out here as
 * it is there: accepted alone, it makes its change and no other. Two the
 * Doc keeps apart can share words here, since a paragraph joined or parted
 * here is its words taken out and put in again, and a word is in one
 * suggestion; the second of such is left in the Doc. Those known here go in
 * first, so one new never puts out one the writer has seen.
 *
 * @param {Object} given
 * @param {FormOf} given.formOf
 * @param {string[]} given.suggested - The Doc's suggestions that put words in
 *   or take them out, by its ids, in order
 * @param {Node} given.doc - The document, none of the Doc's suggestions in it
 * @param {Map<string, string>} given.ids - The ids here of those known, by
 *   the Doc's; one new is given an id of its own
 * @param {Node} [given.marked] - The document to lay them into, others
 *   laid in it already; `doc` otherwise
 * @returns {{doc: Node, laid: Map<string, string>}} The document with them
 *   in, and those laid in, their ids here by the Doc's
 */
export function laySuggestions({ formOf, suggested, doc, ids, marked: into = doc }) {
  const stands = formOf()
  let marked = into
  /** @type {Map<string, string>} */
  const laid = new Map()
  const known = suggested.filter(docsId => ids.has(docsId))
  for (const docsId of [...known, ...suggested.filter(docsId => !ids.has(docsId))]) {
    const made = formOf(new Set([docsId]))
    // Nothing the document shows: a picture put in, say.
    if (sameDocs(made, stands)) continue
    // The change made to the document, which keeps its comments and what
    // the Doc lacks; none where the document changed the same words.
    const merged = mergeDocs(stands, doc, made)
    if (merged.clashes.length > 0) continue
    const after = settle(merged)
    const id = ids.get(docsId) ?? newSuggestionId()
    const result = suggestChange(marked, after, id)
    if (!result || !result.ids.includes(id)) continue
    // Each part of it under its one id, as it is one suggestion in the Doc.
    const parts = new Set(result.ids.filter(each => each !== id))
    const one = parts.size > 0 ? underOne(result.doc, parts, id) : result.doc
    if (!sameDocs(seeing(one, [id]).doc, after)) continue
    // And rejected, the text as it stood: a block it can't mark isn't taken out.
    if (!sameDocs(seeing(one, []).doc, seeing(marked, []).doc)) continue
    // Nor does it change the words of one laid before it, or one there.
    if (suggestionsIn(marked).some(other => wordsOf(one, other) !== wordsOf(marked, other)))
      continue
    marked = one
    laid.set(docsId, id)
  }
  return { doc: marked, laid }
}

/**
 * The Doc's suggestions changed here in a way the Doc can't be given, made
 * the writer's own: each one's marks under a new id, its thread settled as
 * rejected (so the sync rejects it in the Doc), and a thread of the
 * writer's for the new, which then goes to the Doc as the model's do, or
 * stays here.
 *
 * @param {Node} doc
 * @param {Threads} threads
 * @param {Map<string, string>} swaps - The new ids, by the old
 * @param {number} at - When the new were suggested
 * @returns {{doc: Node, threads: Threads}}
 */
export function takenOver(doc, threads, swaps, at) {
  let out = doc
  const next = { ...threads }
  for (const [id, fresh] of swaps) {
    const thread = threads[id]
    if (!thread?.suggestion || !suggestionsIn(out).includes(id)) continue
    out = underOne(out, new Set([id]), fresh)
    next[id] = {
      ...thread,
      status: 'resolved',
      suggestion: { ...thread.suggestion, settled: 'rejected' },
    }
    const { out: quote, in: put } = changeOf(out, fresh)
    next[fresh] = {
      status: 'open',
      quote,
      posts: [],
      suggestion: { text: put, created: at, author: 'writer' },
    }
  }
  return { doc: out, threads: next }
}

/**
 * Whether a suggestion puts in or takes out a block whole here, alone or
 * with others: a block it is in has every word of it put in, or every word
 * taken out. In a Doc that is a paragraph's end suggested, which holds the
 * writer off the paragraphs either side, so such a one of the model's
 * stays here.
 *
 * @param {Node} doc
 * @param {string} id
 * @returns {boolean}
 */
export function wholeBlock(doc, id) {
  const { insertion, deletion } = schema.marks
  /** @param {import('prosemirror-model').Mark} mark */
  const suggests = mark => mark.type === insertion || mark.type === deletion
  let whole = false
  doc.descendants(node => {
    if (whole) return false
    if (!node.isInline && node.marks.some(mark => suggests(mark) && mark.attrs.id === id)) {
      whole = true
      return false
    }
    if (!node.isTextblock) return true
    /** @type {Set<unknown>} */
    const kinds = new Set()
    let its = false
    let bare = node.childCount === 0
    node.forEach(child => {
      const marks = child.marks.filter(suggests)
      if (marks.length === 0) bare = true
      for (const mark of marks) {
        kinds.add(mark.type)
        if (mark.attrs.id === id) its = true
      }
    })
    if (its && !bare && kinds.size === 1) whole = true
    return false
  })
  return whole
}

/**
 * The model's suggestions that stayed here laid into the document as the
 * sync leaves it, by their own ids, as the Doc's are (`laySuggestions`):
 * each the change it made to the text as it stood, made to the text as it
 * stands now. One whose words the Doc changed meanwhile, or that would not
 * come out as it was, isn't, and its thread is left without a place.
 *
 * @param {Object} given
 * @param {Node} given.shown - The document as it was, the suggestions in it
 * @param {FormOf} given.formOf - The Doc in the document's form
 * @param {Node} given.doc - The document as the sync leaves it, none of
 *   the suggestions in it
 * @param {Node} given.marked - The same, the Doc's suggestions laid in
 * @param {string[]} given.ids
 * @returns {Node}
 */
export function layOwn({ shown, formOf, doc, marked, ids }) {
  if (ids.length === 0) return marked
  const stood = seeing(shown, []).doc
  /** @type {FormOf} */
  const ownForm = accepted => {
    const [id] = accepted ?? []
    if (!id) return formOf()
    const merged = mergeDocs(stood, formOf(), seeing(shown, [id]).doc)
    return merged.clashes.length > 0 ? formOf() : settle(merged)
  }
  return laySuggestions({
    formOf: ownForm,
    suggested: ids,
    doc,
    ids: new Map(ids.map(id => [id, id])),
    marked,
  }).doc
}

/**
 * What a suggestion takes out and puts in, its pieces' words run together.
 *
 * @param {Node} doc
 * @param {string} id
 * @returns {string}
 */
function wordsOf(doc, id) {
  const pieces = piecesOf(doc, id)
  return `${pieces.out.join('')}\u0000${pieces.in.join('')}`
}

/**
 * A document with the marks of some suggestions put under one id.
 *
 * @param {Node} doc
 * @param {Set<string>} ids
 * @param {string} id
 * @returns {Node}
 */
function underOne(doc, ids, id) {
  const { insertion, deletion } = schema.marks
  const tr = new Transform(doc)
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if ((mark.type !== insertion && mark.type !== deletion) || !ids.has(mark.attrs.id)) continue
      const again = mark.type.create({ id })
      const to = pos + node.nodeSize
      if (node.isInline) tr.removeMark(pos, to, mark).addMark(pos, to, again)
      else tr.removeNodeMark(pos, mark).addNodeMark(pos, again)
    }
  })
  return tr.doc
}

/**
 * The suggestions settled here that the Doc still has: the requests that
 * settle them there, and the threads saying they are.
 *
 * @param {Object} given
 * @param {Set<string>} given.open - The Doc's suggestions in its text, by its ids
 * @param {Threads} given.threads
 * @param {string} given.docId
 * @returns {{requests: object[], accepted: string[], threads: Threads}} With
 *   the ids here of those accepted
 */
export function settlesToSend({ open, threads, docId }) {
  /** @type {object[]} */
  const requests = []
  /** @type {string[]} */
  const accepted = []
  /** @type {Threads} */
  const next = { ...threads }
  for (const [id, thread] of Object.entries(threads)) {
    const link = thread.google
    const settled = thread.suggestion?.settled
    if (!link || link.doc !== docId || link.status !== 'open' || thread.status !== 'resolved')
      continue
    if (settled !== 'accepted' && settled !== 'rejected') continue
    if (open.has(link.id)) {
      const suggestionId = link.id
      requests.push(
        settled === 'accepted'
          ? { acceptSuggestion: { suggestionId } }
          : { rejectSuggestion: { suggestionId } }
      )
      if (settled === 'accepted') accepted.push(id)
    }
    next[id] = { ...thread, google: { ...link, status: 'resolved' } }
  }
  return { requests, accepted, threads: next }
}

/**
 * Who suggested a change in the Doc, as its thread here says it.
 *
 * @param {DocSuggestion|undefined} entry
 * @returns {Partial<CommentSuggestion>}
 */
function suggester(entry) {
  const author = entry?.headPost?.author
  if (!author) return {}
  if (author.me) return { author: 'writer' }
  return {
    author: 'person',
    name: author.displayName || 'Someone',
    ...(author.user && { user: author.user }),
  }
}

/**
 * How a Doc's suggestion ended: the Doc keeps listing one accepted or
 * rejected, and not one its author deleted.
 *
 * @param {DocSuggestion|undefined} entry
 * @returns {'accepted'|'rejected'|undefined}
 */
function endOf(entry) {
  if (entry?.status === 'ACCEPTED') return 'accepted'
  if (entry?.status === 'REJECTED') return 'rejected'
  return undefined
}

/**
 * The threads of the Doc's suggestions brought up to date with what was
 * laid in: a new one for each new there, with who suggested it and what was
 * said on it; each known with the Doc's replies and edits, and what it
 * changes now; and each gone from the Doc, settled there, settled here.
 *
 * @param {Object} given
 * @param {Document} given.document - The Doc as read last, for its threads
 * @param {Node} given.doc - The document with the Doc's suggestions laid in
 * @param {Threads} given.threads
 * @param {Map<string, string>} given.laid - Those laid in, their ids here by the Doc's
 * @param {Set<string>} given.open - The Doc's suggestions in its text, by its ids
 * @param {string} given.docId
 * @returns {{threads: Threads, came: number, posts: number, changed: number}}
 *   The suggestions new here, the posts that came in on those known, and
 *   everything the Doc changed here: those, edits, and suggestions settled
 */
export function suggestionThreads({ document, doc, threads, laid, open, docId }) {
  /** @type {Map<string, DocSuggestion>} */
  const listed = new Map((document.suggestions ?? []).map(each => [each.suggestionId, each]))
  /** @type {Threads} */
  const next = { ...threads }
  let came = 0
  let posts = 0
  let changed = 0

  for (const [docsId, id] of laid) {
    const entry = listed.get(docsId)
    const { out, in: put } = changeOf(doc, id)
    const google = { doc: docId, id: docsId, status: /** @type {'open'} */ ('open') }
    const thread = next[id]
    if (!thread) {
      const created = Date.parse(entry?.headPost?.createTime ?? '') || Date.now()
      next[id] = {
        status: 'open',
        quote: out,
        posts: entry ? postsIn(asComment(entry)).map(postFrom) : [],
        suggestion: { text: put, created, ...suggester(entry) },
        google,
      }
      came++
      continue
    }
    const across = entry ? postsAcross(thread, asComment(entry)) : null
    posts += across?.came ?? 0
    changed += across?.changed ?? 0
    next[id] = {
      ...thread,
      status: 'open',
      quote: out,
      ...(across && { posts: across.posts }),
      suggestion: { .../** @type {CommentSuggestion} */ (thread.suggestion), text: put },
      google,
    }
  }

  // Gone from the Doc: accepted, rejected or deleted there, unless it was
  // settled here first.
  for (const [docsId, id] of suggestionIds(next, docId)) {
    const thread = next[id]
    if (laid.has(docsId) || open.has(docsId) || thread.google?.status === 'resolved') continue
    const suggestion = /** @type {CommentSuggestion} */ (thread.suggestion)
    const settled = suggestion.settled ?? endOf(listed.get(docsId))
    next[id] = {
      ...thread,
      status: 'resolved',
      suggestion: { ...suggestion, ...(settled && { settled }) },
      google: {
        .../** @type {NonNullable<CommentThread['google']>} */ (thread.google),
        status: 'resolved',
      },
    }
    if (thread.status !== 'resolved') changed++
  }
  return { threads: next, came, posts, changed: came + posts + changed }
}
