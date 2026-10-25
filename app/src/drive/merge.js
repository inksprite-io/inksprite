/**
 * @module drive/merge
 * @description A document and its Google Doc merged three ways: each
 * against the base, the Doc as the two last agreed, so that what either
 * side changed since is kept.
 *
 * Block by block first. A block changed on one side takes that side's; one
 * changed alike on both takes it once; blocks both put in at one place go
 * in both, the Doc's first. Where both sides changed a stretch differently,
 * it is merged within: a list or a quote item by item, a table by its
 * columns and rows and then cell by cell, and paragraphs, headings and code
 * word by word, the end of each block a word of its own, so a paragraph
 * parted on one side and a word changed in it on the other take both. Changes with nothing kept between them clash, as two
 * people rewriting one sentence do, and the stretch is given both ways,
 * each with everything else merged into it, for the writer to choose: the
 * block as the document would have it, or as the Doc would.
 *
 * Comments are the document's alone, and the Doc never has their marks. So
 * they are left out of every comparison, and what the document kept keeps
 * them. Words the Doc put in between words of one comment are in it too.
 *
 * Design: `.llm/google_docs_design.md`, part 3, Sync.
 */

import { Fragment } from 'prosemirror-model'
import { schema } from '@/editor/schema.js'
import { diff3, diffSequences, pairUp, sharedCount } from '@/utils/diff.js'

/** @typedef {import('prosemirror-model').Node} Node */
/** @typedef {import('prosemirror-model').Mark} Mark */

/**
 * Where both sides changed the same words: the blocks as they were, and as
 * each side would have them, with every change that does not clash merged
 * into both.
 *
 * @typedef {Object} Clash
 * @property {Node[]} base
 * @property {Node[]} mine - As the document would have them
 * @property {Node[]} theirs - As the Doc would have them
 */

/**
 * @typedef {{blocks: Node[]}|{clash: Clash}} Piece
 */

/**
 * @typedef {Object} Merged
 * @property {Piece[]} pieces - The merged document's blocks, in order, a
 *   clash where both sides changed the same words
 * @property {Clash[]} clashes - Those, in order
 */

/**
 * A stretch merged: as each side would have it, which are the same unless
 * it clashed.
 *
 * @typedef {{mine: Node[], theirs: Node[], clashed: boolean}} Both
 */

/**
 * A stretch merged, with the blocks it was.
 *
 * @typedef {Both & {base: Node[]}} Stretch
 */

/**
 * A run of blocks of words, or another block, for laying a stretch out in
 * its parts.
 *
 * @typedef {{key: string, nodes: Node[]}} Part
 */

/**
 * A piece of a stretch of blocks, for merging word by word: a word, a
 * character, an inline node, or the end of a block, which holds the block
 * for its kind.
 *
 * @typedef {{key: string, node?: Node, end?: Node}} Token
 */

/** Past this many changes on a side, a stretch is not merged word by word. */
const MAX_EDITS = 5000

/** Past this many blocks changed on a side, the blocks are one stretch. */
const MAX_BLOCK_EDITS = 2000

