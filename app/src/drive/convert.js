/**
 * @module drive/convert
 * @description A Google Doc read into a document, from the structure the
 * Docs API gives rather than Google's markdown export, with where each part
 * of the document is in the Doc.
 *
 * The export gets a Doc wrong where its structure is plain (part 1 of
 * `.llm/google_docs_design.md`): a page break joins two paragraphs, a word
 * in Courier New loses its font, an open suggestion's old words and new run
 * together. Read here, a page break parts the paragraphs, a monospaced run is
 * code, and a Doc with suggested edits comes in as it was before them: a
 * suggested insertion left out, a suggested deletion kept.
 *
 * A picture comes in as one, with a marker where it was, for the import to
 * fetch it from the address the Docs API gives and make it the document's
 * own (`files/pictures.js`). What the editor has no node for is **held**:
 * left out of the document, and listed with its index so that a sync never
 * deletes it. A drawing, a picture in a table's cell or in code, a page
 * break, a table of contents, the empty paragraphs a Doc is spaced with, and
 * the whitespace markdown would drop at a line's ends are held. A smart chip
 * comes in as its words: a person's name linked to their address, a date as
 * it shows, a rich link as a link. A footnote's number comes in as `[^1]`,
 * its note at the end of the document as `[^1]: …`, as markdown writes one. A table's cells hold one line here, so a cell's
 * paragraphs are joined by spaces. A Title and a Subtitle are Heading 1 and
 * 2; a paragraph indented at its start and its first line alike, which is
 * what a quote pasted into Docs becomes, is a quote; a paragraph holding
 * only a horizontal line, or only `* * *`, is a rule.
 *
 * Where a document is in the Doc is a list of spans, in the document's order.
 * A span of text is the same characters at both ends, a hard break being a
 * line break in the Doc. A chip's words are its one index, and a picture is
 * the Doc's. A block's end is its newline. A held part takes no room in the document. Positions and
 * indices both count UTF-16 code units, so a span of text is as long at each
 * end. The document is the one its own markdown reads back as, so the spans
 * hold for the document an import writes; one that would not come back the
 * same (which the tests keep from happening) has none.
 */

import { Mark } from 'prosemirror-model'
import { schema } from '@/editor/schema.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { markerFor } from '@/files/pictures.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('prosemirror-model').NodeType} NodeType
 * @typedef {import('./docsTypes.js').Document} Document
 * @typedef {import('./docsTypes.js').DocumentTab} DocumentTab
 * @typedef {import('./docsTypes.js').Tab} Tab
 * @typedef {import('./docsTypes.js').StructuralElement} StructuralElement
 * @typedef {import('./docsTypes.js').Paragraph} Paragraph
 * @typedef {import('./docsTypes.js').ParagraphElement} ParagraphElement
 * @typedef {import('./docsTypes.js').TextStyle} TextStyle
 * @typedef {import('./docsTypes.js').Suggested} Suggested
 */

/**
 * Where a stretch of the document is in the Doc.
 *
 * @typedef {Object} Span
 * @property {'text'|'chip'|'picture'|'end'|'rule'|'held'} kind - Text is the
 *   same at both ends; a chip is words for one index; a picture is one, for
 *   the Doc's; an end is a block's newline; a rule is a horizontal rule for
 *   its paragraph; held is in the Doc only
 * @property {number} pos - Where it starts in the document
 * @property {number} length - Positions it takes there: none for an end or
 *   for what is held
 * @property {number} index - Where it starts in the Doc
 * @property {number} size - Indices it takes there
 * @property {string} [segment] - The footnote it is in, by id; the body
 *   otherwise
 * @property {string} [held] - What is held: `image`, `pageBreak`, `space`,
 *   `suggestion`, `paragraph`, …
 * @property {string} [object] - A picture's inline object, by id
 */

/**
 * A picture of the Doc's that came into the document.
 *
 * @typedef {Object} DocPicture
 * @property {string} object - Its inline object's id, which a sync knows it by
 * @property {string} marker - The source its image node has, until it is the
 *   document's own
 * @property {string} uri - Where the Docs API says it can be fetched from:
 *   for half an hour after the read, by anyone with the address
 * @property {string} alt

/**
 * A Doc's tab read into a document.
 *
 * @typedef {Object} ReadDoc
 * @property {Node} doc - In the editor's schema
 * @property {string} markdown - The document as the editor writes it
 * @property {Span[]|null} spans - Where the document is in the Doc; null if
 *   it would not come back the same from its markdown
 * @property {string} revisionId - The Doc's revision as read
 * @property {string} tabId - The tab read; empty for a Doc read without tabs
 * @property {DocPicture[]} pictures - Its pictures that came in, in order
 * @property {number} images - Its pictures that did not: a drawing, one placed
 *   beside a paragraph, one in a table or in code, one left out when asked
 * @property {number} suggestions - Suggested edits still open in it
 */

