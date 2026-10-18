/**
 * @module editor/comments
 * @description A comment on a passage: its place in the text, and its thread
 * on the document's row.
 *
 * A writer highlights a run of text and says something about it; the model
 * reads it, answers, and resolves it. The passage has to survive every edit
 * around it and every round trip through the file format, so its place is in
 * the text itself: a mark in the editor and, in the markdown, CriticMarkup
 * that holds only an id:
 *
 *     We had a {==cold and narrow==}{>>c7k2m1<<} attic.
 *
 * What was said, by whom, and the replies are the thread, kept on the
 * document's row as `comments`, by that id (see `CommentThread`). A thread is
 * placed while its id is in the text; an open one whose id is not is stale,
 * its passage deleted, and undoing the delete places it again.
 *
 * Comments may overlap. In the editor several comment marks can sit on the
 * same text. In the markup one comment nests inside another, and where two
 * only partly overlap, one of them is written in pieces, each with its id, as
 * one over two paragraphs is:
 *
 *     We had a {==cold and {==narrow==}{>>c2<<}==}{>>c1<<}{== attic==}{>>c2<<}.
 *
 * A close ends the innermost comment still open. Text without overlaps reads
 * as it always did.
 *
 * Until 16 Oct 2026 what was said was in the markup too, as
 * `{>>c7k2m1: reword this<<}`, with each break written `<br>`. That form is
 * still read: `liftThreads` moves what it says onto a thread, which is how a
 * document from before is brought forward.
 *
 * Everything here is pure: the pattern, the helpers over a string and over
 * threads, and the markdown-it rules the parser runs. The mark spec is in
 * `schema.js` and the serializer rule in `markdown.js`, both built on what is
 * here.
 */

import { Fragment, Slice } from 'prosemirror-model'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('prosemirror-model').ResolvedPos} ResolvedPos
 * @typedef {import('../types/models.js').CommentThread} CommentThread
 * @typedef {import('../types/models.js').CommentPost} CommentPost
 * @typedef {Record<string, CommentThread>} Threads
 */

/**
 * One run of a comment, found in markdown: where its passage is in the text as
 * it reads without the markup. A comment over two paragraphs has a run in
 * each; the pieces of one written around another are one run.
 *
 * @typedef {Object} FoundComment
 * @property {string} id
 * @property {string} text - The passage it is on, as markdown, without the
 *   markup of comments inside it
 * @property {string} comment - What the old form said about it, in its
 *   markup; empty for the form that holds only the id
 * @property {boolean} legacy - Whether it is in the old form
 * @property {number} start - Where the passage starts in the text without the markup
 * @property {number} end - Where it ends
 */

/**
 * One half of a comment's markup, as written: where it is in the markdown,
 * and where in the text without the markup.
 *
 * @typedef {Object} MarkupToken
 * @property {number} from
 * @property {number} to
 * @property {number} at
 */

/**
 * A run as the markup holds it: the run, and its two halves.
 *
 * @typedef {FoundComment & {open: MarkupToken, close: MarkupToken}} MarkedRun
 */

/**
 * Markdown read for its comments: the text without the markup, and the runs.
 *
 * @typedef {{source: string, text: string, runs: MarkedRun[]}} ParsedMarkup
 */

/** How the two halves are written around a passage. */
export const OPEN_MARKUP = '{=='

/**
 * Either half of a comment's markup: the open, or the close with the id and,
 * in the old form, what was said. Global, for finding every one.
 */
const TOKEN_PATTERN = /\{==|==\}\{>>([a-z0-9]{4,12})(?:(:) ?([\s\S]*?))?<<\}/g

/** The close half alone, for the parser's closing rule. */
const CLOSE_PATTERN = /^==\}\{>>([a-z0-9]{4,12})(?:: ?[\s\S]*?)?<<\}/

/**
 * A fresh comment id: short, lower-case, and unlike a word, so it reads as a
 * handle in the markup and in a tool call.
 *
 * @returns {string}
 */
export function newCommentId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  let id = 'c'
  for (let i = 0; i < 5; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)]
  return id
}

/** A break in what the old form said, as it may be written. */
const BREAK_PATTERN = /<br\s*\/?>/gi

/**
 * The closing markup for a comment: the end of the passage, then the id.
 *
 * @param {string} id
 * @returns {string}
 */
export function closeMarkup(id) {
  return `==}{>>${id}<<}`
}

/**
 * What someone said, as a post keeps it: its lines, each with its spaces run
 * together and trimmed.
 *
 * @param {string} comment
 * @returns {string}
 */