/** A word, or any other character. */
const PIECES = /[\p{L}\p{N}\p{M}_'’]+|[^]/gu

/**
 * The document and the Doc merged.
 *
 * @param {Node} base - The Doc as the two last agreed
 * @param {Node} mine - The document now
 * @param {Node} theirs - The Doc now
 * @returns {Merged}
 */
export function mergeDocs(base, mine, theirs) {
  /** @type {Piece[]} */
  const pieces = []
  /** @type {Clash[]} */
  const clashes = []
  for (const stretch of mergeSequence(childrenOf(base), childrenOf(mine), childrenOf(theirs))) {
    if (stretch.clashed) {
      const clash = { base: stretch.base, mine: stretch.mine, theirs: stretch.theirs }
      pieces.push({ clash })
      clashes.push(clash)
      continue
    }
    const last = pieces.at(-1)
    if (last && 'blocks' in last) last.blocks.push(...stretch.mine)
    else if (stretch.mine.length > 0) pieces.push({ blocks: [...stretch.mine] })
  }
  return { pieces, clashes }
}

/**
 * The merged document, each clash taken as chosen.
 *
 * @param {Merged} merged
 * @param {Array<'mine'|'theirs'>} [choices] - One for each clash, in order
 * @returns {Node}
 */
export function settle(merged, choices = []) {
  /** @type {Node[]} */
  const blocks = []
  let n = 0
  for (const piece of merged.pieces) {
    if ('blocks' in piece) blocks.push(...piece.blocks)
    else blocks.push(...piece.clash[choices[n++] === 'theirs' ? 'theirs' : 'mine'])
  }
  return schema.nodes.doc.create(
    null,
    blocks.length > 0 ? blocks : [schema.nodes.paragraph.create()]
  )
}

/**
 * Whether two documents say the same, their comments aside.
 *
 * @param {Node} a
 * @param {Node} b
 * @returns {boolean}
 */
export const sameDocs = (a, b) => keyOf(a) === keyOf(b)

/**
 * Sibling blocks merged, as stretches.
 *
 * @param {Node[]} base
 * @param {Node[]} mine
 * @param {Node[]} theirs
 * @returns {Stretch[]}
 */
function mergeSequence(base, mine, theirs) {
  const chunks = diff3(base.map(keyOf), mine.map(keyOf), theirs.map(keyOf), {
    maxEdits: MAX_BLOCK_EDITS,
  })
  if (!chunks) return mergeStretch(base, mine, theirs)
  return chunks.flatMap(chunk => {
    const b = base.slice(...chunk.base)
    const m = mine.slice(...chunk.mine)
    if (chunk.stable) return [{ base: b, mine: m, theirs: m, clashed: false }]
    return mergeStretch(b, m, theirs.slice(...chunk.theirs))
  })
}

/**
 * A stretch of blocks one side or both changed.
 *
 * @param {Node[]} base
 * @param {Node[]} mine
 * @param {Node[]} theirs
 * @returns {Stretch[]}
 */
function mergeStretch(base, mine, theirs) {
  if (sameBlocks(theirs, base) || sameBlocks(mine, theirs)) return [agreed(base, mine)]
  // Blocks both put in at one place, between blocks both kept: both, the
  // Doc's first, as if the sync came after them.
  if (base.length === 0) return [agreed(base, [...theirs, ...mine])]
  const apart = mergeApart(base, mine, theirs)
  if (apart) return apart
  // Merged within even when only the Doc changed it, for the comments.
  const within = mergeWithin(base, mine, theirs)
  if (within) return [{ base, ...within }]
  const parts = mergeParts(base, mine, theirs)
  if (parts) return parts
  if (sameBlocks(mine, base)) return [agreed(base, theirs)]
  return [{ base, mine, theirs, clashed: true }]
}

/**
 * A change one side made to a stretch: the base's blocks from `from` to
 * `to` made `blocks`.
 *
 * @typedef {{from: number, to: number, blocks: Node[]}} Hunk
 */

/**
 * A stretch both sides changed, but each in blocks of its own, with no
 * block both kept between: each side's changes made to the base, the Doc's
 * merged into the document's blocks for their comments. Null when two
 * changes reach the same block, or both sides put blocks in at one place.
 *
 * @param {Node[]} base
 * @param {Node[]} mine
 * @param {Node[]} theirs
 * @returns {Stretch[]|null}
 */
function mergeApart(base, mine, theirs) {
  if (sameBlocks(mine, base) || sameBlocks(theirs, base)) return null
  const ours = hunksOf(base, mine)
  const others = hunksOf(base, theirs)
  if (!ours || !others) return null
  const touch = (/** @type {Hunk} */ a, /** @type {Hunk} */ b) =>
    a.from === a.to && b.from === b.to ? a.from === b.from : a.from < b.to && b.from < a.to
  if (ours.some(a => others.some(b => touch(a, b)))) return null
  const hunks = [
    ...ours.map(hunk => ({ hunk, side: 'mine' })),
    ...others.map(hunk => ({ hunk, side: 'theirs' })),
  ].sort((a, b) => a.hunk.from - b.hunk.from || a.hunk.to - b.hunk.to)
  /** @type {Stretch[]} */
  const out = []
  let at = 0
  // The base's blocks as the document has them, comments and all.
  const kept = keptBy(base, mine)
  for (const { hunk, side } of hunks) {
    if (hunk.from > at) out.push(agreed(base.slice(at, hunk.from), kept.slice(at, hunk.from)))
    const was = base.slice(hunk.from, hunk.to)
    out.push(
      ...(side === 'mine'
        ? [agreed(was, hunk.blocks)]
        : mergeStretch(was, kept.slice(hunk.from, hunk.to), hunk.blocks))
    )
    at = hunk.to
  }
  if (at < base.length) out.push(agreed(base.slice(at), kept.slice(at)))
  return out
}

/**
 * A side's changes to a stretch, block by block: where it kept the base's
 * blocks, and what it made of those between.
 *
 * @param {Node[]} base
 * @param {Node[]} side
 * @returns {Hunk[]|null}
 */
function hunksOf(base, side) {
  const steps = diffSequences(base.map(keyOf), side.map(keyOf), { maxEdits: MAX_BLOCK_EDITS })
  if (!steps) return null
  /** @type {Hunk[]} */
  const out = []
  /** Where in the base the next change would start. */
  let a = 0
  /** @type {Hunk|null} */
  let open = null
  for (const step of steps) {
    if (step.op === 'equal') {
      if (open) out.push(open)
      open = null
      a = step.a + 1
      continue
    }
    open ??= { from: a, to: a, blocks: [] }
    if (step.op === 'delete') open.to = a = step.a + 1
    else open.blocks.push(side[step.b])
  }
  if (open) out.push(open)
  return out
}

/**
 * The base's blocks, each as a side has it where it kept it: the same but
 * for comments. The base's own where it did not.
 *
 * @param {Node[]} base
 * @param {Node[]} side
 * @returns {Node[]}
 */
function keptBy(base, side) {
  const out = [...base]
  for (const step of diffSequences(base.map(keyOf), side.map(keyOf)) ?? []) {
    if (step.op === 'equal') out[step.a] = side[step.b]
  }
  return out
}

/**
 * A stretch of blocks of several sorts in its parts: each run of blocks of
 * words, and each list, quote or table, laid against the same on the other
 * sides and merged with it. Null when they lay out as one part.
 *
 * @param {Node[]} base
 * @param {Node[]} mine
 * @param {Node[]} theirs
 * @returns {Stretch[]|null}
 */
function mergeParts(base, mine, theirs) {
  const [b, m, t] = [base, mine, theirs].map(partsOf)
  const chunks = diff3(
    b.map(part => part.key),
    m.map(part => part.key),
    t.map(part => part.key)
  )
  const whole = chunks?.length === 1 && (!chunks[0].stable || b.length === 1)
  if (!chunks || whole) return null
  /** @param {Part[]} parts @param {[number, number]} range */
  const nodes = (parts, range) => parts.slice(...range).flatMap(part => part.nodes)
  return chunks.flatMap(chunk => {
    if (!chunk.stable) {
      return mergeStretch(nodes(b, chunk.base), nodes(m, chunk.mine), nodes(t, chunk.theirs))
    }
    return b
      .slice(...chunk.base)
      .flatMap((part, i) =>
        mergeStretch(part.nodes, m[chunk.mine[0] + i].nodes, t[chunk.theirs[0] + i].nodes)
      )
  })
}

/**
 * Blocks as parts: each run of blocks of words one, and each other block.
 *
 * @param {Node[]} blocks
 * @returns {Part[]}
 */
function partsOf(blocks) {
  /** @type {Part[]} */
  const out = []
  for (const node of blocks) {
    const last = out.at(-1)
    if (node.isTextblock && last?.key === 'words') last.nodes.push(node)
    else if (node.isTextblock) out.push({ key: 'words', nodes: [node] })
    else
      out.push({ key: holdsBlocks(node) ? `holds ${node.type.name}` : keyOf(node), nodes: [node] })
  }
  return out
}

/**
 * A stretch merged inside its blocks: one block of the same sort on each
 * side merged child by child, or blocks of words merged word by word. Null
 * when they are neither.
 *
 * @param {Node[]} base
 * @param {Node[]} mine
 * @param {Node[]} theirs
 * @returns {Both|null}
 */
function mergeWithin(base, mine, theirs) {
  if (base.length === 1 && mine.length === 1 && theirs.length === 1) {
    const [b, m, t] = [base[0], mine[0], theirs[0]]
    if ([b, m, t].every(node => node.type === schema.nodes.table)) return mergeTable(b, m, t)
    if ([b, m, t].every(holdsBlocks)) return mergeHolder(b, m, t)
  }
  if ([...base, ...mine, ...theirs].every(node => node.isTextblock)) {
    return mergeWords(base, mine, theirs)
  }
  return null
}

/**
 * A list, a quote, an item or a table on each side, merged child by child.
 *
 * @param {Node} base
 * @param {Node} mine
 * @param {Node} theirs
 * @returns {Both|null}
 */
function mergeHolder(base, mine, theirs) {
  const markup = pick(base, mine, theirs, markupKey)
  /** @type {Both} */
  const children = { mine: [], theirs: [], clashed: false }
  for (const stretch of mergeSequence(childrenOf(base), childrenOf(mine), childrenOf(theirs))) {
    children.mine.push(...stretch.mine)
    children.theirs.push(...stretch.theirs)
    children.clashed ||= stretch.clashed
  }
  const made = {
    mine: remade(markup.mine, children.mine),
    theirs: remade(markup.theirs, children.theirs),
  }
  if (!made.mine || !made.theirs) return null
  return { mine: [made.mine], theirs: [made.theirs], clashed: markup.clashed || children.clashed }
}

/**
 * A row or a column of a merged table, by where each side has it.
 *
 * @typedef {{base?: number, mine?: number, theirs?: number}} Line
 */

/**
 * Three tables merged by their columns and rows, then cell by cell. Each
 * side's columns are paired with the base's by the cells they share, and
 * then its rows by the cells they share in those columns. A row or column
 * one side took out goes, unless the other changed it, when the two clash;
 * those either side put in go in where they stand, the Doc's first where
 * both put some in at one place; and each cell of the base's both kept is
 * merged word by word.
 *
 * @param {Node} base
 * @param {Node} mine
 * @param {Node} theirs
 * @returns {Both}
 */
function mergeTable(base, mine, theirs) {
  const [b, m, t] = [base, mine, theirs].map(node => childrenOf(node).map(childrenOf))
  /** @param {Node[][]} grid @param {number} k */
  const column = (grid, k) => grid.map(row => (row[k] ? keyOf(row[k]) : ''))
  /** @param {Node[][]} grid */
  const width = grid => Math.max(0, ...grid.map(row => row.length))
  /** @param {Node[][]} side */
  const columnsOf = side =>
    pairUp(width(b), width(side), (i, j) => sharedCount(column(b, i), column(side, j)))
  const [cm, ct] = [columnsOf(m), columnsOf(t)]
  /** @param {Node[][]} side @param {Array<[number, number]>} columns */
  const rowsOf = (side, columns) =>
    pairUp(b.length, side.length, (r, s) =>
      columns.reduce(
        (total, [i, j]) =>
          total + (b[r][i] && side[s][j] && keyOf(b[r][i]) === keyOf(side[s][j]) ? 1 : 0),
        0
      )
    )
  const [rm, rt] = [rowsOf(m, cm), rowsOf(t, ct)]

  /** @param {Node|undefined} cell */
  const shows = cell => !!cell && cell.textContent !== ''
  /**
   * Whether a side changed a row or a column of the base's it kept: a cell
   * of it changed, or one put in it with words.
   *
   * @param {Node[][]} side
   * @param {Array<[number, number]>} rows
   * @param {Array<[number, number]>} columns
   * @param {'row'|'column'} axis
   * @param {number} at - The base's
   */
  const changed = (side, rows, columns, axis, at) => {
    const rowOf = new Map(rows)
    const columnOf = new Map(columns)
    const keptRows = new Set(rows.map(([, s]) => s))
    const keptColumns = new Set(columns.map(([, j]) => j))
    if (axis === 'row') {
      const s = /** @type {number} */ (rowOf.get(at))
      return side[s].some((cell, j) => {
        const i = [...columnOf].find(([, cj]) => cj === j)?.[0]
        return i === undefined
          ? !keptColumns.has(j) && shows(cell)
          : keyOf(cell) !== keyOf(b[at][i])
      })
    }
    const j = /** @type {number} */ (columnOf.get(at))
    return side.some((row, s) => {
      const r = [...rowOf].find(([, rs]) => rs === s)?.[0]
      return r === undefined
        ? !keptRows.has(s) && shows(row[j])
        : !!row[j] && keyOf(row[j]) !== keyOf(b[r][at])
    })
  }
  const rows = mergeLines(
    b.length,
    [m.length, rm, at => changed(m, rm, cm, 'row', at)],
    [t.length, rt, at => changed(t, rt, ct, 'row', at)]
  )
  const columns = mergeLines(
    width(b),
    [width(m), cm, at => changed(m, rm, cm, 'column', at)],
    [width(t), ct, at => changed(t, rt, ct, 'column', at)]
  )

  let clashed = rows.clashed || columns.clashed
  /**
   * @param {Line} row
   * @param {Line} col
   * @param {'mine'|'theirs'} version
   * @returns {Node}
   */
  const cellOf = (row, col, version) => {
    /** @param {Node[][]} grid @param {'base'|'mine'|'theirs'} side */
    const at = (grid, side) => {
      const r = row[side]
      const c = col[side]
      return r === undefined || c === undefined ? undefined : grid[r]?.[c]
    }
    const [x, y, z] = [at(b, 'base'), at(m, 'mine'), at(t, 'theirs')]
    if (x && y && z) {
      if (keyOf(z) === keyOf(x) || keyOf(y) === keyOf(z)) return y
      const words = mergeWords([x], [y], [z])
      const one = words && words.mine.length === 1 && words.theirs.length === 1
      if (!words || !one) {
        clashed = true
        return version === 'mine' ? y : z
      }
      clashed ||= words.clashed
      return words[version][0]
    }
    if (y) return y
    if (z) return z
    // A cell where a row one side put in crosses a column the other did.
    const like =
      (col.mine !== undefined && m[0]?.[col.mine]) ||
      (col.theirs !== undefined && t[0]?.[col.theirs]) ||
      (col.base !== undefined && b[0]?.[col.base])
    return schema.nodes.table_cell.create(like ? { ...like.attrs } : null)
  }
  /** @param {'mine'|'theirs'} version */
  const made = version => {
    const lines = { rows: rows[version], columns: columns[version] }
    if (lines.rows.length === 0 || lines.columns.length === 0) return []
    const madeRows = lines.rows.map(row =>
      schema.nodes.table_row.create(
        null,
        lines.columns.map(col => cellOf(row, col, version))
      )
    )
    return [schema.nodes.table.create(mine.attrs, madeRows)]
  }
  const asMine = made('mine')
  const asTheirs = made('theirs')
  return { mine: asMine, theirs: clashed ? asTheirs : asMine, clashed }
}

/**
 * The rows or the columns of a merged table, in order, as each side's
 * version of the merge would have them: they differ only where they clash.
 *
 * @param {number} count - The base's
 * @param {[number, Array<[number, number]>, (at: number) => boolean]} mineSide
 *   - How many the document has, which of them are the base's, and whether
 *   it changed one of the base's
 * @param {[number, Array<[number, number]>, (at: number) => boolean]} theirsSide
 * @returns {{mine: Line[], theirs: Line[], clashed: boolean}}
 */
function mergeLines(count, mineSide, theirsSide) {
  const [mineCount, minePairs, mineChanged] = mineSide
  const [theirsCount, theirsPairs, theirsChanged] = theirsSide
  const inMine = new Map(minePairs)
  const inTheirs = new Map(theirsPairs)
  /**
   * Those a side put in, by the base's line before them.
   *
   * @param {number} total
   * @param {Array<[number, number]>} pairs
   */
  const putIn = (total, pairs) => {
    const baseOf = new Map(pairs.map(([i, j]) => [j, i]))
    /** @type {Map<number, number[]>} */
    const out = new Map()
    let after = -1
    for (let j = 0; j < total; j++) {
      const i = baseOf.get(j)
      if (i !== undefined) after = i
      else out.set(after, [...(out.get(after) ?? []), j])
    }
    return out
  }
  const mineIn = putIn(mineCount, minePairs)
  const theirsIn = putIn(theirsCount, theirsPairs)

  /** @type {{mine: Line[], theirs: Line[], clashed: boolean}} */
  const out = { mine: [], theirs: [], clashed: false }
  /** @param {Line} line @param {boolean} [inMineVersion] @param {boolean} [inTheirsVersion] */
  const add = (line, inMineVersion = true, inTheirsVersion = true) => {
    if (inMineVersion) out.mine.push(line)
    if (inTheirsVersion) out.theirs.push(line)
  }
  for (let i = -1; i < count; i++) {
    if (i >= 0) {
      const line = { base: i, mine: inMine.get(i), theirs: inTheirs.get(i) }
      const kept = [line.mine !== undefined, line.theirs !== undefined]
      if (kept[0] && kept[1]) add(line)
      else if (kept[0] && mineChanged(i)) {
        // Taken out in the Doc, and changed in the document.
        out.clashed = true
        add(line, true, false)
      } else if (kept[1] && theirsChanged(i)) {
        out.clashed = true
        add(line, false, true)
      }
    }
    for (const j of theirsIn.get(i) ?? []) add({ theirs: j })
    for (const j of mineIn.get(i) ?? []) add({ mine: j })
  }
  return out
}

/**
 * Blocks of words merged word by word, the end of each block one of them.
 *
 * @param {Node[]} base
 * @param {Node[]} mine
 * @param {Node[]} theirs
 * @returns {Both|null}
 */
function mergeWords(base, mine, theirs) {
  const [b, m, t] = [base, mine, theirs].map(tokensOf)
  const keys = [b, m, t].map(tokens => tokens.map(token => token.key))
  /** @param {boolean} startFirst */
  const laid = startFirst => {
    const chunks = diff3(keys[0], keys[1], keys[2], { maxEdits: MAX_EDITS, startFirst })
    return chunks && mergeTokens(chunks, b, m, t)
  }
  // Words added beside words like them line up either side of them: a
  // paragraph added after one ends in the same full stop and end. Lined up
  // the other way, changes that seemed to touch may not.
  let merged = laid(false)
  if (merged?.clashed) {
    const other = laid(true)
    if (other && !other.clashed) merged = other
  }
  if (!merged) return null
  const { asMine, asTheirs, clashed } = merged
  const made = { mine: blocksOf(asMine), theirs: clashed ? blocksOf(asTheirs) : null }
  if (!made.mine || (clashed && !made.theirs)) return null
  return { mine: made.mine, theirs: made.theirs ?? made.mine, clashed }
}

/**
 * Tokens laid out in chunks, merged: each side's that changed, the Doc's
 * words put among the document's in the comments around them, and both
 * where both changed differently.
 *
 * @param {import('@/utils/diff.js').Chunk[]} chunks
 * @param {Token[]} b
 * @param {Token[]} m
 * @param {Token[]} t
 * @returns {{asMine: Token[], asTheirs: Token[], clashed: boolean}}
 */
function mergeTokens(chunks, b, m, t) {
  /** @type {Token[]} */
  const asMine = []
  /** @type {Token[]} */
  const asTheirs = []
  let clashed = false
  for (const chunk of chunks) {
    const x = b.slice(...chunk.base)
    const y = m.slice(...chunk.mine)
    const z = t.slice(...chunk.theirs)
    if (chunk.stable || sameTokens(z, x) || sameTokens(y, z)) {
      asMine.push(...y)
      asTheirs.push(...y)
    } else if (sameTokens(y, x)) {
      const put = commented(z, m[chunk.mine[0] - 1], m[chunk.mine[1]])
      asMine.push(...put)
      asTheirs.push(...put)
    } else {
      clashed = true
      asMine.push(...y)
      asTheirs.push(...z)
    }
  }
  return { asMine, asTheirs, clashed }
}

/**
 * Blocks as tokens: each word, each other character and each inline node,
 * and after them the block's end.
 *
 * @param {Node[]} blocks
 * @returns {Token[]}
 */
function tokensOf(blocks) {
  /** @type {Token[]} */
  const out = []
  for (const block of blocks) {
    block.forEach(child => {
      if (child.isText) {
        const marks = marksKey(child.marks)
        for (const piece of /** @type {string} */ (child.text).match(PIECES) ?? []) {
          out.push({ key: `t${piece}\u0001${marks}`, node: schema.text(piece, child.marks) })
        }
      } else {
        out.push({ key: `n${keyOf(child)}`, node: child })
      }
    })
    out.push({ key: `e${markupKey(block)}`, end: block })
  }
  return out
}

/**
 * Tokens made blocks again, each ended by its end's kind. Null when the
 * words would not go in a block of that kind, or some have no end.
 *
 * @param {Token[]} tokens
 * @returns {Node[]|null}
 */
function blocksOf(tokens) {
  /** @type {Node[]} */
  const out = []
  /** @type {Node[]} */
  let inline = []
  for (const token of tokens) {
    if (!token.end) {
      inline.push(/** @type {Node} */ (token.node))
      continue
    }
    const made = remade(token.end, inline)
    if (!made) return null
    out.push(made)
    inline = []
  }
  return inline.length > 0 ? null : out
}

/**
 * The Doc's words put in among the document's, with any comment that runs
 * on both sides of where they go.
 *
 * @param {Token[]} tokens - The Doc's
 * @param {Token|undefined} before - The document's, before where they go
 * @param {Token|undefined} after - And after
 * @returns {Token[]}
 */
function commented(tokens, before, after) {
  const around = commentsOf(before).filter(mark => commentsOf(after).some(each => each.eq(mark)))
  if (around.length === 0) return tokens
  return tokens.map(token =>
    token.node?.isText
      ? {
          ...token,
          node: token.node.mark(around.reduce((set, mark) => mark.addToSet(set), token.node.marks)),
        }
      : token
  )
}

/**
 * @param {Token|undefined} token
 * @returns {Mark[]}
 */
function commentsOf(token) {
  if (!token?.node?.isText) return []
  return token.node.marks.filter(mark => mark.type === schema.marks.comment)
}

/**
 * Each side's choice of what one thing is, by `key`: the side that changed
 * it, or both where both did, alike or not.
 *
 * @template T
 * @param {T} base
 * @param {T} mine
 * @param {T} theirs
 * @param {(value: T) => string} key
 * @returns {{mine: T, theirs: T, clashed: boolean}}
 */
function pick(base, mine, theirs, key) {
  const [b, m, t] = [key(base), key(mine), key(theirs)]
  if (m === b) return { mine: theirs, theirs, clashed: false }
  if (t === b || t === m) return { mine, theirs: mine, clashed: false }
  return { mine, theirs, clashed: true }
}

/**
 * A node of the kind `like` is, holding `content`. Null when it cannot
 * hold it.
 *
 * @param {Node} like
 * @param {Node[]} content
 * @returns {Node|null}
 */
function remade(like, content) {
  try {
    return like.type.createChecked(like.attrs, Fragment.fromArray(content), like.marks)
  } catch {
    return null
  }
}

/**
 * @param {Node[]} base
 * @param {Node[]} blocks
 * @returns {Stretch}
 */
const agreed = (base, blocks) => ({ base, mine: blocks, theirs: blocks, clashed: false })

/**
 * @param {Node} node
 * @returns {Node[]}
 */
function childrenOf(node) {
  /** @type {Node[]} */
  const out = []
  node.forEach(child => out.push(child))
  return out
}

/**
 * Whether a node holds blocks: a list, an item, a quote, a table or a row.
 *
 * @param {Node} node
 */
const holdsBlocks = node => !node.isTextblock && !node.isLeaf && !node.inlineContent

/**
 * @param {Node[]} a
 * @param {Node[]} b
 */
const sameBlocks = (a, b) =>
  a.length === b.length && a.every((node, i) => keyOf(node) === keyOf(b[i]))

/**
 * @param {Token[]} a
 * @param {Token[]} b
 */
const sameTokens = (a, b) => a.length === b.length && a.every((token, i) => token.key === b[i].key)

/** @type {WeakMap<Node, string>} */
const keys = new WeakMap()

/**
 * What a node is, for comparing: all of it but the comments' marks, its
 * text joined where only a comment parted it.
 *
 * @param {Node} node
 * @returns {string}
 */
export function keyOf(node) {
  let key = keys.get(node)
  if (key === undefined) {
    /** @type {Array<string|{text: string, marks: string}>} */
    const content = []
    node.forEach(child => {
      const last = content.at(-1)
      if (!child.isText) content.push(keyOf(child))
      else if (typeof last === 'object' && last.marks === marksKey(child.marks)) {
        last.text += child.text
      } else
        content.push({ text: /** @type {string} */ (child.text), marks: marksKey(child.marks) })
    })
    key = JSON.stringify([markupKey(node), content])
    keys.set(node, key)
  }
  return key
}

/**
 * What kind of node one is, its contents aside.
 *
 * @param {Node} node
 * @returns {string}
 */
const markupKey = node =>
  `${node.type.name}\u0001${JSON.stringify(node.attrs)}\u0001${marksKey(node.marks)}`

/**
 * Marks, the comments' left out.
 *
 * @param {readonly Mark[]} marks
 * @returns {string}
 */
function marksKey(marks) {
  let out = ''
  for (const mark of marks) {
    if (mark.type !== schema.marks.comment) out += JSON.stringify(mark.toJSON())
  }
  return out
}