/**
 * A piece of a paragraph as read, before it is written into the document.
 *
 * @typedef {Object} Piece
 * @property {'text'|'break'|'chip'|'picture'|'held'|'fixed'} kind - Fixed
 *   text is the converter's own, as a footnote's `[^1]: `, and nowhere in
 *   the Doc
 * @property {string} [text]
 * @property {readonly Mark[]} [marks]
 * @property {number} index
 * @property {number} size
 * @property {string} [held]
 * @property {string} [object] - A picture's inline object
 * @property {string} [uri] - Where a picture can be fetched from
 * @property {string} [alt] - A picture's alt text
 */

/**
 * A paragraph as read.
 *
 * @typedef {Object} Line
 * @property {Piece[]} pieces
 * @property {number} start - Its first index
 * @property {number} end - Its newline's index
 * @property {boolean} runsOn - Its newline is a suggested insertion, so it
 *   runs on into the next paragraph
 * @property {string} named - Its named style
 * @property {Paragraph} paragraph
 */

/** A span whose `pos` is from its block's place, before the block has one. */
/** @typedef {Span} LocalSpan */

const { nodes, marks } = schema

/** The named styles read as headings, and at what level. */
const HEADINGS = /** @type {Record<string, number>} */ ({
  TITLE: 1,
  SUBTITLE: 2,
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6,
})

/** A list level's glyphs that count. Any other is a bullet. */
const ORDERED = new Set(['DECIMAL', 'ZERO_DECIMAL', 'ALPHA', 'UPPER_ALPHA', 'ROMAN', 'UPPER_ROMAN'])

/** A font every character of which is as wide as the next. */
export const MONOSPACED =
  /mono|courier|consol|menlo|monaco|lucida console|andale|inconsolata|cousine|source code|fira code|jetbrains/i

/** A paragraph's words that read as a scene break, and so as a rule. */
const SCENE_BREAK = /^(\* \* \*|\*\*\*)$/

/**
 * Every tab in a Doc, a tab's children after it. A Doc read without its tabs
 * is one tab, with no id.
 *
 * @param {Document} document
 * @returns {Tab[]}
 */
export function tabsOf(document) {
  if (!document.tabs) {
    return document.body ? [{ tabProperties: { tabId: '' }, documentTab: document }] : []
  }
  /** @type {Tab[]} */
  const out = []
  const walk = (/** @type {Tab[]} */ tabs) =>
    tabs.forEach(tab => {
      out.push(tab)
      walk(tab.childTabs ?? [])
    })
  walk(document.tabs)
  return out
}

/**
 * Read a tab of a Doc into a document.
 *
 * @param {Document} document - As `documents.get` returns it, with
 *   `suggestionsViewMode=SUGGESTIONS_INLINE`
 * @param {Object} [options]
 * @param {string} [options.tabId] - The tab; the first otherwise
 * @param {Set<string>} [options.leaveOut] - Pictures to hold, by their inline
 *   objects' ids: those the import could not fetch
 * @returns {ReadDoc}
 * @throws {Error} When the Doc has no such tab
 */
export function readDoc(document, { tabId, leaveOut } = {}) {
  const tabs = tabsOf(document)
  const tab = tabId === undefined ? tabs[0] : tabs.find(each => each.tabProperties?.tabId === tabId)
  if (!tab?.documentTab) throw new Error('The Doc has no such tab')
  const reader = new Reader(tab.documentTab, leaveOut)
  const built = reader.read()
  const markdown = serializeMarkdown(built)
  const doc = parseMarkdown(markdown)
  return {
    doc,
    markdown,
    spans: skeletonOf(doc) === skeletonOf(built) ? reader.spansIn(built) : null,
    revisionId: document.revisionId ?? '',
    tabId: tab.tabProperties?.tabId ?? '',
    pictures: reader.pictures,
    images: reader.images,
    suggestions: reader.suggestions.size,
  }
}

/**
 * Each block's place, kind and text: what has to match for two documents'
 * positions to be the same, whatever their marks.
 *
 * @param {Node} doc
 * @returns {string}
 */
function skeletonOf(doc) {
  /** @type {string[]} */
  const parts = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      parts.push(`${pos} ${node.type.name} ${node.textBetween(0, node.content.size, '', '\v')}`)
      return false
    }
    if (node.isLeaf) parts.push(`${pos} ${node.type.name}`)
    return true
  })
  return parts.join('\n')
}

/**
 * The newline's half of an indent: whether the paragraph is indented at its
 * start, and its first line as far.
 *
 * @param {import('./docsTypes.js').ParagraphStyle} style
 * @returns {boolean}
 */
function indentedAsQuote(style) {
  const start = style.indentStart?.magnitude ?? 0
  return start > 0 && (style.indentFirstLine?.magnitude ?? 0) === start
}

/**
 * Whether a piece shows anything: text that is not all whitespace, or a chip.
 *
 * @param {Piece} piece
 * @returns {boolean}
 */
const shows = piece =>
  (piece.kind === 'text' && /\S/.test(piece.text ?? '')) ||
  piece.kind === 'chip' ||
  piece.kind === 'picture' ||
  piece.kind === 'fixed'

/**
 * A piece held as it stands.
 *
 * @param {number} index
 * @param {number} size
 * @param {string} held
 * @returns {Piece}
 */
