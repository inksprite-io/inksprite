/**
 * @module editor/comments
 * @description A comment on a passage, in the text itself.
 *
 * A writer highlights a run of text and says something about it; the model
 * reads the document, sees the comment where it sits, and resolves it — with
 * a new passage, or by taking it as read. The comment has to survive every
 * edit around it and every round trip through the file format, so it is not
 * a position kept beside the document: it is a mark in the editor and, in
 * the markdown, CriticMarkup with an id:
 *
 *     We had a {==cold and narrow==}{>>c7k2m1: reword this<<} attic.
 *
 * `{== ==}` is the passage, `{>> <<}` the comment, and the id is how a tool
 * names one. The plain-text view shows the markup as it is; the editor shows
 * the passage highlighted with the comment on hover; the model reads the
 * markup as part of the text, which is the point.
 *
 * A comment can run to more than one line, and each break is written `<br>`,
 * as a break in a table cell is. The markup sits in a paragraph, and a raw
 * newline there would let the next line start a list or a heading and cut
 * the comment in two; in a cell it would end the row. `<br>` keeps the whole
 * comment on its line wherever the passage is. Comments do not overlap:
 * a mark of one type does not nest in the editor, and the markup has no way
 * to say it would.
 *
 * Everything here is pure: the pattern, the helpers over a string, and the
 * markdown-it rules the parser runs. The mark spec is in `schema.js` and the
 * serializer rule in `markdown.js`, both built on what is here.
 */

import { markAround } from './marks.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('prosemirror-model').ResolvedPos} ResolvedPos
 */

/**
 * A comment, found in text.
 *
 * @typedef {Object} FoundComment
 * @property {string} id
 * @property {string} text - The passage it is on
 * @property {string} comment - What was said about it
 * @property {number} from - Where the markup starts in the string
 * @property {number} to - Where it ends
 * @property {string} markup - The whole `{==…==}{>>…<<}` span, as written
 */

/**
 * One comment in markdown: the passage, then the id and what was said.
 * Global, for finding every one; the source of a fresh instance for anchoring.
 */
export const COMMENT_PATTERN = /\{==([\s\S]*?)==\}\{>>([a-z0-9]{4,12}): ?([\s\S]*?)<<\}/g

/** The close half alone, for the parser's closing rule. */
const CLOSE_PATTERN = /^==\}\{>>([a-z0-9]{4,12}): ?([\s\S]*?)<<\}/

/** How the two halves are written around a passage. */
export const OPEN_MARKUP = '{=='

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

/** A break in a comment, as the markup writes it and as it may be read. */
const BREAK_MARKUP = '<br>'
const BREAK_PATTERN = /<br\s*\/?>/gi

/**
 * The closing markup for a comment: the end of the passage, then the comment.
 *
 * @param {string} id
 * @param {string} comment
 * @returns {string}
 */
export function closeMarkup(id, comment) {
  return `==}{>>${id}: ${cleanComment(comment).replace(/\n/g, BREAK_MARKUP)}<<}`
}

/**
 * A comment's text as the markup can hold it: its lines, each with its
 * spaces run together and trimmed, and nothing in it that would close the
 * markup early.
 *
 * @param {string} comment
 * @returns {string}
 */
export function cleanComment(comment) {
  return (comment || '')
    .replace(/<<\}/g, '<< }')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim()
}

/**
 * What was said, from the markup: its breaks as new lines.
 *
 * @param {string} markup
 * @returns {string}
 */
function commentOf(markup) {
  return markup.replace(BREAK_PATTERN, '\n')
}

/**
 * Every comment in a piece of markdown, in order.
 *
 * @param {string|null|undefined} content
 * @returns {FoundComment[]}
 */
export function findComments(content) {
  /** @type {FoundComment[]} */
  const found = []
  const text = content || ''
  for (const match of text.matchAll(COMMENT_PATTERN)) {
    found.push({
      id: match[2],
      text: match[1],
      comment: commentOf(match[3]),
      from: match.index ?? 0,
      to: (match.index ?? 0) + match[0].length,
      markup: match[0],
    })
  }
  return found
}