export function cleanComment(comment) {
  return (comment || '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim()
}

/**
 * What the old form said, from its markup: its breaks as new lines.
 *
 * @param {string} markup
 * @returns {string}
 */
function commentOf(markup) {
  return markup.replace(BREAK_PATTERN, '\n')
}

/**
 * Markdown read for its comments. Each close ends the innermost comment still
 * open, as in the editor's parser; a half with no other half is text, and so
 * is an open with a blank line before its close, since the markup sits in a
 * paragraph.
 *
 * @param {string|null|undefined} content
 * @returns {ParsedMarkup}
 */
export function parseMarkup(content) {
  const source = content || ''
  if (!source.includes(OPEN_MARKUP)) return { source, text: source, runs: [] }
  const matches = [...source.matchAll(TOKEN_PATTERN)]

  // Which open each close ends.
  /** @type {number[]} */
  let stack = []
  /** @type {Map<number, number>} open index → close index */
  const pairs = new Map()
  let previous = 0
  for (let i = 0; i < matches.length; i++) {
    const at = matches[i].index ?? 0
    if (source.slice(previous, at).includes('\n\n')) stack = []
    previous = at + matches[i][0].length
    if (matches[i][0] === OPEN_MARKUP) stack.push(i)
    else if (stack.length > 0) pairs.set(/** @type {number} */ (stack.pop()), i)
  }
  const paired = new Set([...pairs.keys(), ...pairs.values()])

  // The text without the halves that pair, and where each half is in it.
  let text = ''
  let last = 0
  /** @type {Map<number, MarkupToken>} */
  const tokens = new Map()
  for (let i = 0; i < matches.length; i++) {
    if (!paired.has(i)) continue
    const from = matches[i].index ?? 0
    text += source.slice(last, from)
    last = from + matches[i][0].length
    tokens.set(i, { from, to: last, at: text.length })
  }
  text += source.slice(last)

  /** @type {MarkedRun[]} */
  const runs = []
  for (const [o, c] of pairs) {
    const open = /** @type {MarkupToken} */ (tokens.get(o))
    const close = /** @type {MarkupToken} */ (tokens.get(c))
    const match = matches[c]
    runs.push({
      id: match[1],
      text: text.slice(open.at, close.at),
      comment: commentOf(match[3] || ''),
      legacy: match[2] === ':',
      start: open.at,
      end: close.at,
      open,
      close,
    })
  }
  runs.sort((a, b) => a.start - b.start || b.end - a.end)
  return { source, text, runs }
}

/**
 * A stretch of text a comment is on, by its id.
 *
 * @typedef {{id: string, start: number, end: number}} Span
 */

/**
 * Text with comments put on it as markup, nested where they nest. Where two
 * only partly overlap, the one that starts inside the other is written in
 * pieces, and where several open at one place the one that runs on longest
 * is outermost, so there are as few pieces as can be. An empty span is no
 * comment, and spans of one id that touch are one.
 *
 * @param {string} text - Without any markup
 * @param {Span[]} spans
 * @returns {string}
 */
export function renderMarkup(text, spans) {
  const live = joinRuns(spans.filter(span => span.end > span.start))
  if (live.length === 0) return text
  const cuts = [...new Set([0, text.length, ...live.flatMap(s => [s.start, s.end])])].sort(
    (a, b) => a - b
  )
  /** @type {Span[]} */
  const open = []
  let written = ''
  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]]
    const here = live.filter(span => span.start <= from && span.end >= to)
    // Close down to the first comment that does not go on.
    const stop = open.findIndex(span => !here.includes(span))
    if (stop !== -1) {
      while (open.length > stop) written += closeMarkup(/** @type {Span} */ (open.pop()).id)
    }
    const opening = here
      .filter(span => !open.includes(span))
      .sort((a, b) => b.end - a.end || a.start - b.start)
    for (const span of opening) {
      written += OPEN_MARKUP
      open.push(span)
    }
    written += text.slice(from, to)
  }
  while (open.length > 0) written += closeMarkup(/** @type {Span} */ (open.pop()).id)
  return written
}

/**
 * Runs with the pieces of each comment that touch made one, in the order they
 * start: what a comment written around another reads as.
 *
 * @template {Span & {text?: string}} T
 * @param {T[]} runs
 * @returns {T[]}
 */
function joinRuns(runs) {
  /** @type {T[]} */
  const joined = []
  /** @type {Map<string, T>} */
  const last = new Map()
  for (const run of [...runs].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const before = last.get(run.id)
    if (before && run.start <= before.end) {
      if (run.end > before.end) {
        if (before.text !== undefined && run.text !== undefined) {
          before.text += run.text.slice(before.end - run.start)
        }
        before.end = run.end
      }
      continue
    }
    const copy = { ...run }
    joined.push(copy)
    last.set(run.id, copy)
  }
  return joined
}

/**
 * Where a place in the text without the markup is in the markdown: after
 * the comments that close there and before those that open.
 *
 * @param {ParsedMarkup} parsed
 * @param {number} at
 * @returns {number}
 */