const heldPiece = (index, size, held) => ({ kind: 'held', index, size, held })

/**
 * The ids of the suggested edits an element is part of.
 *
 * @param {Suggested & {suggestedParagraphStyleChanges?: object, suggestedBulletChanges?: object}} element
 * @returns {string[]}
 */
function suggestionsOn(element) {
  return [
    ...(element.suggestedInsertionIds ?? []),
    ...(element.suggestedDeletionIds ?? []),
    ...Object.keys(element.suggestedTextStyleChanges ?? {}),
    ...Object.keys(element.suggestedParagraphStyleChanges ?? {}),
    ...Object.keys(element.suggestedBulletChanges ?? {}),
  ]
}

/**
 * One tab, read once: the document, then where each part of it is.
 */
class Reader {
  /**
   * @param {DocumentTab} tab
   * @param {Set<string>} [leaveOut] - Pictures to hold
   */
  constructor(tab, leaveOut = new Set()) {
    this.tab = tab
    this.leaveOut = leaveOut
    /** @type {DocPicture[]} The pictures that came in, in order. */
    this.pictures = []
    /** Pictures that did not, and those placed beside paragraphs. */
    this.images = 0
    /** @type {Set<string>} */
    this.suggestions = new Set()
    /** @type {Map<Node, LocalSpan[]>} Each block's spans, by the block itself. */
    this.local = new Map()
    /** @type {LocalSpan[]} Held between blocks, waiting for the next one. */
    this.pending = []
    /** The footnote being read, by id; the body while empty. */
    this.segment = ''
    /** @type {Map<string, string>} Footnotes referred to, by id, with their numbers, in order. */
    this.footnotes = new Map()
    /** @type {Map<string, number[]>} How many items each list has had at each level. */
    this.counted = new Map()
    /** @type {Map<string, TextStyle>} */
    this.named = new Map(
      (tab.namedStyles?.styles ?? []).map(style => [
        style.namedStyleType ?? '',
        style.textStyle ?? {},
      ])
    )
    this.bodyMonospaced = this.#monospacedThroughout()
  }

  /**
   * The document: the body, then the footnotes it refers to.
   *
   * @returns {Node}
   */
  read() {
    const blocks = this.#blocks(this.tab.body?.content ?? [])
    for (const [id, number] of this.footnotes) {
      this.segment = id
      const { pieces, end } = this.#flatten(this.tab.footnotes?.[id]?.content ?? [])
      // Docs starts a note with a space of its own.
      const note = trimLines(pieces)
      const text = note.some(shows) ? `[^${number}]: ` : `[^${number}]:`
      /** @type {Piece} */
      const label = { kind: 'fixed', text, index: -1, size: 0 }
      blocks.push(this.#textblock(nodes.paragraph, null, [label, ...note], end))
      this.segment = ''
    }
    return nodes.doc.create(null, blocks.length > 0 ? blocks : [nodes.paragraph.create()])
  }

  /**
   * Where each part of the document is in the Doc, in order.
   *
   * @param {Node} doc - As `read` made it
   * @returns {Span[]}
   */
  spansIn(doc) {
    /** @type {Span[]} */
    const out = []
    doc.descendants((node, pos) => {
      for (const span of this.local.get(node) ?? []) out.push({ ...span, pos: pos + span.pos })
      return true
    })
    for (const span of this.pending) out.push({ ...span, pos: doc.content.size })
    return joinSpans(out)
  }

  /**
   * Whether the Doc is written in a monospaced font, as a manuscript in
   * Courier is: then no word of it is code for being in one.
   *
   * @returns {boolean}
   */
  #monospacedThroughout() {
    if (MONOSPACED.test(this.named.get('NORMAL_TEXT')?.weightedFontFamily?.fontFamily ?? '')) {
      return true
    }
    let all = 0
    let mono = 0
    /** @param {StructuralElement[]} content */
    const count = content => {
      for (const element of content) {
        for (const part of element.paragraph?.elements ?? []) {
          const run = part.textRun
          if (!run?.content) continue
          const named = element.paragraph?.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT'
          all += run.content.length
          if (MONOSPACED.test(this.#fontOf(run.textStyle ?? {}, named))) mono += run.content.length
        }
        for (const row of element.table?.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) count(cell.content ?? [])
        }
      }
    }
    count(this.tab.body?.content ?? [])
    return mono * 2 > all
  }

  /**
   * @param {TextStyle} style
   * @param {string} named
   * @returns {string}
   */
  #fontOf(style, named) {
    return (
      style.weightedFontFamily?.fontFamily ??
      this.named.get(named)?.weightedFontFamily?.fontFamily ??
      this.named.get('NORMAL_TEXT')?.weightedFontFamily?.fontFamily ??
      ''
    )
  }

