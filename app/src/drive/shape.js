/**
 * @module drive/shape
 * @description The tables of a Google Doc made the shape of a document's,
 * before a word of them is written: the writing half's first pass.
 *
 * The Doc's blocks and the document's are laid against each other as the
 * writer lays them (`drive/write`). A table the same on both sides is left
 * as it is. Where a stretch of blocks changed, its tables are paired in
 * order, each with the one most like it, by the cells they share: a table
 * of the Doc's left over is deleted whole, and one of the document's left
 * over is put in, empty, where it stands among the blocks around it. A
 * table paired with one of another shape has its columns, then its rows,
 * paired the same way: those of the Doc's left over are taken out, and the
 * document's put in, empty, beside the ones they stand beside. The words
 * then go in as any words do, into tables now the document's shape, cell
 * by cell.
 *
 * Docs puts a table in inside a paragraph, a newline of its own before it,
 * and what followed in the paragraph after it. Put in at the end of the
 * paragraph before it, then, the newline that followed is left as an empty
 * paragraph, and taken out where Docs allows; put in at the start of the
 * paragraph after it, as one that has no paragraph before it is, the empty
 * paragraph before it stays, styled as plain text.
 *
 * The requests come last first, as the writer's do, so each one's indices
 * are still the Doc's as read; a table's own from its last column and row.
 * What cannot be done is said rather than half done: a table with merged
 * cells changes shape here never; a row, column or table deleted that holds
 * what the document cannot show, as a picture, is not deleted; and a change
 * in a cell that holds a table of its own is not sent.
 */

import { diffSequences, pairUp, sharedCount } from '@/utils/diff.js'

/**
 * @typedef {import('prosemirror-model').Node} Node
 * @typedef {import('./docsTypes.js').DocumentTab} DocumentTab
 * @typedef {import('./docsTypes.js').StructuralElement} StructuralElement
 * @typedef {import('./convert.js').ReadDoc} ReadDoc
 * @typedef {import('./convert.js').Span} Span
 * @typedef {import('./write.js').Unsent} Unsent
 */

/**
 * A top-level paragraph of the Doc's body.
 *
 * @typedef {Object} BodyParagraph
 * @property {number} start
 * @property {number} end - Its newline's index
 * @property {string} named - Its named style
 * @property {boolean} bullet
 * @property {boolean} last - Its newline is the body's last
 * @property {boolean} beforeBlock - A table or a section break follows it
 */

/**
 * A block laid out for the pairing.
 *
 * @typedef {Object} Laid
 * @property {Node} node
 * @property {number} pos - Where it is in its document
 * @property {string} key
 * @property {StructuralElement} [element] - The Doc's table, for one of its
 */

/**
 * A change, and where in the Doc it is made: the requests go last first.
 *
 * @typedef {Object} Change
 * @property {number} at
 * @property {number} order - Among those at one place, the later first
 * @property {object[]} requests
 * @property {{index: number, like: BodyParagraph}} [left] - The paragraph a
 *   table put in leaves after it, its newline, and the paragraph it was
 */

/** What a cell may hold, beside its words, and lose with no harm done. */
const SPACING = new Set(['space', 'paragraph', 'break'])

/** A footnote's note, as the converter writes it. */
const NOTE = /^\[\^([^\]\s]+)\]:( |$)/

/**
 * The requests that make a Doc's tables the shape of a document's.
 *
 * @param {DocumentTab} tab - The tab read
 * @param {ReadDoc} read - As `readDoc` read it, with its spans
 * @param {Node} target - The document, settled, its comments taken off
 * @param {string} tabId
 * @returns {{requests: object[], unsent: Unsent[]}}
 */
export function shapeTables(tab, read, target, tabId) {
  return new Shaper(tab, read, tabId).shape(target)
}

/**
 * The shaping, for one tab.
 */