function markupOffset(parsed, at) {
  let offset = at
  let opens = Infinity
  for (const run of parsed.runs) {
    for (const [token, kind] of /** @type {const} */ ([
      [run.open, 'open'],
      [run.close, 'close'],
    ])) {
      const length = token.to - token.from
      if (token.at < at || (token.at === at && kind === 'close')) offset += length
      else if (token.at === at) opens = Math.min(opens, token.from)
    }
  }
  return Math.min(offset, opens)
}

/**
 * A change to a stretch of the text and the comments over it, as a change to
 * the markdown. The stretch is widened over every comment it reaches, and
 * over every one those reach, so that the markup there is written again
 * whole: `change` is handed the text of the stretch and the runs in it, by
 * where they are in it, and gives back what they become.
 *
 * @param {ParsedMarkup} parsed
 * @param {number} from - In the text without the markup
 * @param {number} to
 * @param {(stretch: {start: number, text: string, runs: Array<FoundComment>}) => {text: string, runs: Span[]}} change
 * @returns {{old: string, new: string, from: number, to: number, start: number, end: number}}
 *   The markdown it replaces, where, and what with; and the stretch
 */
function changeStretch(parsed, from, to, change) {
  // Whole runs: a comment written in pieces is changed as one.
  const runs = joinRuns(parsed.runs)
  let start = from
  let end = to
  for (let grown = true; grown; ) {
    grown = false
    for (const run of runs) {
      const reached =
        start === end ? run.start < start && run.end > start : run.start < end && run.end > start
      if (!reached || (run.start >= start && run.end <= end)) continue
      start = Math.min(start, run.start)
      end = Math.max(end, run.end)
      grown = true
    }
  }
  const inside = runs
    .filter(run => run.start >= start && run.end <= end && run.end > run.start)
    .map(run => ({ ...run, start: run.start - start, end: run.end - start }))
  const changed = change({ start, text: parsed.text.slice(start, end), runs: inside })
  const markupFrom = markupOffset(parsed, start)
  const markupTo = markupOffset(parsed, end)
  return {
    old: parsed.source.slice(markupFrom, markupTo),
    new: renderMarkup(changed.text, changed.runs),
    from: markupFrom,
    to: markupTo,
    start,
    end,
  }
}

/**
 * Markdown with the halves of some comments' markup taken out, their
 * passages left.
 *
 * @param {ParsedMarkup} parsed
 * @param {(run: MarkedRun) => boolean} take
 * @returns {string}
 */
function withoutRuns(parsed, take) {
  const cuts = parsed.runs
    .filter(take)
    .flatMap(run => [run.open, run.close])
    .sort((a, b) => b.from - a.from)
  let written = parsed.source
  for (const cut of cuts) written = written.slice(0, cut.from) + written.slice(cut.to)
  return written
}

/**
 * Every run of every comment in a piece of markdown, in the order they start.
 *
 * @param {string|null|undefined} content
 * @returns {FoundComment[]}
 */
export function findComments(content) {
  return joinRuns(parseMarkup(content).runs.map(({ open: _open, close: _close, ...run }) => run))
}

/**
 * Markdown with its comments' markup written the one way it is written
 * everywhere, as `renderMarkup` writes it: nested by where each comment
 * starts and ends, not by the order they were made in, and the pieces of one
 * that touch made one. Each half stays where it was in the text.
 *
 * @param {string} content
 * @returns {string}
 */
export function settleComments(content) {
  if (!content.includes(OPEN_MARKUP)) return content
  const parsed = parseMarkup(content)
  return parsed.runs.length === 0 ? content : renderMarkup(parsed.text, parsed.runs)
}

/**
 * Markdown as it reads without its comments: each passage left, what was
 * said about it gone.
 *
 * @param {string|null|undefined} content
 * @returns {string}
 */
export function withoutComments(content) {
  return parseMarkup(content).text
}

/** Either half of a comment's markup, as a quote that starts or ends inside one has it. */
const HALF_PATTERN = /\{==|==\}\{>>[a-z0-9]{4,12}(?:: ?[\s\S]*?)?<<\}/g

/**
 * A quote from text with comments in it, as it reads without them. A quote
 * cut from the middle of a comment has half of its markup, which goes too.
 *
 * @param {string} quote
 * @returns {string}
 */
export function quoteWithoutComments(quote) {
  return withoutComments(quote).replace(HALF_PATTERN, '')
}

/**
 * Where a passage is in a text nearest to where it was, or -1.
 *
 * @param {string} text
 * @param {string} passage
 * @param {number} near
 * @returns {number}
 */
function nearest(text, passage, near) {
  if (!passage) return -1
  let best = -1
  for (let at = text.indexOf(passage); at !== -1; at = text.indexOf(passage, at + 1)) {
    if (best === -1 || Math.abs(at - near) < Math.abs(best - near)) best = at
  }
  return best
}