  /**
   * The marks a run of text has here: what it sets apart from its named
   * style, so a heading's own bold is not marked.
   *
   * @param {TextStyle} style
   * @param {string} named
   * @returns {readonly Mark[]}
   */
  #marksOf(style, named) {
    const base = this.named.get(named) ?? {}
    const out = []
    if (style.link?.url) out.push(marks.link.create({ href: style.link.url }))
    if (style.bold && !base.bold) out.push(marks.strong.create())
    if (style.italic && !base.italic) out.push(marks.em.create())
    if (style.strikethrough && !base.strikethrough) out.push(marks.strikethrough.create())
    if (!this.bodyMonospaced && MONOSPACED.test(this.#fontOf(style, named))) {
      out.push(marks.code.create())
    }
    return Mark.setFrom(out)
  }

  /**
   * @param {Suggested & object} element
   */
  #noteSuggestions(element) {
    for (const id of suggestionsOn(element)) this.suggestions.add(id)
  }

  /**
   * A paragraph's pieces, its newline, and its style.
   *
   * @param {StructuralElement} element
   * @returns {Line}
   */
  #readParagraph(element) {
    const paragraph = element.paragraph ?? {}
    const named = paragraph.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT'
    this.#noteSuggestions(paragraph)
    this.images += paragraph.positionedObjectIds?.length ?? 0
    /** @type {Piece[]} */
    const pieces = []
    let end = (element.endIndex ?? 1) - 1
    let runsOn = false

    for (const part of paragraph.elements ?? []) {
      const index = part.startIndex ?? 0
      const size = (part.endIndex ?? index + 1) - index
      const run = part.textRun
      if (run) {
        this.#noteSuggestions(run)
        let text = run.content ?? ''
        const ends = text.endsWith('\n')
        if (ends) {
          text = text.slice(0, -1)
          end = index + text.length
        }
        if (run.suggestedInsertionIds?.length) {
          if (text) pieces.push(heldPiece(index, text.length, 'suggestion'))
          runsOn ||= ends
          continue
        }
        const style = this.#marksOf(run.textStyle ?? {}, named)
        let at = index
        text.split('\v').forEach((line, i) => {
          if (i > 0) pieces.push({ kind: 'break', index: at++, size: 1 })
          if (line)
            pieces.push({ kind: 'text', text: line, marks: style, index: at, size: line.length })
          at += line.length
        })
        continue
      }
      pieces.push(this.#readInline(part, index, size, named))
    }
    return { pieces, start: element.startIndex ?? 0, end, runsOn, named, paragraph }
  }

  /**
   * Anything in a paragraph that is not text: a chip as its words, a
   * footnote's number as markdown writes it, the rest held.
   *
   * @param {ParagraphElement} part
   * @param {number} index
   * @param {number} size
   * @param {string} named
   * @returns {Piece}
   */
  #readInline(part, index, size, named) {
    const [kind, inline] = /** @type {[string, import('./docsTypes.js').InlineElement]} */ (
      Object.entries(part).find(([key]) => key !== 'startIndex' && key !== 'endIndex') ?? ['', {}]
    )
    this.#noteSuggestions(inline)
    if (inline.suggestedInsertionIds?.length) return heldPiece(index, size, 'suggestion')
    const style = inline.textStyle ?? {}

    /** @type {string} */
    let words = ''
    let link = ''
    if (kind === 'person') {
      // Linked to their address, as the export links one: who the chip is,
      // and what a sync needs to make it again.
      const { name, email } = inline.personProperties ?? {}
      words = name || email || ''
      link = email ? `mailto:${email}` : ''
    } else if (kind === 'richLink') {
      words = inline.richLinkProperties?.title || inline.richLinkProperties?.uri || ''
      link = inline.richLinkProperties?.uri || ''
    } else if (kind === 'dateElement') {
      words = inline.dateElementProperties?.displayText || ''
    } else if (kind === 'footnoteReference' && inline.footnoteId) {
      const number = inline.footnoteNumber || String(this.footnotes.size + 1)
      if (!this.footnotes.has(inline.footnoteId)) this.footnotes.set(inline.footnoteId, number)
      words = `[^${number}]`
    }
    if (words) {
      const own = this.#marksOf(style, named)
      return {
        kind: 'chip',
        text: words,
        marks: link ? marks.link.create({ href: link }).addToSet(own) : own,
        index,
        size,
      }
    }

    if (kind === 'inlineObjectElement') {
      // A picture comes in, where it can go; a drawing has none to fetch.
      const object = inline.inlineObjectId ?? ''
      const embedded =
        this.tab.inlineObjects?.[object]?.inlineObjectProperties?.embeddedObject ?? {}
      const uri = embedded.imageProperties?.contentUri
      if (uri && !this.leaveOut.has(object)) {
        const alt = embedded.description || embedded.title || ''
        return {
          kind: 'picture',
          object,
          uri,
          alt,
          marks: this.#marksOf(style, named),
          index,
          size,
        }
      }
      this.images++
      return heldPiece(index, size, 'image')
    }
    return heldPiece(index, size, kind || 'unknown')
  }

  /**
   * What a paragraph is here.
   *
   * @param {Line} line
   * @returns {'blank'|'heading'|'list'|'rule'|'quote'|'code'|'paragraph'}
   */
  #kindOf(line) {
    const showing = line.pieces.filter(shows)
    if (showing.length === 0) {
      return line.pieces.some(piece => piece.held === 'horizontalRule') ? 'rule' : 'blank'
    }
    if (HEADINGS[line.named]) return 'heading'
    if (line.paragraph.bullet) return 'list'
    const words = showing.map(piece => piece.text).join('')
    if (showing.every(piece => piece.kind === 'text') && SCENE_BREAK.test(words.trim())) {
      return 'rule'
    }
    if (indentedAsQuote(line.paragraph.paragraphStyle ?? {})) return 'quote'
    const code = showing.every(
      piece => piece.kind === 'text' && piece.marks?.some(mark => mark.type === marks.code)
    )
    return code ? 'code' : 'paragraph'
  }

  /**
   * A body's, a cell's or a footnote's blocks, in order.
   *
   * @param {StructuralElement[]} content
   * @returns {Node[]}
   */
  #blocks(content) {
    /** @type {Array<{line?: Line, element: StructuralElement}>} */
    const items = []
    for (const element of content) {
      if (!element.paragraph) {
        items.push({ element })
        continue
      }
      const line = this.#readParagraph(element)
      const before = items.at(-1)?.line
      // A paragraph a suggested newline split off is read as one with the
      // paragraph before it, the newline held.
      if (before?.runsOn) {
        before.pieces.push(heldPiece(before.end, 1, 'suggestion'), ...line.pieces)
        Object.assign(before, { end: line.end, runsOn: line.runsOn })
        continue
      }
      items.push({ line, element })
    }

    /** @type {Node[]} */
    const out = []
    for (let i = 0; i < items.length; ) {
      const { line, element } = items[i]
      if (!line) {
        if (element.table) out.push(this.#table(element))
        else
          this.#holdBlock(element, Object.keys(element).find(key => !key.endsWith('Index')) ?? '')
        i++
        continue
      }
      const kind = this.#kindOf(line)
      if (kind === 'blank') {
        this.#holdBlock(element, 'paragraph')
        i++
        continue
      }
      if (kind === 'list' || kind === 'quote' || kind === 'code') {
        // A run of them, with the blank paragraphs between them.
        let next = i + 1
        let last = i
        while (next < items.length) {
          const other = items[next].line
          const otherKind = other && this.#kindOf(other)
          if (otherKind === kind) last = next
          else if (otherKind !== 'blank') break
          next++
        }
        const run = items.slice(i, last + 1)
        if (kind === 'list') out.push(...this.#lists(run))
        else if (kind === 'quote') out.push(this.#quote(run))
        else out.push(this.#code(run))
        i = last + 1
        continue
      }
      if (kind === 'rule') {
        const rule = nodes.horizontal_rule.create()
        this.#register(rule, [
          {
            kind: 'rule',
            pos: 0,
            length: 1,
            index: line.start,
            size: line.end + 1 - line.start,
          },
        ])
        out.push(rule)
      } else if (kind === 'heading') {
        out.push(...this.#split(nodes.heading, { level: HEADINGS[line.named] }, line))
      } else {
        out.push(...this.#split(nodes.paragraph, null, line))
      }
      i++
    }
    return out
  }

  /**
   * A whole block held: an empty paragraph, a section break, a table of
   * contents.
   *
   * @param {StructuralElement} element
   * @param {string} held
   */
  #holdBlock(element, held) {
    const index = element.startIndex ?? 0
    this.pending.push({
      kind: 'held',
      pos: 0,
      length: 0,
      index,
      size: (element.endIndex ?? index + 1) - index,
      held,
      ...(this.segment && { segment: this.segment }),
    })
  }

  /**
   * A paragraph or a heading, parted where a page break has words on both
   * sides of it: Docs shows what follows one on a page of its own.
   *
   * @param {NodeType} type
   * @param {Record<string, unknown>|null} attrs
   * @param {Line} line
   * @returns {Node[]}
   */
  #split(type, attrs, line) {
    /** @type {Piece[][]} */
    const parts = [[]]
    line.pieces.forEach((piece, i) => {
      parts.at(-1)?.push(piece)
      const parting = piece.held === 'pageBreak' || piece.held === 'columnBreak'
      if (parting && parts.at(-1)?.some(shows) && line.pieces.slice(i + 1).some(shows)) {
        parts.push([])
      }
    })
    return parts.map((pieces, i) =>
      this.#textblock(type, attrs, pieces, i === parts.length - 1 ? line.end : undefined)
    )
  }

  /**
   * Bulleted and numbered lists from a run of their paragraphs, nested as
   * deep as each paragraph is in its list.
   *
   * @param {Array<{line?: Line, element: StructuralElement}>} run
   * @returns {Node[]}
   */
  #lists(run) {
    /** @type {Array<{line: Line, depth: number, ordered: boolean, number: number}>} */
    const items = []
    /** @type {number[]} The levels open above the item, as Docs numbers them. */
    const open = []
    for (const { line, element } of run) {
      if (!line || this.#kindOf(line) === 'blank') {
        this.#holdBlock(element, 'paragraph')
        continue
      }
      const listId = line.paragraph.bullet?.listId ?? ''
      const level = line.paragraph.bullet?.nestingLevel ?? 0
      while (open.length > 0 && /** @type {number} */ (open.at(-1)) > level) open.pop()
      if (open.length === 0 || /** @type {number} */ (open.at(-1)) < level) open.push(level)
      const glyph = this.tab.lists?.[listId]?.listProperties?.nestingLevels?.[level] ?? {}
      // Docs numbers a list across whatever interrupts it, and a level from
      // its start again after each item above it.
      const counts = this.counted.get(listId) ?? []
      counts[level] = (counts[level] ?? 0) + 1
      counts.length = level + 1
      this.counted.set(listId, counts)
      items.push({
        line,
        depth: open.length - 1,
        ordered: ORDERED.has(glyph.glyphType ?? ''),
        number: (glyph.startNumber ?? 1) + counts[level] - 1,
      })
    }

    /**
     * @param {number} from
     * @param {number} depth
     * @returns {{node: Node, next: number}}
     */
    const build = (from, depth) => {
      const { ordered, number } = items[from]
      /** @type {Node[]} */
      const children = []
      let i = from
      while (i < items.length && items[i].depth === depth && items[i].ordered === ordered) {
        const paragraph = this.#textblock(
          nodes.paragraph,
          null,
          items[i].line.pieces,
          items[i].line.end
        )
        i++
        /** @type {Node[]} */
        const nested = []
        while (i < items.length && items[i].depth > depth) {
          const inner = build(i, depth + 1)
          nested.push(inner.node)
          i = inner.next
        }
        children.push(nodes.list_item.create(null, [paragraph, ...nested]))
      }
      const node = ordered
        ? nodes.ordered_list.create({ order: number }, children)
        : nodes.bullet_list.create(null, children)
      return { node, next: i }
    }

    /** @type {Node[]} */
    const out = []
    for (let i = 0; i < items.length; ) {
      const { node, next } = build(i, items[i].depth)
      out.push(node)
      i = next
    }
    return out
  }

  /**
   * A quote from a run of its paragraphs.
   *
   * @param {Array<{line?: Line, element: StructuralElement}>} run
   * @returns {Node}
   */
  #quote(run) {
    /** @type {Node[]} */
    const paragraphs = []
    for (const { line, element } of run) {
      if (!line || this.#kindOf(line) === 'blank') this.#holdBlock(element, 'paragraph')
      else paragraphs.push(...this.#split(nodes.paragraph, null, line))
    }
    return nodes.blockquote.create(null, paragraphs)
  }

  /**
   * A code block from a run of monospaced paragraphs, a line each, the blank
   * ones between them blank lines.
   *
   * @param {Array<{line?: Line, element: StructuralElement}>} run
   * @returns {Node}
   */
  #code(run) {
    /** @type {Piece[]} */
    const pieces = []
    const lines = /** @type {Line[]} */ (run.map(item => item.line))
    lines.forEach((line, i) => {
      for (const piece of line.pieces) {
        if (piece.kind === 'text') pieces.push({ ...piece, marks: Mark.none })
        else if (piece.kind === 'break')
          pieces.push({ ...piece, kind: 'text', text: '\n', marks: Mark.none })
        else {
          if (piece.kind === 'picture') this.images++
          pieces.push(heldPiece(piece.index, piece.size, piece.held ?? piece.kind))
        }
      }
      if (i < lines.length - 1) {
        pieces.push({ kind: 'text', text: '\n', marks: Mark.none, index: line.end, size: 1 })
      }
    })
    const last = /** @type {Line} */ (lines.at(-1))
    return this.#textblock(nodes.code_block, null, pieces, last.end, { code: true })
  }

  /**
   * A table, its cells each one line.
   *
   * @param {StructuralElement} element
   * @returns {Node}
   */
  #table(element) {
    const rows = element.table?.tableRows ?? []
    const width = Math.max(1, ...rows.map(row => row.tableCells?.length ?? 0))
    const built = rows.map(row => {
      const cells = (row.tableCells ?? []).map(cell => {
        const { pieces, end } = this.#flatten(cell.content ?? [])
        return this.#textblock(nodes.table_cell, null, pieces, end)
      })
      while (cells.length < width) cells.push(nodes.table_cell.create())
      return nodes.table_row.create(null, cells)
    })
    if (built.length === 0) built.push(nodes.table_row.create(null, [nodes.table_cell.create()]))
    return nodes.table.create(null, built)
  }

  /**
   * A cell's or a footnote's paragraphs as one line, a space for each
   * newline between two that show anything. A table inside is read the same
   * way, cell by cell.
   *
   * @param {StructuralElement[]} content
   * @returns {{pieces: Piece[], end: number|undefined}}
   */
  #flatten(content) {
    /** @type {Line[]} */
    const lines = []
    /** @param {StructuralElement[]} blocks */
    const gather = blocks => {
      for (const element of blocks) {
        if (element.paragraph) lines.push(this.#readParagraph(element))
        for (const row of element.table?.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) gather(cell.content ?? [])
        }
      }
    }
    gather(content)

    // The newline after the last paragraph with words in it is the end;
    // with none, the first one is, where words would go.
    const end = (lines.filter(line => line.pieces.some(shows)).at(-1) ?? lines[0])?.end
    /** @type {Piece[]} */
    const pieces = []
    /** @type {number|undefined} */
    let previous
    for (const line of lines) {
      if (!line.pieces.some(shows)) {
        for (const piece of line.pieces) {
          pieces.push(heldPiece(piece.index, piece.size, piece.held ?? 'space'))
        }
        if (line.end !== end) pieces.push(heldPiece(line.end, 1, 'paragraph'))
        continue
      }
      if (previous !== undefined) {
        pieces.push({ kind: 'text', text: ' ', marks: Mark.none, index: previous, size: 1 })
      }
      pieces.push(...line.pieces)
      previous = line.end
    }
    return { pieces, end }
  }

  /**
   * A block of text, from its pieces: whitespace markdown would drop held,
   * and its spans kept for when it has its place.
   *
   * @param {NodeType} type
   * @param {Record<string, unknown>|null} attrs
   * @param {Piece[]} pieces
   * @param {number|undefined} end - Its newline's index, if it has one of its own
   * @param {{code?: boolean}} [options]
   * @returns {Node}
   */
  #textblock(type, attrs, pieces, end, { code = false } = {}) {
    let laid = pieces
    // A cell holds text only, so its pictures are held before its ends are
    // trimmed.
    if (type === nodes.table_cell) {
      laid = laid.map(piece => {
        if (piece.kind !== 'picture') return piece
        this.images++
        return heldPiece(piece.index, piece.size, 'image')
      })
    }
    if (!code) {
      // A heading and a cell are one line: their breaks are spaces.
      if (type === nodes.heading || type === nodes.table_cell) {
        laid = laid.map(piece =>
          piece.kind === 'break' ? { ...piece, kind: 'text', text: ' ', marks: Mark.none } : piece
        )
      }
      laid = codeWithoutEdges(trimLines(laid))
    }

    /** @type {Node[]} */
    const content = []
    /** @type {LocalSpan[]} */
    const spans = []
    const segment = this.segment ? { segment: this.segment } : {}
    let pos = 1
    for (const piece of laid) {
      if (piece.kind === 'picture') {
        const marker = markerFor(this.pictures.length + 1)
        const object = piece.object ?? ''
        this.pictures.push({ object, marker, uri: piece.uri ?? '', alt: piece.alt ?? '' })
        content.push(nodes.image.create({ src: marker, alt: piece.alt || null }, null, piece.marks))
        spans.push({
          kind: 'picture',
          pos,
          length: 1,
          index: piece.index,
          size: piece.size,
          object,
          ...segment,
        })
        pos += 1
        continue
      }
      if (piece.kind === 'held') {
        spans.push({
          kind: 'held',
          pos,
          length: 0,
          index: piece.index,
          size: piece.size,
          held: piece.held,
          ...segment,
        })
        continue
      }
      if (piece.kind === 'break') {
        content.push(nodes.hard_break.create())
        spans.push({ kind: 'text', pos, length: 1, index: piece.index, size: 1, ...segment })
        pos += 1
        continue
      }
      const text = piece.text ?? ''
      if (!text) continue
      content.push(schema.text(text, piece.marks ?? Mark.none))
      if (piece.kind === 'text') {
        spans.push({
          kind: 'text',
          pos,
          length: text.length,
          index: piece.index,
          size: text.length,
          ...segment,
        })
      } else if (piece.kind === 'chip') {
        spans.push({
          kind: 'chip',
          pos,
          length: text.length,
          index: piece.index,
          size: piece.size,
          ...segment,
        })
      }
      pos += text.length
    }
    if (end !== undefined)
      spans.push({ kind: 'end', pos, length: 0, index: end, size: 1, ...segment })

    const node = settleMarks(type.create(attrs, content))
    this.#register(node, spans)
    return node
  }

  /**
   * Keep a block's spans for when it has its place, with whatever was held
   * before it.
   *
   * @param {Node} node
   * @param {LocalSpan[]} spans
   */
  #register(node, spans) {
    this.local.set(node, [...this.pending, ...spans])
    this.pending = []
  }
}