/**
 * Markdown with its comments' markup taken out, each passage left as it
 * reads, and where each comment's passage starts and ends in what is left.
 *
 * @param {string} content
 * @returns {{text: string, comments: Array<FoundComment & {start: number, end: number}>}}
 */
function unmarked(content) {
  let text = ''
  let last = 0
  /** @type {Array<FoundComment & {start: number, end: number}>} */
  const comments = []
  for (const found of findComments(content)) {
    text += content.slice(last, found.from)
    const start = text.length
    text += found.text
    comments.push({ ...found, start, end: text.length })
    last = found.to
  }
  return { text: text + content.slice(last), comments }
}

/**
 * Markdown as it reads without its comments: each passage left, what was
 * said about it gone.
 *
 * @param {string|null|undefined} content
 * @returns {string}
 */
export function withoutComments(content) {
  return unmarked(content || '').text
}

/** Half a comment's markup, as a quote that starts or ends inside one has it. */
const HALF_PATTERN = /\{==|==\}\{>>[a-z0-9]{4,12}: ?[\s\S]*?<<\}/g

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
 * An edit made on the text as it reads, without the comments' markup, as an
 * edit to the markdown that holds them. What it replaces takes in the whole
 * of any comment it reaches. A comment whose passage comes through the edit
 * unchanged is put back on it; one whose passage it changed is resolved,
 * its markup gone with the old words, and is named in what comes back.
 *
 * @param {string} content - The markdown, comments and all
 * @param {string} old - The passage to change, as it reads without them
 * @param {string} replacement - What it becomes, without them
 * @returns {{count: number, old: string, new: string, resolved: FoundComment[]}}
 *   How many times `old` is in the text, and when once, the edit to make
 */
export function editAroundComments(content, old, replacement) {
  const { text, comments } = unmarked(content)
  const count = old ? text.split(old).length - 1 : 0
  if (count !== 1 || comments.length === 0) return { count, old, new: replacement, resolved: [] }

  const from = text.indexOf(old)
  const to = from + old.length
  const reached = comments.filter(comment => comment.start < to && comment.end > from)
  const start = Math.min(from, ...reached.map(comment => comment.start))
  const end = Math.max(to, ...reached.map(comment => comment.end))
  const becomes = text.slice(start, from) + replacement + text.slice(to, end)

  // Each comment the edit reaches, in order, put back where what it becomes
  // still has its passage, after the one before it.
  let written = ''
  let at = 0
  /** @type {FoundComment[]} */
  const resolved = []
  for (const comment of reached) {
    const passage = comment.text ? becomes.indexOf(comment.text, at) : -1
    if (passage === -1) {
      resolved.push(comment)
      continue
    }
    written += becomes.slice(at, passage) + comment.markup
    at = passage + comment.text.length
  }
  written += becomes.slice(at)

  // Where a place in the text is in the markdown. The edit's ends are never
  // inside a comment, since it takes in the whole of any it reaches.
  const stored = (/** @type {number} */ offset) => {
    let shift = 0
    for (const comment of comments) {
      if (comment.end > offset) break
      shift += comment.markup.length - comment.text.length
    }
    return offset + shift
  }

  return { count, old: content.slice(stored(start), stored(end)), new: written, resolved }
}

/**
 * How many comments a piece of markdown holds.
 *
 * @param {string|null|undefined} content
 * @returns {number}
 */
export function countComments(content) {
  return findComments(content).length
}

/**
 * The comments in an editor document, as the ranges their marks cover.
 *
 * A mark on text that runs across a paragraph is the same id on two runs;
 * each run is a range here, so a click on either finds the comment.
 *
 * @param {Node} doc
 * @returns {Array<{id: string, text: string, from: number, to: number}>}
 */
