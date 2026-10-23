/* global TextEncoder */
/**
 * @module drive/comments
 * @description A document's comment threads and its Google Doc's, made one
 * at each sync, beside its words (`drive/sync`).
 *
 * A thread here that crossed keeps the Doc's id for it, and the Doc's own
 * (`google` on the thread), so a copy of the document or one linked to
 * another Doc never takes those threads for its own; each post that crossed
 * keeps its id there and what it said when the two last agreed. A thread
 * keeps how it stood then too, open or resolved, which tells which side
 * resolved or reopened it since. One sent whose id never came back is known
 * again by its first words, the signed-in account's, and so is a reply.
 *
 * Out, once the words are written and the Doc read again: a comment here
 * on words the Doc has becomes the Doc's (`insertComment`, at their indices,
 * against that read), unless it is over Docs' 2048 bytes; a reply here, a
 * resolve and a reopen go as replies (`addCommentReply`, a resolve one with
 * nothing said); and the writer's own words edited here as an edit of the
 * post (`updateCommentPost`). A comment stale or resolved here, never sent,
 * stays here.
 *
 * In, from the Doc as those leave it: an open thread with none here becomes
 * a comment on its words here, or a stale one when they are not here, each
 * post with its author's name; a reply, an edit, a resolve or a reopen there
 * comes here; and a thread gone from the Doc, which only its author can do,
 * is resolved here. Nothing is ever deleted in the Doc.
 *
 * Where words are in each is found by laying the document's characters
 * against the Doc's as the converter read it: those the two share are the
 * same character, and the converter's spans say where each of the Doc's is.
 */

import { Transform } from 'prosemirror-transform'
import { commentRanges, newCommentId } from '@/editor/comments.js'
import { schema } from '@/editor/schema.js'
import { diffSequences } from '@/utils/diff.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('@/types/models.js').CommentThread} CommentThread
 * @typedef {import('@/types/models.js').CommentPost} CommentPost
 * @typedef {Record<string, CommentThread>} Threads
 * @typedef {import('./docsTypes.js').Document} Document
 * @typedef {import('./docsTypes.js').DocComment} DocComment
 * @typedef {import('./docsTypes.js').DocPost} DocPost
 * @typedef {import('./docsTypes.js').DocSuggestion} DocSuggestion
 * @typedef {import('./convert.js').ReadDoc} ReadDoc
 * @typedef {import('./convert.js').Span} Span
 */

/**
 * A stretch of the Doc.
 *
 * @typedef {{startIndex: number, endIndex: number, segmentId?: string}} DocRange
 */

/** Docs' longest comment, in UTF-8 bytes. */
export const MAX_BYTES = 2048

/** Past this many characters changed, the two are not laid against each other. */
const MAX_EDITS = 20000

const encoder = new TextEncoder()

/**
 * Whether a comment's words are more than Docs takes.
 *
 * @param {string} text
 */
export const tooLong = text => encoder.encode(text).length > MAX_BYTES

/**
 * How a Doc's thread stands, as a thread here says it.
 *
 * @param {DocComment} comment
 * @returns {'open'|'resolved'}
 */
export const statusOf = comment => (comment.status === 'RESOLVED' ? 'resolved' : 'open')

/**
 * What a thread said, its head post and replies: those with words.
 *
 * @param {DocComment} comment
 * @returns {DocPost[]}
 */
export const postsIn = comment =>
  [comment.headPost, ...(comment.replies ?? [])].filter(
    /** @returns {post is DocPost} */ post => !!post && !!post.content
  )

/**
 * A Doc's suggestion thread in the shape of a comment's: its head post is
 * the change, with nothing said, and its replies are what was said on it.
 *
 * @param {DocSuggestion} suggestion
 * @returns {DocComment}
 */
export const asComment = suggestion => ({
  commentId: suggestion.suggestionId,
  ...(suggestion.status && { status: suggestion.status }),
  ...(suggestion.headPost && { headPost: suggestion.headPost }),
  ...(suggestion.replies && { replies: suggestion.replies }),
})

/**
 * A document's characters laid against a Doc's as the converter read it.
 */
export class Places {
  /**
   * @param {ReadDoc} read
   * @param {Node} doc
   */
  constructor(read, doc) {
    /** @type {Span[]} The spans that cover characters, in order. */
    this.covering = (read.spans ?? []).filter(span => span.length > 0)
    const a = charsOf(read.doc)
    const b = charsOf(doc)
    const steps =
      diffSequences(
        a.map(each => each.key),
        b.map(each => each.key),
        { maxEdits: MAX_EDITS }
      ) ?? []
    /** @type {Map<number, number>} The read's position of each of the document's characters. */
    this.toRead = new Map()
    /** @type {Map<number, number>} The document's of each of the read's. */
    this.toDoc = new Map()
    for (const step of steps) {
      if (step.op !== 'equal') continue
      this.toRead.set(b[step.b].pos, a[step.a].pos)
      this.toDoc.set(a[step.a].pos, b[step.b].pos)
    }
    this.size = doc.content.size
  }

