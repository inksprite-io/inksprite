/**
 * @module editor/markdown
 * @description Markdown as the document's file format: what the store holds,
 * what the model reads and writes, and what a file on disk will be.
 *
 * Built on `prosemirror-markdown`, the reference implementation, with the
 * parser and serializer configured against our schema rather than inherited.
 * The parser is markdown-it's `default` preset — CommonMark plus GFM
 * strikethrough and tables — with raw HTML off, so a tag in a document is
 * text. A picture's alt text is its words as plain text, marks and all
 * dropped, as markdown-it writes it in HTML.
 *
 * A table is written the plainest way GFM reads: a pipe at each end of every
 * row, one space inside each, and no padding to line the columns up, so that
 * an edit to one cell is an edit to one line. A pipe in a cell is escaped,
 * inside code as well, since the row is cut at its pipes before anything else
 * is read. markdown-it keeps as many cells in a row as the header has and
 * drops the rest, so a table with a row longer than its header is read as the
 * text it was written as, whole: words are not lost to a save.
 *
 * A lone newline is a hard break, in both directions. A writer who ended a line
 * meant it to end there, and CommonMark's soft wrap is not a reading anyone
 * here expects. The serializer writes a hard break as a bare newline; when
 * several run together, the ones after the first are written backslash-newline,
 * which markdown-it reads as a hard break wherever it stands, so a run of
 * breaks comes back as the same run rather than as a blank line that would
 * split the paragraph.
 *
 * Text is escaped where the reference would leave it to come back as
 * something else: an entity as its character, an address in angle brackets as
 * a link, `1)` at the start of a line as a list, a `#` ending a heading as
 * its closing. A space between words is bold, italic or struck only where
 * the words on both sides of it are: one left in bold after bold italic
 * would sit between the delimiters, and markdown would read them as text.
 *
 * Two properties are pinned by tests: `parse(serialize(doc))` is `doc` for
 * every node and mark, and `serialize(parse(md))` is a fixed point after one
 * pass, which is what matters once files are edited outside the app.
 */