/**
 * Hold what markdown would drop at each line's ends: spaces and tabs, and
 * the breaks before the first line that shows anything and after the last.
 *
 * @param {Piece[]} pieces
 * @returns {Piece[]}
 */
function trimLines(pieces) {
  /** @type {Piece[][]} */
  const lines = [[]]
  /** @type {Piece[]} */
  const breaks = []
  for (const piece of pieces) {
    if (piece.kind === 'break') {
      breaks.push(piece)
      lines.push([])
    } else {
      lines[lines.length - 1].push(piece)
    }
  }
  const trimmed = lines.map(trimEdges)
  const showing = trimmed.map(line => line.some(shows))
  const first = showing.indexOf(true)
  const last = showing.lastIndexOf(true)
  /** @type {Piece[]} */
  const out = []
  trimmed.forEach((line, i) => {
    if (i > 0) {
      const lineBreak = breaks[i - 1]
      out.push(
        first >= 0 && i > first && i <= last ? lineBreak : heldPiece(lineBreak.index, 1, 'break')
      )
    }
    out.push(...line)
  })
  return out
}

/**
 * One line with the spaces and tabs at its ends held.
 *
 * @param {Piece[]} line
 * @returns {Piece[]}
 */
function trimEdges(line) {
  const out = [...line]
  // From the start, until something shows.
  for (let i = 0; i < out.length; i++) {
    const piece = out[i]
    if (piece.kind === 'held') continue
    if (piece.kind !== 'text') break
    const text = piece.text ?? ''
    const lead = /^[ \t]*/.exec(text)?.[0].length ?? 0
    if (lead === 0) break
    const rest = {
      ...piece,
      text: text.slice(lead),
      index: piece.index + lead,
      size: text.length - lead,
    }
    out.splice(i, 1, heldPiece(piece.index, lead, 'space'), ...(rest.text ? [rest] : []))
    if (rest.text) break
  }
  // From the end, likewise.
  for (let i = out.length - 1; i >= 0; i--) {
    const piece = out[i]
    if (piece.kind === 'held') continue
    if (piece.kind !== 'text') break
    const text = piece.text ?? ''
    const trail = /[ \t]*$/.exec(text)?.[0].length ?? 0
    if (trail === 0) break
    const keep = text.length - trail
    const rest = { ...piece, text: text.slice(0, keep), size: keep }
    out.splice(i, 1, ...(rest.text ? [rest] : []), heldPiece(piece.index + keep, trail, 'space'))
    if (rest.text) break
  }
  return out
}