export function commentRanges(doc) {
  const type = doc.type.schema.marks.comment
  if (!type) return []
  /** @type {Array<{id: string, text: string, from: number, to: number}>} */
  const ranges = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find(m => m.type === type)
    if (!mark) return
    const last = ranges[ranges.length - 1]
    if (last && last.id === mark.attrs.id && last.to === pos) last.to = pos + node.nodeSize
    else
      ranges.push({ id: mark.attrs.id, text: mark.attrs.text, from: pos, to: pos + node.nodeSize })
  })
  return ranges
}

/**
 * The comment the position is in, or against at either end: its id, what was
 * said, and the run of it in this textblock.
 *
 * @param {ResolvedPos} $pos
 * @returns {{id: string, text: string, from: number, to: number}|null}
 */
export function commentAround($pos) {
  const type = $pos.doc.type.schema.marks.comment
  const around = type ? markAround($pos, type) : null
  if (!around) return null
  const { id, text } = around.mark.attrs
  return { id, text, from: around.from, to: around.to }
}

/**
 * A comment as a list shows it: once, however many runs its mark has, with
 * the passage as it reads rather than as markdown.
 *
 * @typedef {Object} CommentEntry
 * @property {string} id
 * @property {string} passage - The text it is on, its runs joined with a space
 * @property {string} comment - What was said about it
 */

/**
 * Entries in the order their comments start, the runs of one id joined.
 *
 * @param {Array<{id: string, passage: string, comment: string}>} runs
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
      comment: range.text,
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
    findComments(content).map(found => ({
      id: found.id,
      passage: plainPassage(found.text),
      comment: found.comment,
    }))
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
 * The markdown-it rules that read the markup: one that opens a comment at
 * `{==` when its close is ahead, and one that closes it at `==}{>>…<<}`.
 * The parser maps `comment_open` and `comment_close` to the mark, with the
 * id and text as attributes on the opening token.
 *
 * A rule scanning past text without reading it, as a link does to find the
 * end of its text, runs the rules silently, and each has to move past what
 * it matched: to it a comment is one thing, so a `]` in what was said does
 * not end the link. A close another rule swallows — a code span running
 * over it — leaves its open with nothing to end it, and that open is put
 * back as the text it was, so a comment never runs on past its paragraph.
 *
 * @param {import('markdown-it').MarkdownIt} md
 */
export function commentMarkupPlugin(md) {
  md.inline.ruler.before(
    'emphasis',
    'comment',
    /** @type {(state: import('markdown-it').StateInline, silent: boolean) => boolean} */ (
      (state, silent) => {
        const { src, pos, posMax } = state
        if (!src.startsWith(OPEN_MARKUP, pos)) return false
        const ahead = src.slice(pos, posMax)
        const whole = new RegExp(COMMENT_PATTERN.source).exec(ahead)
        if (!whole || whole.index !== 0) return false
        if (silent) {
          state.pos += whole[0].length
          return true
        }

        const token = state.push('comment_open', 'mark', 1)
        token.attrSet('id', whole[2])
        token.attrSet('text', commentOf(whole[3]))
        state.pos += OPEN_MARKUP.length
        const env = /** @type {{commentDepth?: number}} */ (state.env)
        env.commentDepth = (env.commentDepth || 0) + 1
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
        const env = /** @type {{commentDepth?: number}} */ (state.env)
        if (!env.commentDepth || !src.startsWith('==}', pos)) return false
        const match = CLOSE_PATTERN.exec(src.slice(pos, posMax))
        if (!match) return false
        if (!silent) {
          state.push('comment_close', 'mark', -1)
          env.commentDepth--
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
        const env = /** @type {{commentDepth?: number}} */ (state.env)
        if (!env.commentDepth) return false
        let open = 0
        for (let i = state.tokens.length - 1; i >= 0; i--) {
          const token = state.tokens[i]
          if (token.type === 'comment_close') open--
          else if (token.type === 'comment_open' && ++open > 0) {
            const text = new state.Token('text', '', 0)
            text.content = OPEN_MARKUP
            state.tokens[i] = text
            open--
          }
        }
        env.commentDepth = 0
        return false
      }
    )
  )
}