  /**
   * A stretch of the document in the Doc: from its first character the Doc
   * has to its last. Null when it has none, or they are in two segments.
   *
   * @param {number} from
   * @param {number} to
   * @returns {DocRange|null}
   */
  inDoc(from, to) {
    /** @type {{span: Span, at: number}|null} */
    let first = null
    for (let pos = from; pos < to && !first; pos++) first = this.#spanOf(this.toRead.get(pos))
    /** @type {{span: Span, at: number}|null} */
    let last = null
    for (let pos = to - 1; pos >= from && !last; pos--) last = this.#spanOf(this.toRead.get(pos))
    if (!first || !last || (first.span.segment ?? '') !== (last.span.segment ?? '')) return null
    const start = first.span.kind === 'text' ? first.span.index + first.at : first.span.index
    const end =
      last.span.kind === 'text' ? last.span.index + last.at + 1 : last.span.index + last.span.size
    if (end <= start) return null
    return {
      startIndex: start,
      endIndex: end,
      ...(first.span.segment && { segmentId: first.span.segment }),
    }
  }

  /**
   * A stretch of the Doc in the document: from the first of its characters
   * the document has to the last. Null when it has none.
   *
   * @param {DocRange} range
   * @returns {{from: number, to: number}|null}
   */
  inDocument({ startIndex, endIndex, segmentId = '' }) {
    /** @type {number|null} */
    let from = null
    /** @type {number|null} */
    let to = null
    for (const span of this.covering) {
      if ((span.segment ?? '') !== segmentId) continue
      const lo = Math.max(startIndex, span.index)
      const hi = Math.min(endIndex, span.index + span.size)
      if (lo >= hi) continue
      // A chip or a picture is one index for all it shows.
      const reach =
        span.kind === 'text'
          ? [span.pos + (lo - span.index), span.pos + (hi - span.index)]
          : [span.pos, span.pos + span.length]
      for (let pos = reach[0]; pos < reach[1]; pos++) {
        const here = this.toDoc.get(pos)
        if (here === undefined) continue
        if (from === null || here < from) from = here
        if (to === null || here + 1 > to) to = here + 1
      }
    }
    return from === null || to === null || to <= from ? null : { from, to }
  }

  /**
   * The span a position of the read is in, and how far into it.
   *
   * @param {number|undefined} pos
   * @returns {{span: Span, at: number}|null}
   */
  #spanOf(pos) {
    if (pos === undefined) return null
    let lo = 0
    let hi = this.covering.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const span = this.covering[mid]
      if (pos < span.pos) hi = mid - 1
      else if (pos >= span.pos + span.length) lo = mid + 1
      else return { span, at: pos - span.pos }
    }
    return null
  }
}

/**
 * A document's characters in order, each with its position: its text, its
 * pictures and breaks, and the end of each block.
 *
 * @param {Node} doc
 * @returns {Array<{pos: number, key: string}>}
 */
function charsOf(doc) {
  /** @type {Array<{pos: number, key: string}>} */
  const out = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    node.forEach((child, offset) => {
      const at = pos + 1 + offset
      if (child.isText) {
        const text = child.text ?? ''
        for (let k = 0; k < text.length; k++) out.push({ pos: at + k, key: text[k] })
      } else out.push({ pos: at, key: `\u0000${child.type.name}` })
    })
    out.push({ pos: pos + node.nodeSize - 1, key: '\u0000end' })
    return false
  })
  return out
}

/**
 * A thread's links that are this Doc's, and none of another's.
 *
 * @param {CommentThread} thread
 * @param {string} docId
 * @returns {CommentThread}
 */
function ownLinks(thread, docId) {
  if (!thread.google || thread.google.doc === docId) return thread
  const { google: _google, ...rest } = thread
  return { ...rest, posts: thread.posts.map(({ google: _post, ...post }) => post) }
}

/**
 * A post of the Doc's, as a post here: the writer's when it is the signed-in
 * account's, someone's by name otherwise.
 *
 * @param {DocPost} post
 * @returns {CommentPost}
 */