/**
 * An edit made on the text as it reads, without the comments' markup, as an
 * edit to the markdown that holds them. What it replaces takes in the whole
 * of any comment it reaches, and of any comment over that one. A comment
 * whose passage comes through the edit unchanged is put back on it; one
 * whose passage it changed is resolved, its markup gone with the old words,
 * and is named in what comes back.
 *
 * @param {string} content - The markdown, comments and all
 * @param {string} old - The passage to change, as it reads without them
 * @param {string} replacement - What it becomes, without them
 * @returns {{count: number, old: string, new: string, resolved: FoundComment[]}}
 *   How many times `old` is in the text, and when once, the edit to make
 */
export function editAroundComments(content, old, replacement) {
  const parsed = parseMarkup(content)
  const { text, runs } = parsed
  const count = old ? text.split(old).length - 1 : 0
  if (count !== 1 || runs.length === 0) return { count, old, new: replacement, resolved: [] }

  const from = text.indexOf(old)
  const to = from + old.length
  /** @type {FoundComment[]} */
  const lost = []
  /** @type {Set<string>} */
  const kept = new Set()
  const edit = changeStretch(parsed, from, to, stretch => {
    const a = from - stretch.start
    const b = to - stretch.start
    const becomes = stretch.text.slice(0, a) + replacement + stretch.text.slice(b)
    const shift = replacement.length - (b - a)
    /** @type {Span[]} */
    const spans = []
    for (const run of stretch.runs) {
      let span = null
      if (run.end <= a) span = run
      else if (run.start >= b) span = { ...run, start: run.start + shift, end: run.end + shift }
      else {
        // Its words came through the edit if they are still there; nearest
        // where they were, since they may be there more than once.
        const at = nearest(becomes, run.text, run.start)
        if (at !== -1) span = { ...run, start: at, end: at + run.text.length }
      }
      if (span) {
        spans.push(span)
        kept.add(run.id)
      } else lost.push(run)
    }
    return { text: becomes, runs: spans }
  })

  // Resolved once no run of it is left, here or in another paragraph.
  for (const run of runs) if (run.end <= edit.start || run.start >= edit.end) kept.add(run.id)
  const resolved = lost.filter(
    (run, i) => !kept.has(run.id) && lost.findIndex(other => other.id === run.id) === i
  )
  return { count, old: edit.old, new: edit.new, resolved }
}

/**
 * A whole new body for a document that has comments, with each comment put
 * back on its passage where the new body still says it, word for word and
 * once, overlapping as they did. The body's own markup is taken out first:
 * what the model writes never makes a comment, and one it copied comes back
 * the way the rest do. A comment with a run whose words are gone, or there
 * more than once, is resolved, and named in what comes back.
 *
 * @param {string} content - The document as it is, comments and all
 * @param {string} body - What it becomes
 * @returns {{body: string, resolved: FoundComment[]}}
 */
export function rewriteAroundComments(content, body) {
  const written = withoutComments(body)
  const runs = findComments(content)
  /** @type {Map<string, Span[]>} */
  const placed = new Map()
  /** @type {Set<string>} */
  const lost = new Set()
  for (const run of runs) {
    const times = run.text ? written.split(run.text).length - 1 : 0
    if (times !== 1) {
      lost.add(run.id)
      continue
    }
    const start = written.indexOf(run.text)
    const spans = placed.get(run.id) ?? []
    spans.push({ id: run.id, start, end: start + run.text.length })
    placed.set(run.id, spans)
  }
  const kept = [...placed].filter(([id]) => !lost.has(id)).flatMap(([, spans]) => spans)
  const resolved = runs.filter(
    (run, i) => lost.has(run.id) && runs.findIndex(other => other.id === run.id) === i
  )
  return { body: renderMarkup(written, kept), resolved }
}

/**
 * How many runs of comments a piece of markdown holds.
 *
 * @param {string|null|undefined} content
 * @returns {number}
 */
export function countComments(content) {
  return parseMarkup(content).runs.length
}

// ============================================================================
// Threads
// ============================================================================

/** How much of the text on each side of a passage its thread keeps. */
const CONTEXT_CHARS = 32

/**
 * A post, as someone just wrote it.
 *
 * @param {string} author - `writer` or `model`
 * @param {string} text
 * @param {number} [now]
 * @returns {CommentPost}
 */
export function newPost(author, text, now = Date.now()) {
  return { author, text: cleanComment(text), created: now }
}

/**
 * A thread, opened on a passage by its first post.
 *
 * @param {CommentPost} post
 * @param {string} quote - The passage, as markdown
 * @returns {CommentThread}
 */
export function newThread(post, quote) {
  return { status: 'open', quote, posts: [post] }
}

/**
 * The ids whose markers are in a piece of markdown: the threads it places.
 *
 * @param {string|null|undefined} content
 * @returns {Set<string>}
 */
export function placedIds(content) {
  return new Set(parseMarkup(content).runs.map(run => run.id))
}