import MarkdownIt from 'markdown-it'
import { Fragment } from 'prosemirror-model'
import {
  MarkdownParser,
  MarkdownSerializer,
  MarkdownSerializerState,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown'
import { schema } from './schema.js'
import { OPEN_MARKUP, closeMarkup, commentMarkupPlugin, settleComments } from './comments.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('markdown-it').StateBlock} StateBlock
 * @typedef {import('markdown-it').Token} Token
 */

/**
 * How many cells markdown-it finds in a row: the line cut at every pipe not
 * escaped, less the empty ends a leading and a trailing pipe leave.
 *
 * @param {string} line
 * @returns {number}
 */
function cellsIn(line) {
  const cells = line.trim().split(/(?<!\\)\|/)
  if (cells[0] === '') cells.shift()
  if (cells.length && cells[cells.length - 1] === '') cells.pop()
  return cells.length
}

/**
 * markdown-it with GFM's table rule made to refuse a table it would lose words
 * from. The rule is run in full and its tokens taken back when a row has more
 * cells than the header — and when only asked whether a table starts here,
 * which must be answered the same way without leaving anything behind.
 *
 * @returns {import('markdown-it').MarkdownIt}
 */
function tokenizerOf() {
  const md = new MarkdownIt('default', { html: false }).use(commentMarkupPlugin)
  const ruler = /** @type {{__rules__: {name: string, fn: Function, alt: string[]}[]}} */ (
    /** @type {unknown} */ (md.block.ruler)
  )
  // Its `alt` goes with it: it is what lets a table end a paragraph.
  const { fn: gfm, alt } = ruler.__rules__.find(rule => rule.name === 'table')

  md.block.ruler.at(
    'table',
    /**
     * @param {StateBlock} state
     * @param {number} startLine
     * @param {number} endLine
     * @param {boolean} silent
     */
    (state, startLine, endLine, silent) => {
      const tokens = state.tokens.length
      const line = state.line
      if (!gfm(state, startLine, endLine, false)) return false

      const added = state.tokens.slice(tokens)
      const columns = added.filter(token => token.type === 'th_open').length
      let whole = true
      for (let row = startLine + 2; row < state.line && whole; row++) {
        const text = state.src.slice(state.bMarks[row] + state.tShift[row], state.eMarks[row])
        whole = cellsIn(text) <= columns
      }

      if (whole && !silent) return true
      state.tokens.length = tokens
      state.line = line
      return whole
    },
    { alt }
  )
  return md
}

/**
 * A cell's alignment, from the style markdown-it gives it.
 *
 * @param {Token} token
 * @returns {{align: string|null}}
 */
const alignmentOf = token => ({
  align: /text-align:(\w+)/.exec(String(token.attrGet('style') ?? ''))?.[1] || null,
})

// The reference token map is written for the same node names; it only lacks
// strikethrough and tables, reads a soft break as a space, and takes a
// picture's alt text from the first of its words' tokens alone. The header and
// the body are not kept apart: the header is the first row.
const parser = new MarkdownParser(schema, tokenizerOf(), {
  ...defaultMarkdownParser.tokens,
  image: {
    node: 'image',
    getAttrs: token => ({
      src: token.attrGet('src'),
      title: token.attrGet('title') || null,
      alt: (token.children || []).map(child => child.content).join('') || null,
    }),
  },
  softbreak: { node: 'hard_break' },
  s: { mark: 'strikethrough' },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_cell', getAttrs: alignmentOf },
  td: { block: 'table_cell', getAttrs: alignmentOf },
  comment: {
    mark: 'comment',
    getAttrs: token => ({ id: token.attrGet('id') }),
  },
})

// A comment's close ends that comment only. The reference closes every mark
// of the type, which would end a comment the closing one sits inside as well.
const { tokenHandlers } =
  /** @type {{tokenHandlers: Record<string, (state: any, token: Token) => void>}} */ (
    /** @type {unknown} */ (parser)
  )
tokenHandlers.comment_close = (state, token) => {
  const id = token.attrGet('id')
  const marks = /** @type {readonly import('prosemirror-model').Mark[]} */ (state.top().marks)
  const mark = marks.find(m => m.type === schema.marks.comment && m.attrs.id === id)
  if (mark) state.closeMark(mark)
}

/**
 * How much of the output the state keeps to look back on. Two characters would
 * do: whether a line has ended, and whether a `!` before a link is escaped.
 */
const TAIL = 16

/** How long the state's output grows before all but its tail is moved out. */
const ROOM = 256

/** Marks written as delimiters around their text, which a space can strand. */
const DELIMITED = new Set(['em', 'strong', 'strikethrough'])

/**
 * A block's inline content with each run of spaces bold, italic or struck
 * only where the text on both sides of it is too. Docs bolds a word's space
 * with the word when it is double-clicked, and a space in bold between bold
 * italic and plain text is written after the italic has closed and before
 * the bold has: `***bold italic. ***plain`, which markdown reads as text,
 * asterisks and all.
 *
 * @param {Node} parent
 * @returns {Node}
 */
function spacesAsNeighbours(parent) {
  let changed = false
  /** @type {Node[]} */
  const children = []
  parent.forEach((child, _offset, index) => {
    if (child.isText && child.marks.length > 0 && !/\S/.test(child.text ?? '')) {
      const before = index > 0 ? parent.child(index - 1).marks : []
      const after = index + 1 < parent.childCount ? parent.child(index + 1).marks : []
      const kept = child.marks.filter(
        mark => !DELIMITED.has(mark.type.name) || (mark.isInSet(before) && mark.isInSet(after))
      )
      if (kept.length < child.marks.length) {
        changed = true
        children.push(child.mark(kept))
        return
      }
    }
    children.push(child)
  })
  return changed ? parent.copy(Fragment.fromArray(children)) : parent
}

/**
 * The reference serializer, writing in time linear in the document's length.
 *
 * Its state asks whether its output ends a line before nearly every block, and
 * a string grown a piece at a time is copied whole to be read. In a long
 * document that copy is the whole document, made again for every block: 20
 * seconds for a 1.5 MB rulebook in Chromium, 40 in WebKit, every time it was
 * saved, and as long for a list of 20,000 items. Here the state holds only the
 * end of its output, and what comes before is moved out as it is written, so
 * it answers the same, at once, at any depth.
 */
class LinearSerializer extends MarkdownSerializer {
  /**
   * @param {Node} content
   * @param {{tightLists?: boolean}} [options]
   * @returns {string}
   */
  serialize(content, options = {}) {
    // The reference leaves the state's constructor out of its types.
    const State = /** @type {new (...args: unknown[]) => MarkdownSerializerState} */ (
      MarkdownSerializerState
    )
    const state = new State(this.nodes, this.marks, { ...this.options, ...options })
    const written = []
    let tail = ''
    // The reference only adds to its output or changes its last character,
    // and reads no further back than two.
    Object.defineProperty(state, 'out', {
      get: () => tail,
      set: value => {
        tail = value
        if (tail.length > ROOM) {
          written.push(tail.slice(0, -TAIL))
          tail = tail.slice(-TAIL)
        }
      },
    })
    const renderInline = state.renderInline.bind(state)
    state.renderInline = (parent, fromBlockStart) =>
      renderInline(spacesAsNeighbours(parent), fromBlockStart)
    state.renderContent(content)
    written.push(tail)
    return written.join('')
  }
}

const { nodes } = defaultMarkdownSerializer

/** An entity markdown would read as the character it names: `&amp;`, `&#42;`. */
const ENTITY = /&(?=#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/g

/** An address in angle brackets, which markdown would read as a link. */
const AUTOLINK = /<(?=[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|[^\s<>@]+@[^\s<>@]+>)/g

/**
 * Escapes the reference leaves out, after its own: text that would come back
 * as something else. An entity would come back as its character, and an
 * address in angle brackets as a link. At the start of a line, `1)`, a bare
 * `1.` or `+` would open a list, and a line of `=` under another would make it
 * a heading. At the end of a heading, a `#` would be read as its closing.
 *
 * @param {string} text - Already escaped by the reference
 * @param {boolean} startOfLine
 * @param {boolean} endsHeading
 * @returns {string}
 */
function escapeMore(text, startOfLine, endsHeading) {
  let out = text.replace(ENTITY, '\\&').replace(AUTOLINK, '\\<')
  if (startOfLine) {
    out = out
      .replace(/^(\s*\d+)\)(?=\s|$)/, '$1\\)')
      .replace(/^(\s*\d+)\.$/, '$1\\.')
      .replace(/^\+$/, '\\+')
      .replace(/^=(?==*[ \t]*$)/, '\\=')
  }
  if (endsHeading) out = out.replace(/(^|[ \t])(#+[ \t]*)$/, '$1\\$2')
  return out
}

/**
 * Whether nothing but breaks follows a block's child, which ends its line:
 * the serializer drops trailing breaks.
 *
 * @param {Node} parent
 * @param {number} index
 * @returns {boolean}
 */
function endsLine(parent, index) {
  for (let i = index + 1; i < parent.childCount; i++) {
    if (parent.child(i).type.name !== 'hard_break') return false
  }
  return true
}

/**
 * The serializer `serializeMarkdown` writes with. Exported for tests, which
 * hold it to what the reference's own `serialize` writes.
 */
export const serializer = new LinearSerializer(
  {
    ...nodes,

    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ')
    },

    text(state, node, parent, index) {
      // Whether the link mark opened as `<url>`, which is not escaped, and
      // whether nothing is written in the block yet. The reference keeps
      // both on the state without declaring them.
      const { inAutolink, atBlockStart } =
        /** @type {{inAutolink?: boolean, atBlockStart?: boolean}} */ (
          /** @type {unknown} */ (state)
        )
      if (inAutolink) {
        nodes.text(state, node, parent, index)
        return
      }
      // The reference escapes block syntax only at the start of a block. Our
      // hard break starts a line too, and `# ` or `- ` there would open a
      // heading or a list on the way back in.
      const afterBreak = index > 0 && parent.child(index - 1).type.name === 'hard_break'
      const startOfLine = Boolean(atBlockStart) || afterBreak
      const endsHeading = parent.type.name === 'heading' && endsLine(parent, index)
      const text = escapeMore(state.esc(node.text || '', startOfLine), startOfLine, endsHeading)
      state.text(text, false)
    },

    table(state, node) {
      const header = node.firstChild
      const rows = []
      node.forEach(row => rows.push(rowOf(row)))
      const rule = []
      header.forEach(cell => rule.push(ruleOf(cell.attrs.align)))
      rows.splice(1, 0, `| ${rule.join(' | ')} |`)
      rows.forEach((row, i) => {
        if (i) state.write('\n')
        state.write(row)
      })
      state.closeBlock(node)
    },

    hard_break(state, node, parent, index) {
      // Trailing breaks have no form and are dropped, as the reference does.
      let followed = false
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          followed = true
          break
        }
      }
      if (!followed) return
      const inRun = index > 0 && parent.child(index - 1).type === node.type
      state.write(inRun ? '\\\n' : '\n')
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strikethrough: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    // The passage between the delimiters, then the id its thread is kept by,
    // in the form the parser reads and the plain view shows.
    comment: {
      open: OPEN_MARKUP,
      close: (_state, mark) => closeMarkup(mark.attrs.id),
      // Kept in place, outermost, so the passage's own marks open and close
      // inside the comment rather than the comment reopening around each.
      // Its spaces stay in it: a comment written in pieces around another
      // often starts one at a space, and moved out, the space would part it.
      mixable: false,
    },
  }
)

/**
 * The cells' own serializer: a cell's text and marks, written as a paragraph's
 * would be, but without the escapes for what starts a line, since a cell
 * starts after a pipe. A dash in a cell stays a dash.
 */
const cells = new LinearSerializer(
  {
    ...serializer.nodes,
    table_cell(state, node) {
      state.renderInline(node, false)
    },
  },
  serializer.marks
)

/**
 * One row of a table, as a line.
 *
 * @param {Node} row
 * @returns {string}
 */
function rowOf(row) {
  const out = []
  row.forEach(cell => {
    // Serialized as the only child of a row, which is what a cell may be.
    const text = cells.serialize(row.type.create(null, cell))
    out.push(text.replace(/\n/g, ' ').replace(/\|/g, '\\|'))
  })
  return `| ${out.join(' | ')} |`
}

/**
 * A column's cell in the line under the header.
 *
 * @param {string|null} align
 * @returns {string}
 */
function ruleOf(align) {
  if (align === 'left') return ':---'
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  return '---'
}

/**
 * Read markdown into a document. Never throws on content: what the schema
 * cannot hold is read as the text it was written as.
 *
 * @param {string|null|undefined} markdown
 * @returns {Node} A document in the editor's schema
 */
export function parseMarkdown(markdown) {
  return parser.parse(markdown || '')
}

/**
 * Write a document as markdown.
 *
 * @param {Node} doc
 * @returns {string}
 */
export function serializeMarkdown(doc) {
  // Tight: items on consecutive lines. The editor has no loose list to keep.
  const written = serializer.serialize(doc, { tightLists: true })
  // Overlapping comments nest in the order their marks are on the text,
  // which is the order they were made in; written again as the tools write
  // them, so the same comments are always the same markdown.
  return settleComments(written)
}

/**
 * Markdown in the file format's own form: what the editor would serialize
 * from it. The same words, with the serializer's choices of bullet, escape,
 * and line ending, so that text written from outside and text the editor
 * wrote never differ in surface form — a recorded edit still matches after
 * the document has been opened, and a document opened and closed untouched
 * is byte-identical.
 *
 * @param {string|null|undefined} markdown
 * @returns {string}
 */
export function settleMarkdown(markdown) {
  return serializeMarkdown(parseMarkdown(markdown))
}

/**
 * Markdown after markdown: a blank line between, so the new text starts a
 * block of its own rather than running on from the last one.
 *
 * @param {string|null|undefined} content
 * @param {string} text
 * @returns {string}
 */
export function appendBlocks(content, text) {
  const before = (content || '').replace(/\s+$/, '')
  const after = text.replace(/^\n+/, '')
  return before ? `${before}\n\n${after}` : after
}