/**
 * Code with no whitespace at its ends: markdown takes a space off each end
 * of code that has one at both.
 *
 * @param {Piece[]} pieces
 * @returns {Piece[]}
 */
function codeWithoutEdges(pieces) {
  return pieces.flatMap(piece => {
    const code = piece.marks?.find(mark => mark.type === marks.code)
    if (piece.kind !== 'text' || !code) return [piece]
    const text = piece.text ?? ''
    const plain = code.removeFromSet(piece.marks ?? Mark.none)
    if (!/\S/.test(text)) return [{ ...piece, marks: plain }]
    const lead = /^\s*/.exec(text)?.[0].length ?? 0
    const keep = text.trimEnd().length
    /** @type {Piece[]} */
    const out = []
    if (lead) out.push({ ...piece, text: text.slice(0, lead), marks: plain, size: lead })
    out.push({
      ...piece,
      text: text.slice(lead, keep),
      index: piece.index + lead,
      size: keep - lead,
    })
    if (keep < text.length) {
      out.push({
        ...piece,
        text: text.slice(keep),
        marks: plain,
        index: piece.index + keep,
        size: text.length - keep,
      })
    }
    return out
  })
}

/** Marks given up, in turn, by a block whose marks markdown cannot write. */
const GIVEN_UP = ['em', 'strong', 'strikethrough', 'code', 'link']