/**
 * How a thread stands: open on its passage, stale with its passage gone, or
 * resolved. A marker in the text makes it open whatever it says, which is how
 * undoing a resolve opens it again.
 *
 * @param {CommentThread} thread
 * @param {boolean} placed - Whether its id is in the text
 * @returns {'open'|'stale'|'resolved'}
 */
export function threadState(thread, placed) {
  if (placed) return 'open'
  return thread.status === 'resolved' ? 'resolved' : 'stale'
}

/**
 * The words before and after a stretch of text, within its line and cut
 * back to whole words.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {{before: string, after: string}}
 */
function wordsAround(text, start, end) {
  const from = Math.max(0, start - CONTEXT_CHARS)
  const to = Math.min(text.length, end + CONTEXT_CHARS)
  let before = text.slice(from, start)
  const lineStart = before.lastIndexOf('\n')
  if (lineStart !== -1) before = before.slice(lineStart + 1)
  else if (/\S/.test(text[from - 1] || '')) before = before.replace(/^\S*\s/, '')
  let after = text.slice(end, to)
  const lineEnd = after.indexOf('\n')
  if (lineEnd !== -1) after = after.slice(0, lineEnd)
  else if (/\S/.test(text[to] || '')) after = after.replace(/\s\S*$/, '')
  return { before, after }
}

/**
 * Threads brought up to date with the text: each placed one open, with its
 * passage and the words around it as they read now, so that a thread whose
 * passage goes later still knows what it was on and where. The same object
 * back when nothing changed, so a save that touched no comment writes none.
 *
 * @param {string|null|undefined} content
 * @param {Threads|undefined} threads
 * @returns {Threads|undefined}
 */
export function settleThreads(content, threads) {
  if (!threads || Object.keys(threads).length === 0) return threads
  const { text } = parseMarkup(content)
  /** @type {Map<string, FoundComment[]>} */
  const runs = new Map()
  for (const run of findComments(content)) {
    const list = runs.get(run.id)
    if (list) list.push(run)
    else runs.set(run.id, [run])
  }

  let changed = false
  /** @type {Threads} */
  const next = {}
  for (const [id, thread] of Object.entries(threads)) {
    const placed = runs.get(id)
    if (!placed) {
      next[id] = thread
      continue
    }
    const quote = placed.map(run => run.text).join('\n\n')
    const end = Math.max(...placed.map(run => run.end))
    const { before, after } = wordsAround(text, placed[0].start, end)
    if (
      thread.status === 'open' &&
      thread.quote === quote &&
      (thread.before || '') === before &&
      (thread.after || '') === after
    ) {
      next[id] = thread
      continue
    }
    next[id] = { ...thread, status: 'open', quote, before, after }
    changed = true
  }
  return changed ? next : threads
}

/**
 * Markdown in the form from before 16 Oct 2026 brought forward: what each
 * comment said moved out of its markup onto a thread of its own, the
 * writer's, and the markup left holding the id. A thread there is already
 * for an id is kept as it is.
 *
 * @param {string} content
 * @param {Threads|undefined} threads
 * @param {number} [now] - When the moved posts say they were written
 * @returns {{content: string, threads: Threads|undefined, lifted: number}}
 */
export function liftThreads(content, threads, now = Date.now()) {
  const legacy = parseMarkup(content).runs.filter(run => run.legacy)
  if (legacy.length === 0) return { content, threads, lifted: 0 }

  /** @type {Threads} */
  const next = { ...threads }
  let written = content
  for (const run of [...legacy].sort((a, b) => b.close.from - a.close.from)) {
    written = written.slice(0, run.close.from) + closeMarkup(run.id) + written.slice(run.close.to)
  }
  for (const run of legacy) {
    if (!next[run.id]) next[run.id] = newThread(newPost('writer', run.comment, now), run.text)
  }
  return { content: written, threads: settleThreads(written, next), lifted: legacy.length }
}

/**
 * Markdown with the markers that have no thread taken out, their passages
 * left: one pasted from another document, or written by hand.
 *
 * @param {string} content
 * @param {Threads|undefined} threads
 * @returns {string}
 */
export function withThreadsOnly(content, threads) {
  if (!content.includes(OPEN_MARKUP)) return content
  return withoutRuns(parseMarkup(content), run => !threads?.[run.id])
}

/**
 * How many of a document's comments are open: on their passages, or stale
 * with their passages gone, and not resolved. Saving the text keeps a
 * placed thread open (`settleThreads`), so the row says it without the text.
 *
 * @param {Threads|undefined} threads
 * @returns {number}
 */
export function countOpen(threads) {
  if (!threads) return 0
  return Object.values(threads).filter(thread => thread.status === 'open').length
}