class Shaper {
  /**
   * @param {DocumentTab} tab
   * @param {ReadDoc} read
   * @param {string} tabId
   */
  constructor(tab, read, tabId) {
    this.read = read
    this.spans = read.spans ?? []
    this.tabId = tabId
    const content = tab.body?.content ?? []
    /** @type {StructuralElement[]} */
    this.tables = content.filter(element => element.table)
    /** @type {BodyParagraph[]} */
    this.paragraphs = []
    content.forEach((element, i) => {
      if (!element.paragraph) return
      const start = element.startIndex ?? 0
      const next = content[i + 1]
      this.paragraphs.push({
        start,
        end: (element.endIndex ?? start + 1) - 1,
        named: element.paragraph.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT',
        bullet: !!element.paragraph.bullet,
        last: i === content.length - 1,
        beforeBlock: !!next && !next.paragraph,
      })
    })
    /** @type {Set<Unsent>} */
    this.unsent = new Set()
    /** @type {Change[]} */
    this.changes = []
  }

  /**
   * @param {Node} target
   * @returns {{requests: object[], unsent: Unsent[]}}
   */
  shape(target) {
    const theirs = this.#laid(this.read.doc, true)
    const ours = this.#laid(target, false)
    const steps =
      diffSequences(
        theirs.map(block => block.key),
        ours.map(block => block.key)
      ) ?? []
    for (const stretch of this.#stretchesOf(steps)) this.#stretch(stretch, theirs, ours)

    // Of tables put in after one paragraph, the first put in, the last in
    // the document, takes out what the paragraph left; each other one's is
    // then before a table, as Docs needs one to be.
    /** @type {Map<number, Change>} */
    const firsts = new Map()
    for (const change of this.changes) {
      if (!change.left) continue
      const first = firsts.get(change.at)
      if (!first || change.order > first.order) firsts.set(change.at, change)
    }
    for (const change of this.changes) {
      const { left } = change
      if (!left) continue
      change.requests.push(
        ...(firsts.get(change.at) === change && !left.like.last && !left.like.beforeBlock
          ? [{ deleteContentRange: { range: this.#range(left.index, left.index + 1) } }]
          : this.#plain(left.index, left.like))
      )
    }
    if (this.unsent.size > 0) return { requests: [], unsent: [...this.unsent] }
    this.changes.sort((x, y) => y.at - x.at || y.order - x.order)
    return { requests: this.changes.flatMap(change => change.requests), unsent: [] }
  }

  /**
   * The stretches the comparison changed, each the Doc's blocks and the
   * document's in it, and the last block of the Doc's before it.
   *
   * @param {import('@/utils/diff.js').Step[]} steps
   * @returns {Array<{a: number[], b: number[], before: number}>}
   */
  #stretchesOf(steps) {
    /** @type {Array<{a: number[], b: number[], before: number}>} */
    const out = []
    /** @type {{a: number[], b: number[], before: number}|null} */
    let open = null
    let lastA = -1
    for (const step of steps) {
      if (step.op === 'equal') {
        open = null
        lastA = step.a
        continue
      }
      if (!open) {
        open = { a: [], b: [], before: lastA }
        out.push(open)
      }
      if (step.op === 'delete') {
        open.a.push(step.a)
        lastA = step.a
      } else open.b.push(step.b)
    }
    return out
  }

  /**
   * A document's blocks at its top, those of its notes aside: a table in a
   * list or a quote is one block with it, which the writer cannot send.
   *
   * @param {Node} doc
   * @param {boolean} read - Whether it is the Doc as read
   * @returns {Laid[]}
   */
  #laid(doc, read) {
    /** @type {Laid[]} */
    const out = []
    let table = 0
    doc.forEach((node, pos) => {
      // A picture by where it is: the Doc's are read with markers for theirs.
      const key = JSON.stringify(node.toJSON(), (name, value) =>
        name === 'src' ? undefined : value
      )
      /** @type {Laid} */
      const block = { node, pos, key }
      if (read && node.type.name === 'table') block.element = this.tables[table++]
      out.push(block)
    })
    // The notes at the end.
    let cut = out.length
    if (read) {
      while (cut > 0 && this.#segmentOf(out[cut - 1])) cut--
    } else {
      while (
        cut > 0 &&
        out[cut - 1].node.type.name === 'paragraph' &&
        NOTE.test(out[cut - 1].node.textContent)
      ) {
        cut--
      }
    }
    return out.slice(0, cut)
  }

  /**
   * The footnote a block of the Doc is in, if it is in one.
   *
   * @param {Laid} block
   * @returns {string}
   */
  #segmentOf(block) {
    return this.#spansIn(block).find(span => span.segment)?.segment ?? ''
  }

  /**
   * The spans of a block of the Doc.
   *
   * @param {Laid} block
   * @returns {Span[]}
   */
  #spansIn(block) {
    const from = block.pos
    const to = block.pos + block.node.nodeSize
    return this.spans.filter(span => span.pos >= from && span.pos < to)
  }

  /**
   * One stretch: its tables paired, each pair shaped alike, those left
   * deleted or put in.
   *
   * @param {{a: number[], b: number[], before: number}} stretch
   * @param {Laid[]} theirs
   * @param {Laid[]} ours
   */
  #stretch(stretch, theirs, ours) {
    const isTable = (/** @type {Laid} */ block) => block.node.type.name === 'table'
    const ta = stretch.a.filter(i => isTable(theirs[i]))
    const tb = stretch.b.filter(j => isTable(ours[j]))
    if (ta.length === 0 && tb.length === 0) return
    const pairs = pairUp(ta.length, tb.length, (i, j) =>
      tableLikeness(theirs[ta[i]].node, ours[tb[j]].node)
    ).map(([i, j]) => [ta[i], tb[j]])

    for (const [i, j] of pairs) this.#reshape(theirs[i], ours[j].node)
    const paired = new Set(pairs.map(([i]) => i))
    for (const i of ta) if (!paired.has(i)) this.#delete(theirs[i])

    const pairedOurs = new Set(pairs.map(([, j]) => j))
    for (const j of tb) {
      if (pairedOurs.has(j)) continue
      // Between the pairs of tables either side of it, where the Doc's blocks
      // there part best into those whose words are the document's before it
      // and those whose words are after: a paragraph joined to the next one
      // goes before it whole, and one parted goes either side.
      const before = pairs.filter(([, pj]) => pj < j).at(-1)
      const after = pairs.find(([, pj]) => pj > j)
      const fromA = before ? before[0] : stretch.before
      const toA = after ? after[0] : Infinity
      const toB = after ? after[1] : Infinity
      const fromB = before ? before[1] : -1
      const room = stretch.a.filter(a => a > fromA && a < toA && !isTable(theirs[a]))
      /** @param {(b: number) => boolean} wanted */
      const wordsWhere = wanted =>
        stretch.b
          .filter(b => b > fromB && b < toB && !isTable(ours[b]) && wanted(b))
          .flatMap(b => wordsOf(ours[b].node))
      const [earlier, later] = [wordsWhere(b => b < j), wordsWhere(b => b > j)]
      let best = 0
      let cut = 0
      let total = 0
      room.forEach((a, k) => {
        const words = wordsOf(theirs[a].node)
        total += sharedCount(words, earlier) - sharedCount(words, later)
        if (total > best) [best, cut] = [total, k + 1]
      })
      const x = cut > 0 ? room[cut - 1] : fromA
      this.#insert(ours[j].node, j, x >= 0 ? theirs[x] : null)
    }
  }

  /**
   * The Doc's table made the document's shape: columns and rows taken out,
   * then put in.
   *
   * @param {Laid} block - The Doc's
   * @param {Node} wanted - The document's
   */
  #reshape(block, wanted) {
    const element = /** @type {StructuralElement} */ (block.element)
    const have = gridOf(block.node)
    const want = gridOf(wanted)
    const width = have[0]?.length ?? 0
    const columns = pairUp(width, want[0]?.length ?? 0, (i, j) =>
      sharedCount(
        have.map(row => row[i]),
        want.map(row => row[j])
      )
    )
    const rows = pairUp(have.length, want.length, (r, s) =>
      columns.reduce((total, [i, j]) => total + (have[r][i] === want[s][j] ? 1 : 0), 0)
    )
    const apiRows = element.table?.tableRows ?? []

    // A cell changed that holds a table of its own.
    for (const [r, s] of rows) {
      for (const [i, j] of columns) {
        if (have[r][i] === want[s][j]) continue
        const cell = apiRows[r]?.tableCells?.[i]
        if (!cell) this.unsent.add('merged')
        else if (cell.content?.some(each => each.table)) this.unsent.add('table')
      }
    }

    const keptColumns = new Set(columns.map(([i]) => i))
    const keptRows = new Set(rows.map(([r]) => r))
    const same =
      columns.length === width &&
      columns.length === (want[0]?.length ?? 0) &&
      rows.length === have.length &&
      rows.length === want.length
    if (same) return

    const merged = apiRows.some(
      row =>
        (row.tableCells?.length ?? 0) !== width ||
        (row.tableCells ?? []).some(
          cell =>
            (cell.tableCellStyle?.rowSpan ?? 1) > 1 || (cell.tableCellStyle?.columnSpan ?? 1) > 1
        )
    )
    if (merged) {
      this.unsent.add('merged')
      return
    }

    /** @type {object[]} */
    const requests = []
    const start = element.startIndex ?? 0
    /** @param {number} rowIndex @param {number} columnIndex */
    const cellAt = (rowIndex, columnIndex) => ({
      tableStartLocation: this.#location(start),
      rowIndex,
      columnIndex,
    })
    for (let i = width - 1; i >= 0; i--) {
      if (keptColumns.has(i)) continue
      for (const row of apiRows) this.#holds(row.tableCells?.[i])
      requests.push({ deleteTableColumn: { tableCellLocation: cellAt(0, i) } })
    }
    for (let r = have.length - 1; r >= 0; r--) {
      if (keptRows.has(r)) continue
      for (const cell of apiRows[r]?.tableCells ?? []) this.#holds(cell)
      requests.push({ deleteTableRow: { tableCellLocation: cellAt(r, 0) } })
    }
    const newRows = new Set(want.map((_, s) => s).filter(s => !rows.some(([, rs]) => rs === s)))
    for (let s = 0; s < want.length; s++) {
      if (!newRows.has(s)) continue
      requests.push({
        insertTableRow:
          s === 0
            ? { tableCellLocation: cellAt(0, 0), insertBelow: false }
            : { tableCellLocation: cellAt(s - 1, 0), insertBelow: true },
      })
    }
    const wantWidth = want[0]?.length ?? 0
    const newColumns = new Set(
      Array.from({ length: wantWidth }, (_, j) => j).filter(
        j => !columns.some(([, cj]) => cj === j)
      )
    )
    for (let j = 0; j < wantWidth; j++) {
      if (!newColumns.has(j)) continue
      requests.push({
        insertTableColumn:
          j === 0
            ? { tableCellLocation: cellAt(0, 0), insertRight: false }
            : { tableCellLocation: cellAt(0, j - 1), insertRight: true },
      })
    }
    this.changes.push({ at: start, order: 0, requests })
  }