export function postFrom(post) {
  const author = post.author ?? {}
  const created = Date.parse(post.createTime ?? '') || Date.now()
  const updated = Date.parse(post.updateTime ?? '') || created
  const text = post.content ?? ''
  return {
    ...(author.me
      ? { author: 'writer' }
      : {
          author: 'person',
          name: author.displayName || 'Someone',
          ...(author.user && { user: author.user }),
        }),
    text,
    created,
    ...(updated > created && { edited: updated }),
    google: { id: post.postId ?? '', text },
  }
}

/**
 * A thread's posts and the Doc's laid against each other: each of the
 * Doc's with the post here it is, by its id, or by its words where the
 * signed-in account said them and the one here never learned its id.
 *
 * @param {CommentPost[]} posts
 * @param {DocPost[]} theirs
 * @returns {Array<{post: DocPost, at: number}>} For each of the Doc's,
 *   which post here it is; -1 for none
 */
function matchPosts(posts, theirs) {
  const taken = new Set()
  return theirs.map(post => {
    let at = posts.findIndex(
      (mine, i) => !taken.has(i) && !!post.postId && mine.google?.id === post.postId
    )
    if (at < 0 && post.author?.me) {
      at = posts.findIndex(
        (mine, i) =>
          !taken.has(i) &&
          !mine.google?.id &&
          mine.author !== 'person' &&
          mine.text === (post.content ?? '')
      )
    }
    if (at >= 0) taken.add(at)
    return { post, at }
  })
}

/**
 * A linked thread's posts with the Doc's brought in: in the Doc's order, a
 * post new there added, an edit there taken even over one made here, then
 * what was said here and has not gone yet.
 *
 * @param {CommentThread} thread
 * @param {DocComment} comment
 * @returns {{posts: CommentPost[], came: number, changed: number}} The posts
 *   that came in, and those whose words the Doc changed
 */
export function postsAcross(thread, comment) {
  /** @type {CommentPost[]} */
  const posts = []
  let came = 0
  let changed = 0
  const matched = matchPosts(thread.posts, postsIn(comment))
  for (const { post, at } of matched) {
    if (at < 0) {
      posts.push(postFrom(post))
      came++
      continue
    }
    const mine = thread.posts[at]
    const text = post.content ?? ''
    const agreed = mine.google?.text ?? text
    // Edited there: the Doc's words, even where they were edited here too.
    if (text !== agreed) {
      const edited = Date.parse(post.updateTime ?? '') || Date.now()
      posts.push({ ...mine, text, edited, google: { id: post.postId ?? '', text } })
      if (text !== mine.text) changed++
    } else if (!mine.google?.id && post.postId) {
      posts.push({ ...mine, google: { id: post.postId, text: agreed } })
    } else posts.push(mine)
  }
  const kept = new Set(matched.map(each => each.at))
  posts.push(...thread.posts.filter((_, i) => !kept.has(i)))
  return { posts, came, changed }
}

/**
 * A thread here linked to one of the Doc's: its id there, and its posts
 * with theirs.
 *
 * @param {CommentThread} thread
 * @param {DocComment} comment
 * @param {string} docId
 * @returns {CommentThread}
 */
function linked(thread, comment, docId) {
  const posts = [...thread.posts]
  for (const { post, at } of matchPosts(posts, postsIn(comment))) {
    if (at >= 0)
      posts[at] = { ...posts[at], google: { id: post.postId ?? '', text: post.content ?? '' } }
  }
  return {
    ...thread,
    posts,
    google: { doc: docId, id: comment.commentId, status: statusOf(comment) },
  }
}

/**
 * The comments of the document to make in the Doc, and the threads with
 * what is already the Doc's linked: those it has under the words the
 * signed-in account sent, whose ids never came back.
 *
 * @param {Object} given
 * @param {Document} given.document - The Doc as read after the words were written
 * @param {ReadDoc} given.read - It, as the converter read it
 * @param {Node} given.doc - The document as written, its comments' marks on it
 * @param {Threads} given.threads
 * @param {string} given.docId
 * @param {string} given.tabId
 * @returns {{threads: Threads, made: Array<{id: string, request: object}>, tooLong: string[]}}
 */