/**
 * Whether two versions of a thread say the same: its standing and its posts.
 * Where its passage is, and the words around it, follow the text and are
 * not what anyone said.
 *
 * @param {CommentThread|null|undefined} a
 * @param {CommentThread|null|undefined} b
 * @returns {boolean}
 */
export function sameThread(a, b) {
  if (!a || !b) return !a && !b
  return a.status === b.status && JSON.stringify(a.posts) === JSON.stringify(b.posts)
}

/**
 * Markdown with a thread's marker put back on its passage, for a resolved
 * thread opened again: where its quote is once, or once among several with
 * the words that were around it, over other comments or not. Null when that
 * place cannot be told: the words are gone, or are there more than once
 * with nothing to choose between them. Within one paragraph only, as the
 * markup is.
 *
 * @param {string} content
 * @param {string} id
 * @param {CommentThread} thread
 * @returns {string|null}
 */
export function placeThread(content, id, thread) {
  const quote = thread.quote || ''
  if (!quote.trim() || quote.includes('\n')) return null
  const parsed = parseMarkup(content)
  const { text } = parsed

  /** @type {number[]} */
  const spots = []
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) spots.push(at)
  const chosen =
    spots.length === 1
      ? spots
      : spots.filter(
          at =>
            text.slice(0, at).endsWith(thread.before || '') &&
            text.slice(at + quote.length).startsWith(thread.after || '')
        )
  if (chosen.length !== 1) return null
  return commentOn(content, chosen[0], chosen[0] + quote.length, id)
}

/**
 * Markdown with a new comment's marker on a stretch of its text, as the text
 * reads without the markup: over other comments or not, written as nesting
 * needs. Null for an empty stretch.
 *
 * @param {string} content
 * @param {number} start
 * @param {number} end
 * @param {string} id
 * @returns {string|null}
 */
export function commentOn(content, start, end, id) {
  if (end <= start) return null
  const parsed = parseMarkup(content)
  const edit = changeStretch(parsed, start, end, stretch => ({
    text: stretch.text,
    runs: [...stretch.runs, { id, start: start - stretch.start, end: end - stretch.start }],
  }))
  return content.slice(0, edit.from) + edit.new + content.slice(edit.to)
}

/**
 * A thread as a read lists it: where its passage is in the text as read.
 *
 * @typedef {Object} PlacedThread
 * @property {string} id
 * @property {CommentThread} thread
 * @property {number} start - Where its passage starts in the text
 * @property {number} end - Where its last run ends
 */

/**
 * Markdown as the model reads it, without the comments' markup, and each
 * thread its text places, in the order their passages start. A marker with
 * no thread is only taken out.
 *
 * @param {string|null|undefined} content
 * @param {Threads|undefined} threads
 * @returns {{text: string, placed: PlacedThread[]}}
 */
export function readableText(content, threads) {
  const { text, runs } = parseMarkup(content)
  /** @type {Map<string, PlacedThread>} */
  const byId = new Map()
  for (const run of runs) {
    const thread = threads?.[run.id]
    if (!thread) continue
    const held = byId.get(run.id)
    if (held) held.end = Math.max(held.end, run.end)
    else byId.set(run.id, { id: run.id, thread, start: run.start, end: run.end })
  }
  return { text, placed: [...byId.values()] }
}

/** How far a passage's context grows at a step, and how far at most. */
const WIDEN_STEP = 20
const WIDEN_LIMIT = 200

/**
 * A passage, and what tells it apart where its words are in the text more
 * than once: the passage with as much around it as makes it once, the way an
 * undo pair is widened (see utils/edits.js), or past a paragraph's length,
 * which of its occurrences it is.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {{passage: string, in?: string, occurrence?: string}}
 */
export function passageInText(text, start, end) {
  const passage = text.slice(start, end)
  const times = (/** @type {string} */ needle) => text.split(needle).length - 1
  if (!passage || times(passage) === 1) return { passage }
  for (let pad = WIDEN_STEP; pad <= WIDEN_LIMIT; pad += WIDEN_STEP) {
    const around = text.slice(Math.max(0, start - pad), Math.min(text.length, end + pad))
    if (times(around) === 1) return { passage, in: around }
  }
  const nth = text.slice(0, start).split(passage).length
  return { passage, occurrence: `${nth} of ${times(passage)}` }
}

/**
 * Markdown with one comment's markers taken out, its passage left.
 *
 * @param {string} content
 * @param {string} id
 * @returns {string}
 */
export function withoutComment(content, id) {
  return withoutRuns(parseMarkup(content), run => run.id === id)
}

/**
 * @typedef {{id: string, from: number, to: number}} CommentRange
 */

/**
 * The runs of comment marks over a sequence of inline nodes, each run as far
 * as its mark goes on unbroken: several over the same text where comments
 * overlap. In the order they start.
 *
 * @param {Array<{node: Node, pos: number}>} pieces - In order
 * @param {import('prosemirror-model').MarkType} type
 * @returns {CommentRange[]}
 */