/**
 * A paragraph or a heading whose markdown reads back as its own words. Marks
 * that cross with no space between, bold running into italic, come back as
 * stray asterisks; such a block gives up its marks, a kind at a time, until
 * its words are its own.
 *
 * @param {Node} node
 * @returns {Node}
 */
function settleMarks(node) {
  if (node.type !== nodes.paragraph && node.type !== nodes.heading) return node
  let marked = false
  node.forEach(child => {
    if (child.marks.length > 0) marked = true
  })
  if (!marked || comesBack(node)) return node
  let block = node
  for (const name of GIVEN_UP) {
    block = withoutMark(block, name)
    if (comesBack(block)) return block
  }
  return block
}

/**
 * @param {Node} block
 * @returns {boolean}
 */
function comesBack(block) {
  const back = parseMarkdown(serializeMarkdown(nodes.doc.create(null, [block])))
  return (
    back.childCount === 1 &&
    back.firstChild?.type === block.type &&
    back.firstChild.textBetween(0, back.firstChild.content.size, '', '\v') ===
      block.textBetween(0, block.content.size, '', '\v')
  )
}

/**
 * @param {Node} block
 * @param {string} name
 * @returns {Node}
 */
function withoutMark(block, name) {
  /** @type {Node[]} */
  const content = []
  block.forEach(child =>
    content.push(child.mark(child.marks.filter(mark => mark.type.name !== name)))
  )
  return block.type.create(block.attrs, content)
}

/**
 * Spans of text that follow on at both ends, as one.
 *
 * @param {Span[]} spans
 * @returns {Span[]}
 */
function joinSpans(spans) {
  /** @type {Span[]} */
  const out = []
  for (const span of spans) {
    const before = out.at(-1)
    if (
      before &&
      before.kind === 'text' &&
      span.kind === 'text' &&
      before.segment === span.segment &&
      before.pos + before.length === span.pos &&
      before.index + before.size === span.index
    ) {
      before.length += span.length
      before.size += span.size
    } else {
      out.push({ ...span })
    }
  }
  return out
}