export function commentsToMake({ document, read, doc, threads, docId, tabId }) {
  const places = new Places(read, doc)
  /** @type {Threads} */
  const next = {}
  for (const [id, thread] of Object.entries(threads)) next[id] = ownLinks(thread, docId)
  const claimed = new Set(Object.values(next).flatMap(thread => thread.google?.id ?? []))
  const unclaimed = (document.comments ?? []).filter(comment => !claimed.has(comment.commentId))

  /** @type {Map<string, {from: number, to: number}>} */
  const reach = new Map()
  for (const range of commentRanges(doc)) {
    const held = reach.get(range.id)
    reach.set(range.id, held ? { from: held.from, to: Math.max(held.to, range.to) } : range)
  }

  /** @type {Array<{id: string, request: object}>} */
  const made = []
  /** @type {string[]} */
  const long = []
  for (const [id, thread] of Object.entries(next)) {
    const placed = reach.get(id)
    const head = thread.posts[0]
    if (thread.google || !placed || thread.status !== 'open' || !head) continue
    const twin = unclaimed.findIndex(
      comment => comment.headPost?.author?.me && (comment.headPost.content ?? '') === head.text
    )
    if (twin >= 0) {
      next[id] = linked(thread, unclaimed[twin], docId)
      unclaimed.splice(twin, 1)
      continue
    }
    if (tooLong(head.text)) {
      long.push(id)
      continue
    }
    const range = places.inDoc(placed.from, placed.to)
    if (!range) continue
    made.push({
      id,
      request: {
        insertComment: { range: { ...range, ...(tabId && { tabId }) }, content: head.text },
      },
    })
  }
  return { threads: next, made, tooLong: long }
}

/**
 * The threads with the ids the Doc gave the comments made, from its answer
 * to the batch that made them.
 *
 * @param {Threads} threads
 * @param {Array<{id: string, request: object}>} made
 * @param {{replies?: any[]}} answer
 * @param {string} docId
 * @returns {Threads}
 */
export function withMade(threads, made, answer, docId) {
  const next = { ...threads }
  made.forEach(({ id }, i) => {
    /** @type {DocComment|undefined} */
    const comment = answer.replies?.[i]?.insertComment?.commentThread
    const thread = next[id]
    if (!comment?.commentId || !thread) return
    const head = thread.posts[0]
    next[id] = {
      ...thread,
      posts: [
        {
          ...head,
          ...(comment.headPost?.postId && {
            google: { id: comment.headPost.postId, text: head.text },
          }),
        },
        ...thread.posts.slice(1),
      ],
      google: { doc: docId, id: comment.commentId, status: 'open' },
    }
  })
  return next
}

/**
 * What the document said or did on its linked threads that the Doc has not:
 * replies, edits of the writer's own words, resolves and reopens.
 *
 * @param {Object} given
 * @param {Document} given.document - The Doc as read
 * @param {Threads} given.threads
 * @param {string} given.docId
 * @returns {{threads: Threads, requests: object[], tooLong: string[]}}
 */
export function answersToSend({ document, threads, docId }) {
  const byId = new Map((document.comments ?? []).map(comment => [comment.commentId, comment]))
  // A suggestion's thread is answered as a comment's is, named as a
  // suggestion's; one accepted or rejected stays listed, and is done with.
  for (const suggestion of document.suggestions ?? []) {
    if (suggestion.status === 'OPEN') byId.set(suggestion.suggestionId, asComment(suggestion))
  }
  /** @type {Threads} */
  const next = { ...threads }
  /** @type {object[]} */
  const requests = []
  /** @type {string[]} */
  const long = []
  for (const [id, thread] of Object.entries(threads)) {
    const link = thread.google
    if (!link || link.doc !== docId) continue
    const suggested = !!thread.suggestion
    // A suggestion settled there, or deleted, has nothing to answer.
    if (suggested && !byId.has(link.id)) continue
    const on = suggested ? { suggestionId: link.id } : { commentId: link.id }
    // One just made is not in the read yet: it holds its first post.
    const comment = byId.get(link.id) ?? {
      commentId: link.id,
      status: 'OPEN',
      headPost: {
        postId: thread.posts[0]?.google?.id,
        content: thread.posts[0]?.text,
        author: { me: true },
      },
    }
    const posts = [...thread.posts]
    const theirs = postsIn(comment)
    const matched = matchPosts(posts, theirs)
    for (const { post, at } of matched) {
      if (at < 0) continue
      const mine = posts[at]
      const agreed = mine.google?.text ?? post.content ?? ''
      if (
        mine.text !== agreed &&
        (post.content ?? '') === agreed &&
        post.author?.me &&
        post.postId
      ) {
        // The writer's own words, edited here.
        requests.push({
          updateCommentPost: { ...on, postId: post.postId, content: mine.text },
        })
        posts[at] = { ...mine, google: { id: post.postId, text: mine.text } }
      } else {
        posts[at] = { ...mine, google: { id: post.postId ?? '', text: agreed } }
      }
    }
    const sent = new Set(matched.map(each => each.at))
    posts.forEach((post, i) => {
      // A comment's first post is the comment; a suggestion's posts are all replies.
      if (sent.has(i) || (i === 0 && !suggested) || post.author === 'person' || post.google?.id)
        return
      if (tooLong(post.text)) {
        long.push(id)
        return
      }
      requests.push({ addCommentReply: { ...on, post: { content: post.text } } })
    })
    let status = link.status
    const there = statusOf(comment)
    // A suggestion is settled by accepting or rejecting it (`drive/suggestions`).
    if (thread.status !== link.status && !suggested) {
      if (there === link.status) {
        requests.push({
          addCommentReply: {
            commentId: link.id,
            post: { commentAction: thread.status === 'resolved' ? 'RESOLVE' : 'REOPEN' },
          },
        })
      }
      if (there === link.status || there === thread.status) status = thread.status
    }
    next[id] = { ...thread, posts, google: { ...link, status } }
  }
  return { threads: next, requests, tooLong: long }
}