function runsOver(pieces, type) {
  /** @type {CommentRange[]} */
  const ranges = []
  /** @type {Map<string, CommentRange>} */
  const going = new Map()
  for (const { node, pos } of pieces) {
    for (const mark of node.marks) {
      if (mark.type !== type) continue
      const id = mark.attrs.id
      const held = going.get(id)
      if (held && held.to === pos) held.to = pos + node.nodeSize
      else {
        const range = { id, from: pos, to: pos + node.nodeSize }
        ranges.push(range)
        going.set(id, range)
      }
    }
  }
  return ranges
}

/**
 * The comments in an editor document, as the ranges their marks cover.
 *
 * A mark on text that runs across a paragraph is the same id on two runs;
 * each run is a range here, so a click on either finds the comment. Where
 * comments overlap their ranges do too. A picture or a line break in a
 * passage is part of it, not the end of a run.
 *
 * @param {Node} doc
 * @returns {CommentRange[]}
 */
export function commentRanges(doc) {
  const type = doc.type.schema.marks.comment
  if (!type) return []
  /** @type {Array<{node: Node, pos: number}>} */
  const pieces = []
  doc.descendants((node, pos) => {
    if (node.isInline) pieces.push({ node, pos })
  })
  return runsOver(pieces, type)
}

/**
 * A slice with the comment marks taken off that it may not keep: a paste
 * that would put a second marker of one thread in a document, or a marker
 * whose thread is in another.
 *
 * @param {Slice} slice
 * @param {(id: string) => boolean} keep - Whether a comment's marker stays
 * @returns {Slice}
 */
export function keepComments(slice, keep) {
  let changed = false
  const strip = (/** @type {Fragment} */ fragment) => {
    /** @type {Node[]} */
    const nodes = []
    fragment.forEach(node => {
      const marks = node.marks.filter(m => m.type.name !== 'comment' || keep(m.attrs.id))
      if (marks.length !== node.marks.length) {
        changed = true
        node = node.mark(marks)
      }
      nodes.push(node.isText || node.childCount === 0 ? node : node.copy(strip(node.content)))
    })
    return Fragment.from(nodes)
  }
  const content = strip(slice.content)
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice
}

/**
 * The comment the position is in, or against at either end: its id, and the
 * run of it in this textblock. Where comments overlap, the one on the fewest
 * words, the innermost, and of two as short the one that starts later.
 *
 * @param {ResolvedPos} $pos
 * @returns {CommentRange|null}
 */
export function commentAround($pos) {
  const type = $pos.doc.type.schema.marks.comment
  if (!type || !$pos.parent.inlineContent) return null
  /** @type {Array<{node: Node, pos: number}>} */
  const pieces = []
  const start = $pos.start()
  $pos.parent.forEach((node, offset) => pieces.push({ node, pos: start + offset }))
  const around = runsOver(pieces, type)
    .filter(range => range.from <= $pos.pos && $pos.pos <= range.to)
    .sort((a, b) => a.to - a.from - (b.to - b.from) || b.from - a.from)
  return around[0] ?? null
}

/**
 * A comment's place as a list shows it: once, however many runs its mark
 * has, with the passage as it reads rather than as markdown. What was said
 * is on its thread.
 *
 * @typedef {Object} CommentEntry
 * @property {string} id
 * @property {string} passage - The text it is on, its runs joined with a space
 */

/**
 * Entries in the order their comments start, the runs of one id joined.
 *
 * @param {CommentEntry[]} runs
 * @returns {CommentEntry[]}
 */
function entriesOf(runs) {
  /** @type {Map<string, CommentEntry>} */
  const byId = new Map()
  for (const run of runs) {
    const entry = byId.get(run.id)
    if (entry) entry.passage += ` ${run.passage}`
    else byId.set(run.id, { ...run })
  }
  return [...byId.values()]
}

/**
 * The comments in an editor document, one entry each.
 *
 * @param {Node} doc
 * @returns {CommentEntry[]}
 */
export function commentsInDoc(doc) {
  return entriesOf(
    commentRanges(doc).map(range => ({
      id: range.id,
      passage: doc.textBetween(range.from, range.to, ' ', ' '),
    }))
  )
}

/**
 * The comments in a piece of markdown, one entry each: what `commentsInDoc`
 * gives for the same text, without parsing it.
 *
 * @param {string|null|undefined} content
 * @returns {CommentEntry[]}
 */
export function commentsInMarkdown(content) {
  if (!content?.includes(OPEN_MARKUP)) return []
  return entriesOf(
    findComments(content).map(run => ({ id: run.id, passage: plainPassage(run.text) }))
  )
}