  /**
   * Whether what a cell holds may go with it: words, and the spacing the
   * document drops. A picture or anything else the document cannot show
   * stays, and so the cell does.
   *
   * @param {import('./docsTypes.js').TableCell|undefined} cell
   */
  #holds(cell) {
    if (!cell) return
    const from = cell.startIndex ?? 0
    const to = cell.endIndex ?? from
    for (const span of this.spans) {
      if (span.kind !== 'held' || span.segment || span.index < from || span.index >= to) continue
      if (span.held === 'suggestion') this.unsent.add('suggestion')
      else if (!SPACING.has(span.held ?? '')) this.unsent.add('held')
    }
  }

  /**
   * A table of the Doc's the document no longer has, deleted whole.
   *
   * @param {Laid} block
   */
  #delete(block) {
    const element = /** @type {StructuralElement} */ (block.element)
    const start = element.startIndex ?? 0
    const end = element.endIndex ?? start
    for (const row of element.table?.tableRows ?? []) {
      for (const cell of row.tableCells ?? []) this.#holds(cell)
    }
    this.changes.push({
      at: start,
      order: 0,
      requests: [{ deleteContentRange: { range: this.#range(start, end) } }],
    })
  }

  /**
   * A table of the document's the Doc has none of, put in empty after a
   * block of the Doc's: at the end of its paragraph, or at the start of the
   * paragraph after it.
   *
   * @param {Node} table
   * @param {number} order - Its place among the document's blocks
   * @param {Laid|null} after - The Doc's block it goes after; none at the start
   */
  #insert(table, order, after) {
    const rows = table.childCount
    const columns = Math.max(...gridOf(table).map(row => row.length))
    const size = 2 + rows * (1 + 2 * columns)
    const insertTable = (/** @type {number} */ index) => ({
      insertTable: { rows, columns, location: this.#location(index) },
    })

    const ending = after && after.node.type.name !== 'table' ? this.#endOf(after) : undefined
    if (ending) {
      // What followed the end, its newline, is left after the table.
      this.changes.push({
        at: ending.end,
        order,
        requests: [insertTable(ending.end)],
        left: { index: ending.end + 1 + size, like: ending },
      })
      return
    }
    const from = after ? this.#lastIndexOf(after) + 1 : 0
    const next = this.paragraphs.find(paragraph => paragraph.start >= from)
    if (!next) {
      this.unsent.add('table')
      return
    }
    // A newline of its own before it, an empty paragraph styled as the one
    // it was put in.
    this.changes.push({
      at: next.start,
      order,
      requests: [insertTable(next.start), ...this.#plain(next.start, next)],
    })
  }

  /**
   * The Doc's paragraph a block of words ends with, if its end is a newline.
   *
   * @param {Laid} block
   * @returns {BodyParagraph|undefined}
   */
  #endOf(block) {
    const end = this.#spansIn(block)
      .filter(span => span.kind === 'end' || span.kind === 'rule')
      .at(-1)
    if (!end) return undefined
    const newline = end.kind === 'rule' ? end.index + end.size - 1 : end.index
    return this.paragraphs.find(paragraph => paragraph.end === newline)
  }

  /**
   * The last index of the Doc's a block takes.
   *
   * @param {Laid} block
   * @returns {number}
   */
  #lastIndexOf(block) {
    if (block.element) return (block.element.endIndex ?? 1) - 1
    let last = -1
    for (const span of this.#spansIn(block)) {
      if (!span.segment) last = Math.max(last, span.index + Math.max(span.size, 1) - 1)
    }
    return last
  }

  /**
   * An empty paragraph left beside a table put in, made plain text: no
   * heading, no bullet.
   *
   * @param {number} index - Its newline's
   * @param {BodyParagraph} like - The paragraph whose style it took
   * @returns {object[]}
   */
  #plain(index, like) {
    const range = this.#range(index, index + 1)
    /** @type {object[]} */
    const out = []
    if (like.named !== 'NORMAL_TEXT') {
      out.push({
        updateParagraphStyle: {
          range,
          paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          fields: 'namedStyleType',
        },
      })
    }
    if (like.bullet) out.push({ deleteParagraphBullets: { range } })
    return out
  }

  /**
   * @param {number} start
   * @param {number} end
   */
  #range(start, end) {
    return { startIndex: start, endIndex: end, ...(this.tabId && { tabId: this.tabId }) }
  }

  /**
   * @param {number} index
   */
  #location(index) {
    return { index, ...(this.tabId && { tabId: this.tabId }) }
  }
}

/**
 * A table's cells' words, row by row.
 *
 * @param {Node} table
 * @returns {string[][]}
 */
function gridOf(table) {
  /** @type {string[][]} */
  const out = []
  table.forEach(row => {
    /** @type {string[]} */
    const cells = []
    row.forEach(cell => cells.push(cell.textContent))
    out.push(cells)
  })
  return out
}

/**
 * A block's words.
 *
 * @param {Node} node
 * @returns {string[]}
 */
const wordsOf = node => node.textContent.split(/\s+/).filter(Boolean)

/**
 * How alike two tables are: the cells' words they share.
 *
 * @param {Node} a
 * @param {Node} b
 * @returns {number}
 */
function tableLikeness(a, b) {
  return sharedCount(gridOf(a).flat(), gridOf(b).flat())
}