/**
 * The Doc's threads brought into the document: new ones on their words,
 * replies, edits, resolves and reopens on those it has.
 *
 * @param {Object} given
 * @param {Document} given.document - The Doc as read last
 * @param {ReadDoc} given.read - It, as the converter read it
 * @param {Node} given.doc - The document as it is to be, its comments on it
 * @param {Threads} given.threads
 * @param {string} given.docId
 * @param {string|undefined} given.tabId
 * @returns {{doc: Node, threads: Threads, came: number, changed: number}} The
 *   posts that came in, and everything the Doc changed here: those, edits,
 *   resolves and reopens
 */
export function commentsIn({ document, read, doc, threads, docId, tabId }) {
  threads = Object.fromEntries(
    Object.entries(threads).map(([id, thread]) => [id, ownLinks(thread, docId)])
  )
  const places = new Places(read, doc)
  const tab =
    document.tabs?.find(each => !tabId || each.tabProperties?.tabId === tabId) ?? document.tabs?.[0]
  const anchors = tab?.documentTab?.commentAnchors ?? document.commentAnchors ?? {}
  const mark = schema.marks.comment
  const transform = new Transform(doc)
  const placed = new Set(commentRanges(doc).map(range => range.id))
  /** @type {Threads} */
  const next = { ...threads }
  let came = 0
  let changed = 0

  /** @param {string} id @param {DocComment} comment @returns {boolean} */
  const putOn = (id, comment) => {
    let any = false
    for (const range of anchors[comment.anchorId ?? '']?.ranges ?? []) {
      const at = places.inDocument({
        startIndex: range.startIndex ?? 0,
        endIndex: range.endIndex ?? 0,
        segmentId: range.segmentId,
      })
      if (!at) continue
      transform.addMark(at.from, at.to, mark.create({ id }))
      any = true
    }
    return any
  }

  /** @type {Map<string, string>} */
  const byGoogle = new Map()
  for (const [id, thread] of Object.entries(next)) {
    if (thread.google?.doc === docId && !thread.suggestion) byGoogle.set(thread.google.id, id)
  }
  const there = new Set()
  for (const comment of document.comments ?? []) {
    there.add(comment.commentId)
    const status = statusOf(comment)
    const id = byGoogle.get(comment.commentId)
    if (!id) {
      if (status !== 'open') continue
      const posts = postsIn(comment).map(postFrom)
      if (posts.length === 0) continue
      const fresh = newCommentId()
      putOn(fresh, comment)
      next[fresh] = {
        status: 'open',
        quote: comment.plainTextQuote ?? '',
        posts,
        google: { doc: docId, id: comment.commentId, status: 'open' },
      }
      came += posts.length
      continue
    }

    const thread = next[id]
    const across = postsAcross(thread, comment)
    const { posts } = across
    came += across.came
    changed += across.changed
    let { status: now } = thread
    if (status !== thread.google?.status && status !== now) {
      if (status === 'resolved') transform.removeMark(0, doc.content.size, mark.create({ id }))
      else if (!placed.has(id)) putOn(id, comment)
      now = status
      changed++
    }
    next[id] = {
      ...thread,
      status: now,
      posts,
      google: { doc: docId, id: comment.commentId, status },
    }
  }

  // Gone from the Doc, as only its author can take it: resolved here. A
  // suggestion's thread is `drive/suggestions`'.
  for (const [id, thread] of Object.entries(next)) {
    if (thread.google?.doc !== docId || thread.suggestion || there.has(thread.google.id)) continue
    transform.removeMark(0, doc.content.size, mark.create({ id }))
    const { google: _google, ...rest } = thread
    next[id] = { ...rest, status: 'resolved' }
    if (thread.status !== 'resolved') changed++
  }
  return { doc: transform.doc, threads: next, came, changed: came + changed }
}