/**
 * A passage's markdown as it reads: a link as its text, the emphasis, code
 * and strikethrough delimiters taken off, escapes undone. Only the inline
 * markdown the serializer writes inside a comment.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function plainPassage(markdown) {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(?<!\\)(\*\*|\*|~~|`)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Where the close is that ends the comment opening at a place: past every
 * comment that opens and closes inside it. Null when it has none.
 *
 * @param {string} src
 * @param {number} pos - At the open
 * @param {number} max
 * @returns {{id: string, end: number}|null}
 */
function closeOf(src, pos, max) {
  let depth = 0
  for (let at = pos + OPEN_MARKUP.length; at < max; ) {
    if (src.startsWith(OPEN_MARKUP, at)) {
      depth++
      at += OPEN_MARKUP.length
      continue
    }
    if (src.startsWith('==}', at)) {
      const close = CLOSE_PATTERN.exec(src.slice(at, max))
      if (close) {
        if (depth === 0) return { id: close[1], end: at + close[0].length }
        depth--
        at += close[0].length
        continue
      }
    }
    at++
  }
  return null
}

/**
 * What the rules keep over one parse of a run of inline content: how many
 * comments are open, and whether any has.
 *
 * @typedef {{depth: number, opened: boolean}} CommentCount
 */

/**
 * The markdown-it rules that read the markup: one that opens a comment at
 * `{==` when its close is ahead, past any comment inside it, and one that
 * closes the innermost comment open at `==}{>>…<<}`. The parser maps
 * `comment_open` and `comment_close` to the mark, both with the id, so that
 * a close ends only its own comment (see `markdown.js`).
 *
 * A rule scanning past text without reading it, as a link does to find the
 * end of its text, runs the rules silently, and each has to move past what
 * it matched: to it a comment is one thing, so a `]` in what was said does
 * not end the link. A close another rule swallows — a code span running
 * over it — leaves its open with nothing to end it, and that open is put
 * back as the text it was, so a comment never runs on past its paragraph.
 *
 * How many comments are open is counted for each parse of a run of text,
 * not in the parser's `env`, which a picture's alt text, read in a parse of
 * its own, shares with the passage around it.
 *
 * @param {import('markdown-it').MarkdownIt} md
 */
export function commentMarkupPlugin(md) {
  /** @type {WeakMap<import('markdown-it').StateInline, CommentCount>} */
  const counts = new WeakMap()
  /** @param {import('markdown-it').StateInline} state */
  const countOf = state => {
    let count = counts.get(state)
    if (!count) counts.set(state, (count = { depth: 0, opened: false }))
    return count
  }

  md.inline.ruler.before(
    'emphasis',
    'comment',
    /** @type {(state: import('markdown-it').StateInline, silent: boolean) => boolean} */ (
      (state, silent) => {
        const { src, pos, posMax } = state
        if (!src.startsWith(OPEN_MARKUP, pos)) return false
        const close = closeOf(src, pos, posMax)
        if (!close) return false
        if (silent) {
          state.pos = close.end
          return true
        }

        const token = state.push('comment_open', 'mark', 1)
        token.attrSet('id', close.id)
        state.pos += OPEN_MARKUP.length
        const count = countOf(state)
        count.depth++
        count.opened = true
        return true
      }
    )
  )

  md.inline.ruler.before(
    'emphasis',
    'comment_close',
    /** @type {(state: import('markdown-it').StateInline, silent: boolean) => boolean} */ (
      (state, silent) => {
        const { src, pos, posMax } = state
        const count = counts.get(state)
        if (!count?.depth || !src.startsWith('==}', pos)) return false
        const match = CLOSE_PATTERN.exec(src.slice(pos, posMax))
        if (!match) return false
        if (!silent) {
          const token = state.push('comment_close', 'mark', -1)
          token.attrSet('id', match[1])
          token.markup = match[0]
          count.depth--
        }
        state.pos += match[0].length
        return true
      }
    )
  )

  md.inline.ruler2.push(
    'comment_balance',
    /** @type {(state: import('markdown-it').StateInline) => boolean} */ (
      state => {
        // Run when any comment opened: closes of other ids count its depth
        // down as well.
        if (!counts.get(state)?.opened) return false
        // Each close ends the latest open of its id; a half left over is the
        // text it was.
        /** @type {number[]} */
        const open = []
        /** @type {number[]} */
        const loose = []
        state.tokens.forEach((token, i) => {
          if (token.type === 'comment_open') open.push(i)
          else if (token.type === 'comment_close') {
            const id = token.attrGet('id')
            let at = open.length - 1
            while (at >= 0 && state.tokens[open[at]].attrGet('id') !== id) at--
            if (at === -1) loose.push(i)
            else open.splice(at, 1)
          }
        })
        for (const i of [...open, ...loose]) {
          const text = new state.Token('text', '', 0)
          text.content =
            state.tokens[i].type === 'comment_open' ? OPEN_MARKUP : state.tokens[i].markup
          state.tokens[i] = text
        }
        counts.delete(state)
        return false
      }
    )
  )
}
