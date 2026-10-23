/**
 * @module editor/suggestions
 * @description A suggested change: the words it would take out and those it
 * would put in, both in the text until the writer accepts or rejects it.
 *
 * In the editor the two halves are marks, `deletion` and `insertion`, each
 * with the suggestion's id; in the markdown they are CriticMarkup holding
 * the id, as a comment's passage is:
 *
 *     We had a {--cold--}{>>s4k2m1<<}{++narrow++}{>>s4k2m1<<} attic.
 *
 * What was said about it is a thread on the document's row, by that id, as
 * a comment's is (see `comments.js`).
 *
 * A change is laid out block by block, then word by word inside the blocks
 * it changed, so its marks stay inside blocks: a block whose words are all
 * one suggestion's insertion is a block it puts in, and one whose words are
 * all its deletion a block it takes out. A paragraph parted in two is the
 * paragraph's end taken out and a new paragraph put in; two joined, the
 * second's words put in at the end of the first and the second taken out.
 * No mark ever stands for a break between blocks, so accepting and
 * rejecting always mean one thing.
 *
 * A block with no words to mark carries the mark itself, put in or taken
 * out whole: a code block, a rule, a table, an empty block. So does one
 * changed where words cannot be marked: a code block's text, or a table's
 * rows or columns. In the markdown its halves stand on lines of their own
 * around it:
 *
 *     {--
 *     ---
 *     --}{>>s4k2m1<<}
 *
 * Each change in what is suggested is a suggestion of its own, accepted or
 * rejected alone: a word cut, a phrase replaced, a sentence rewritten.
 *
 * A change to a document with suggestions pending is made to the text as it
 * stands, their insertions out, and they are put back into it after. The
 * model's own pending suggestions it sees accepted, as Docs shows a writer
 * theirs: its change is made over them, laid out with them again from the
 * text as it stands, and goes into one it touches.
 *
 * Laid out the same way under one id, a change is also how a version of a
 * document is shown against its text now (`layOut`, and `comparison.js`).
 *
 * Design: `.llm/suggestions_design.md`.
 */

import { Fragment, Slice } from 'prosemirror-model'
import { Mapping, ReplaceStep, Transform } from 'prosemirror-transform'
import { schema } from './schema.js'
import { diffSequences, pairUp, sharedCount } from '../utils/diff.js'

/** @typedef {import('prosemirror-model').Node} Node */
/** @typedef {import('prosemirror-model').Mark} Mark */
/** @typedef {import('prosemirror-model').MarkType} MarkType */

/**
 * How each half is written: what opens it, and what closes it before the id.
 *
 * @type {Record<'insertion'|'deletion', {open: string, close: string}>}
 */
export const SUGGESTION_MARKUP = {
  insertion: { open: '{++', close: '++}' },
  deletion: { open: '{--', close: '--}' },
}

/** The id after a half's close. */
const ID_PATTERN = /^\{>>([a-z0-9]{4,12})<<\}/

/** Past this many changes, a stretch of words is one change. */
const MAX_EDITS = 5000

/** Past this many blocks changed, the blocks are one stretch. */
const MAX_BLOCK_EDITS = 2000

/**
 * Past this many pairs of blocks to weigh in a stretch, those taken out are
 * paired with those put in near where they are, not with the likest.
 */
const MAX_PAIRS = 10000

/** How many blocks along, of those put in, one taken out looks for its like. */
const NEAR_BLOCKS = 8

/** A word, or any other character. */
const PIECES = /[\p{L}\p{N}\p{M}_'’]+|[^]/gu

/**
 * A fresh suggestion id: like a comment's, but for its first letter.
 *
 * @returns {string}
 */
export function newSuggestionId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  let id = 's'
  for (let i = 0; i < 5; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)]
  return id
}

/**
 * The closing markup for one half of a suggestion.
 *
 * @param {'insertion'|'deletion'} kind
 * @param {string} id
 * @returns {string}
 */
export function closeSuggestion(kind, id) {
  return `${SUGGESTION_MARKUP[kind].close}{>>${id}<<}`
}

/**
 * A change suggested, and where it went: the document, the suggestions it
 * made, and each of the model's own it joined to an older one, by the one it
 * went into.
 *
 * @typedef {object} Suggested
 * @property {Node} doc
 * @property {string[]} ids - Those it made, in the text's order
 * @property {Record<string, string>} into
 */

/** Changes this many words apart in a sentence, or fewer, are one. */
const NEAR = 2

/** A word, as the words between two changes are counted. */
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu

/** The end of a sentence, which keeps the changes either side of it apart. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?:\s|$)/u

/**
 * A document with a change to it suggested: `before` with what `after` takes
 * out marked as suggested deletions, and what it puts in as insertions. Null
 * only when the change cannot be laid out at all.
 *
 * Each change in it is a suggestion of its own, to be accepted or rejected
 * alone: the words changed together, with those a word or two apart in a
 * sentence, and a paragraph parted or joined, or a block put in for one taken
 * out. The first is `id`, the rest `fresh` ones.
 *
 * `after` is the text as the model saw it, changed: `before` with the
 * pending suggestions of others rejected, which is what every reader but the
 * editor sees, and those of the model's own, `own`, accepted. The change is
 * laid out from the text as it stands, all of them rejected, so the model's
 * own are laid out again with it. Where a change touches one of the model's
 * own, it goes into that one, and where it touches two it joins them under
 * the older. One of them the change takes back is gone. Then the others'
 * insertions are put back where they were. Blocks `before` kept are its own,
 * comments, suggestions and all.
 *
 * @param {Node} before
 * @param {Node} after
 * @param {string} id
 * @param {string[]} [own] - The model's own pending suggestions, oldest first
 * @param {() => string} [fresh] - Another new id, for each change after the first
 * @returns {Suggested|null}
 */
export function suggestChange(before, after, id, own = [], fresh = newSuggestionId) {
  const pending = suggestionsIn(before)
  const mine = own.filter(each => each !== id && pending.includes(each))
  const base = rejecting(before, mine)
  const standing = dropping(
    base.doc,
    mark => mark.type === schema.marks.insertion,
    () => false
  )
  const content = contentOf(standing.doc)
  const blocks = sequenceOf(content, contentOf(after), id)
  if (!blocks) return null
  /** @param {number} pos @param {number} assoc */
  const map = (pos, assoc) => standing.mapping.map(base.mapping.map(pos, assoc), assoc)
  const places = placesOf(before, mine, map)
  const taken = new Set([...pending, id])
  const another = () => {
    let made = fresh()
    while (taken.has(made)) made = fresh()
    taken.add(made)
    return made
  }
  const grouped = apart(docOf(blocks), standing.doc, id, mine, places, another)
  const { doc: laid, ids, into } = grouped
  if (!standing.docChanged) return { doc: laid, ids, into }
  // Nothing stands but what pending ones put in, so the change is all
  // after it.
  if (content.length === 0) {
    const put = blocks.length > 0 ? childrenOf(laid) : []
    return { doc: docOf([...childrenOf(base.doc), ...put]), ids, into }
  }
  const doc = putBack(base.doc, standing, laid, grouped.all)
  return doc && { doc, ids, into }
}

/**
 * Two documents laid out as one, as a change from the first to the second
 * is, but under the one id, and with nothing of either side settled first:
 * `before` with what `after` takes out marked as deletions, and what it puts
 * in as insertions. The blocks and words both have are as `before` has them,
 * its comments and pending suggestions with them, and what it alone has
 * that a pending suggestion is on stays that suggestion's. Null when the
 * change cannot be laid out. For comparing two texts, which nothing writes
 * back.
 *
 * @param {Node} before
 * @param {Node} after
 * @param {string} id
 * @returns {Node|null}
 */
export function layOut(before, after, id) {
  const blocks = sequenceOf(contentOf(before), contentOf(after), id)
  return blocks && docOf(blocks)
}

/**
 * A part of a suggestion: a run of words carrying one of its marks, or a
 * block it puts in or takes out whole, with the marks that make it so.
 *
 * @typedef {object} Part
 * @property {number} from
 * @property {number} to
 * @property {boolean} whole
 * @property {Array<{from: number, to: number, mark: Mark, block: boolean}>} marks
 */

/**
 * Where the model's own suggestions are in the text as it stands: what they
 * take out as it is there, and what they put in as the place it would go.
 *
 * @param {Node} doc
 * @param {string[]} own
 * @param {(pos: number, assoc: number) => number} map - From `doc` to the text as it stands
 * @returns {Array<{from: number, to: number}>[]} One list for each of `own`
 */
function placesOf(doc, own, map) {
  return own.map(each =>
    partsOf(doc, each).map(part => ({ from: map(part.from, -1), to: map(part.to, 1) }))
  )
}

/**
 * The parts of a document carrying a suggestion's marks, in order. A block
 * of words all put in or all taken out is one part; a table's cell is not,
 * since it goes only with its table.
 *
 * @param {Node} doc
 * @param {string} id
 * @returns {Part[]}
 */
function partsOf(doc, id) {
  /** @param {Mark} mark */
  const its = mark => isSuggestion(mark) && mark.attrs.id === id
  /** @type {Part[]} */
  const out = []
  doc.descendants((node, pos) => {
    const to = pos + node.nodeSize
    const mark = node.marks.find(its)
    if (mark) {
      out.push({ from: pos, to, whole: true, marks: [{ from: pos, to, mark, block: true }] })
      return false
    }
    if (!node.isTextblock) return true
    /** @type {Part['marks']} */
    const marks = []
    node.forEach((child, offset) => {
      const at = pos + 1 + offset
      const mark = child.marks.find(its)
      if (mark) marks.push({ from: at, to: at + child.nodeSize, mark, block: false })
    })
    const whole =
      marks.length === node.childCount &&
      marks.length > 0 &&
      node.type !== schema.nodes.table_cell &&
      marks.every(each => each.mark.type === marks[0].mark.type)
    if (whole) out.push({ from: pos, to, whole, marks })
    else for (const each of marks) out.push({ from: each.from, to: each.to, whole, marks: [each] })
    return false
  })
  return out
}

/**
 * A change laid out under `id`, the model's own laid out again with it, with
 * each part put under the suggestion it is. A part that touches one of the
 * model's own in the text as it stands, sharing a place with it, is that
 * one's, and one touching two joins them under the older. The rest are the
 * change's, each change a suggestion of its own: parts are one where they
 * are near (`near`), or where a block put in or taken out whole moves the
 * words of the change beside it (`moved`). The first keeps `id`, and the
 * rest are given `fresh` ones. Two of the model's own stay apart however
 * near they are, unless what the change does between them joins them.
 *
 * @param {Node} laid
 * @param {Node} standing - The text as it stands, which `laid` is laid over
 * @param {string} id
 * @param {string[]} own - Oldest first
 * @param {Array<{from: number, to: number}>[]} places - Each of `own`'s, in `standing`
 * @param {() => string} fresh
 * @returns {{doc: Node, ids: string[], all: string[], into: Record<string, string>}}
 */
function apart(laid, standing, id, own, places, fresh) {
  const parts = partsOf(laid, id)
  const { mapping } = rejecting(laid, [id])
  const at = parts.map(part => ({
    from: mapping.map(part.from, -1),
    to: mapping.map(part.to, 1),
    whole: part.whole,
  }))
  // The parts first, then the model's own, each its own until joined.
  const parent = [...Array(parts.length + own.length).keys()]
  /** @param {number} i @returns {number} */
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  /** @param {number} i @param {number} j */
  const join = (i, j) => {
    parent[find(i)] = find(j)
  }
  /** @param {{from: number, to: number}} a @param {{from: number, to: number}} b */
  const touch = (a, b) => a.from <= b.to && b.from <= a.to
  const theirs = at.map((part, i) => {
    let found = false
    places.forEach((each, k) => {
      if (!each.some(place => touch(place, part))) return
      join(i, parts.length + k)
      found = true
    })
    return found
  })
  for (let i = 1; i < at.length; i++) {
    if (theirs[i - 1] && theirs[i]) continue
    if (near(standing, at[i - 1], at[i]) || moved(laid, standing, parts, at, i)) join(i - 1, i)
  }
  /** @type {Map<number, string>} */
  const owner = new Map()
  own.forEach((each, k) => {
    const root = find(parts.length + k)
    if (!owner.has(root)) owner.set(root, each)
  })
  /** @type {Record<string, string>} */
  const into = {}
  own.forEach((each, k) => {
    const target = /** @type {string} */ (owner.get(find(parts.length + k)))
    if (target !== each) into[each] = target
  })
  /** @type {string[]} */
  const ids = []
  parts.forEach((_, i) => {
    const root = find(i)
    if (owner.has(root)) return
    const made = ids.length === 0 ? id : fresh()
    owner.set(root, made)
    ids.push(made)
  })
  const tr = new Transform(laid)
  /** @type {Set<string>} */
  const all = new Set()
  parts.forEach((part, i) => {
    const target = /** @type {string} */ (owner.get(find(i)))
    all.add(target)
    if (target === id) return
    for (const each of part.marks) {
      const mark = each.mark.type.create({ id: target })
      if (each.block) tr.removeNodeMark(each.from, each.mark).addNodeMark(each.from, mark)
      else tr.removeMark(each.from, each.to, each.mark).addMark(each.from, each.to, mark)
    }
  })
  return { doc: tr.doc, ids, all: [...all], into }
}

/**
 * Whether two parts one after the other are one change: with nothing but
 * spaces and the edges of blocks between them, or, in a block of words, a
 * word or two of one sentence, so a sentence rewritten is one.
 *
 * @param {Node} doc - The text as it stands
 * @param {{from: number, to: number, whole: boolean}} a
 * @param {{from: number, to: number, whole: boolean}} b - The one after
 */
function near(doc, a, b) {
  if (b.from <= a.to) return true
  const between = doc.textBetween(a.to, b.from, '\n', '*')
  if (/^\s*$/.test(between)) return true
  if (a.whole || b.whole || between.includes('\n') || SENTENCE_END.test(between)) return false
  return (between.match(WORD)?.length ?? 0) <= NEAR
}

/**
 * Whether a block put in or taken out whole and the words changed beside it,
 * at the end of the block before it or the start of the one after, with no
 * words between, are a paragraph parted or two joined: one change, since
 * accepting either alone would lose words or have them twice. They are where
 * the block shares half its words, or half theirs, with what they change the
 * other way: what they take out, for a block put in.
 *
 * @param {Node} laid
 * @param {Node} standing
 * @param {Part[]} parts - In `laid`
 * @param {Array<{from: number, to: number, whole: boolean}>} at - In `standing`
 * @param {number} i - The second of the two
 */
function moved(laid, standing, parts, at, i) {
  const [a, b] = [at[i - 1], at[i]]
  if (a.whole === b.whole) return false
  if (standing.textBetween(a.to, b.from, '\n', '*').match(WORD)) return false
  const block = parts[a.whole ? i - 1 : i]
  const kind = block.marks[0].mark.type
  // The words changed beside it, in the one block of words they are in.
  const step = a.whole ? 1 : -1
  const first = a.whole ? i : i - 1
  const parent = laid.resolve(parts[first].from).before()
  /** @type {string[]} */
  const beside = []
  for (let j = first; j >= 0 && j < parts.length; j += step) {
    const part = parts[j]
    if (part.whole || laid.resolve(part.from).before() !== parent) break
    if (part.marks[0].mark.type !== kind) beside.push(laid.textBetween(part.from, part.to, ' '))
  }
  const words = (/** @type {string} */ text) => new Set(text.toLowerCase().match(WORD))
  const [its, theirs] = [
    words(laid.textBetween(block.from, block.to, ' ')),
    words(beside.join(' ')),
  ]
  const shared = [...its].filter(word => theirs.has(word)).length
  return shared > 0 && shared * 2 >= Math.min(its.size, theirs.size)
}

/**
 * The steps that reject some suggestions at once.
 *
 * @param {Node} doc
 * @param {string[]} ids
 * @returns {Transform}
 */
function rejecting(doc, ids) {
  /** @param {MarkType} type */
  const its = type => (/** @type {Mark} */ mark) =>
    mark.type === type && ids.includes(mark.attrs.id)
  return dropping(doc, its(schema.marks.insertion), its(schema.marks.deletion))
}

/**
 * A change laid out over the text as it stands, with the pending
 * insertions `standing` took out of `before` put back. A suggestion only
 * puts in and marks, so every place in the text as it stands is one in the
 * change too, and each insertion is mapped to its own: ProseMirror's
 * rebasing, the steps that took them out undone after the change's. Null
 * if one will not go back, or rejecting the change would not give `before`.
 *
 * @param {Node} before
 * @param {Transform} standing
 * @param {Node} laid
 * @param {string[]} ids - The change's
 * @returns {Node|null}
 */
function putBack(before, standing, laid, ids) {
  const undone = rejecting(laid, ids)
  if (!undone.doc.eq(standing.doc)) return null
  // From `before` to the text as it stands, then to the change: the maps
  // each insertion put back goes through, and its own undone among them.
  const mapping = new Mapping(standing.steps.map(step => step.getMap()))
  for (let i = undone.steps.length - 1; i >= 0; i--) {
    mapping.appendMap(undone.steps[i].getMap().invert())
  }
  const tr = new Transform(laid)
  for (let j = standing.steps.length - 1; j >= 0; j--) {
    const step = standing.steps[j].invert(standing.docs[j]).map(mapping.slice(j + 1))
    if (!step || tr.maybeStep(step).failed) return null
    mapping.appendMap(step.getMap(), j)
  }
  return rejecting(tr.doc, ids).doc.eq(before) ? tr.doc : null
}

/**
 * @param {Node[]} blocks
 * @returns {Node}
 */
function docOf(blocks) {
  return schema.nodes.doc.create(
    null,
    blocks.length > 0 ? blocks : [schema.nodes.paragraph.create()]
  )
}

/**
 * A document with a suggestion accepted: its deletions gone, its insertions
 * kept as plain words, and the blocks it took out gone.
 *
 * @param {Node} doc
 * @param {string} id
 * @returns {Node}
 */
export function acceptSuggestion(doc, id) {
  return settling(doc, id, true).doc
}

/**
 * A document with a suggestion rejected: its insertions gone, the words it
 * would have taken out kept, and the blocks it put in gone.
 *
 * @param {Node} doc
 * @param {string} id
 * @returns {Node}
 */
export function rejectSuggestion(doc, id) {
  return settling(doc, id, false).doc
}

/**
 * The steps that accept a suggestion or reject it, for a transaction that
 * can be undone.
 *
 * @param {Node} doc
 * @param {string} id
 * @param {boolean} accepted
 * @returns {Transform}
 */
export function settling(doc, id, accepted) {
  const { insertion, deletion } = schema.marks
  const [kept, dropped] = accepted ? [insertion, deletion] : [deletion, insertion]
  /** @param {MarkType} type */
  const its = type => (/** @type {Mark} */ mark) => mark.type === type && mark.attrs.id === id
  return dropping(doc, its(dropped), its(kept))
}

/**
 * The steps that show a document as one reader sees it: the suggestions
 * `accepted` names accepted, every other rejected, and no mark of either
 * left. With none named, it is the text as it stands.
 *
 * @param {Node} doc
 * @param {string[]} accepted
 * @returns {Transform}
 */
export function seeing(doc, accepted) {
  /** @param {Mark} mark */
  const goes = mark =>
    isSuggestion(mark) && (mark.type === schema.marks.deletion) === accepted.includes(mark.attrs.id)
  return dropping(doc, goes, isSuggestion)
}

/**
 * What a suggestion takes out and what it puts in, as text: the pieces of
 * each in order, those apart parted by an ellipsis.
 *
 * @param {Node} doc
 * @param {string} id
 * @returns {{out: string, in: string}}
 */
export function changeOf(doc, id) {
  const pieces = piecesOf(doc, id)
  return { out: pieces.out.join(' … '), in: pieces.in.join(' … ') }
}

/**
 * What a suggestion takes out and what it puts in, as text, piece by piece:
 * each stretch of it, its blocks' words parted by a newline.
 *
 * @param {Node} doc
 * @param {string} id
 * @returns {{out: string[], in: string[]}}
 */
export function piecesOf(doc, id) {
  /** @type {Record<string, Array<{to: number, text: string}>>} */
  const pieces = { insertion: [], deletion: [] }
  for (const part of partsOf(doc, id)) {
    const list = pieces[part.marks[0].mark.type.name]
    const text = doc.textBetween(part.from, part.to, '\n', leafText)
    const last = list.at(-1)
    if (last?.to === part.from) {
      last.text += part.whole ? `\n${text}` : text
      last.to = part.to
    } else list.push({ to: part.to, text })
  }
  /** @param {Array<{text: string}>} list */
  const texts = list => list.map(each => each.text)
  return { out: texts(pieces.deletion), in: texts(pieces.insertion) }
}

/**
 * What a leaf reads as in a change's text: a rule as it is written, a break
 * as one.
 *
 * @param {Node} leaf
 * @returns {string}
 */
const leafText = leaf =>
  leaf.type === schema.nodes.horizontal_rule
    ? '---'
    : leaf.type === schema.nodes.hard_break
      ? '\n'
      : ''

/**
 * One run of a suggestion's marks: text one half covers, or a block it puts
 * in or takes out whole.
 *
 * @typedef {Object} SuggestionRange
 * @property {string} id
 * @property {number} from
 * @property {number} to
 * @property {'insertion'|'deletion'} kind
 * @property {boolean} block - The mark is on a block, not on text
 */

/**
 * Where the suggestions' marks are in a document, in order, the runs of one
 * half that touch joined.
 *
 * @param {Node} doc
 * @returns {SuggestionRange[]}
 */
export function suggestionRanges(doc) {
  /** @type {SuggestionRange[]} */
  const out = []
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (!isSuggestion(mark)) continue
      const kind = /** @type {'insertion'|'deletion'} */ (mark.type.name)
      const [id, to, last] = [mark.attrs.id, pos + node.nodeSize, out.at(-1)]
      if (
        node.isInline &&
        last &&
        !last.block &&
        last.id === id &&
        last.kind === kind &&
        last.to === pos
      ) {
        last.to = to
      } else out.push({ id, from: pos, to, kind, block: !node.isInline })
    }
  })
  return out
}

/**
 * The suggestion at a place, if one is there: on the text either side of it,
 * or on a block it is in.
 *
 * @param {import('prosemirror-model').ResolvedPos} $pos
 * @returns {string|null} Its id
 */
export function suggestionAround($pos) {
  const marks = [...$pos.marks(), ...($pos.nodeAfter?.marks ?? [])]
  const inline = marks.find(isSuggestion)
  if (inline) return inline.attrs.id
  for (let depth = $pos.depth; depth > 0; depth--) {
    const mark = $pos.node(depth).marks.find(isSuggestion)
    if (mark) return mark.attrs.id
  }
  return null
}

/**
 * The suggestion a selection is on: the one the caret is in, or the only one
 * a selection touches, the words between its halves or around it with it.
 *
 * @param {import('prosemirror-state').Selection} selection
 * @returns {string|null} Its id
 */
export function suggestionOf(selection) {
  const { $from, from, to, empty } = selection
  if (empty) return suggestionAround($from)
  /** @type {Set<string>} */
  const ids = new Set()
  // The blocks it is in are walked too, and one put in or taken out whole is
  // marked on its block.
  $from.doc.nodesBetween(from, to, node => {
    for (const mark of node.marks) if (isSuggestion(mark)) ids.add(mark.attrs.id)
  })
  return ids.size === 1 ? [...ids][0] : null
}

/**
 * A suggestion as a list shows it: once, where it starts, with what it
 * changes.
 *
 * @typedef {{id: string, from: number, change: {out: string, in: string}}} SuggestionEntry
 */

/**
 * The suggestions in a document, one entry each, in the order they start.
 *
 * @param {Node} doc
 * @returns {SuggestionEntry[]}
 */
export function suggestionEntries(doc) {
  /** @type {Map<string, number>} */
  const starts = new Map()
  for (const range of suggestionRanges(doc))
    if (!starts.has(range.id)) starts.set(range.id, range.from)
  return [...starts].map(([id, from]) => ({ id, from, change: changeOf(doc, id) }))
}

/**
 * The ids of the suggestions in a document, in the order they start.
 *
 * @param {Node} doc
 * @returns {string[]}
 */
export function suggestionsIn(doc) {
  /** @type {Set<string>} */
  const ids = new Set()
  doc.descendants(node => {
    for (const mark of node.marks) {
      if (isSuggestion(mark)) ids.add(mark.attrs.id)
    }
  })
  return [...ids]
}

/**
 * A document's blocks, its one empty paragraph none: what an empty document
 * holds is no block to suggest taking out.
 *
 * @param {Node} doc
 * @returns {Node[]}
 */
function contentOf(doc) {
  const blocks = childrenOf(doc)
  return blocks.length === 1 && blocks[0].isTextblock && blocks[0].childCount === 0 ? [] : blocks
}

/**
 * Sibling blocks with a change to them suggested. Those both have stay as
 * `before` has them; those between are laid out as a stretch.
 *
 * @param {Node[]} before
 * @param {Node[]} after
 * @param {string} id
 * @returns {Node[]|null}
 */
function sequenceOf(before, after, id) {
  const [a, b] = [before.map(keyOf), after.map(keyOf)]
  const steps = latest(diffSequences(a, b, { maxEdits: MAX_BLOCK_EDITS }), a, b)
  if (!steps) return stretchOf(before, after, id)
  /** @type {Node[]} */
  const out = []
  /** @type {Node[]} */
  let gone = []
  /** @type {Node[]} */
  let come = []
  const flush = () => {
    if (gone.length === 0 && come.length === 0) return true
    const stretch = stretchOf(gone, come, id)
    gone = []
    come = []
    if (!stretch) return false
    out.push(...stretch)
    return true
  }
  for (const step of steps) {
    if (step.op === 'equal') {
      if (!flush()) return null
      out.push(before[step.a])
    } else if (step.op === 'delete') gone.push(before[step.a])
    else come.push(after[step.b])
  }
  if (!flush()) return null
  // Two lists of one kind side by side would be read back as one, so they
  // are one: only a list taken out whole can be beside one put in whole,
  // since neither side has two lists together, and the one list holds the
  // items of both, out and in.
  /** @type {Node[]} */
  const joined = []
  for (const node of out) {
    const last = joined.at(-1)
    if (!last || !isList(node) || node.type !== last.type) {
      joined.push(node)
      continue
    }
    const made =
      markupKey(node) === markupKey(last) &&
      remade(last, [...childrenOf(last), ...childrenOf(node)])
    if (!made) return null
    joined[joined.length - 1] = made
  }
  return joined
}

/**
 * A diff's steps with each item put in or taken out as late as it can be
 * among items like it: a block put in beside its twin is the one after it,
 * however the rest of the change lies, so a suggestion laid out again with
 * more changed around it comes out where it was.
 *
 * @param {import('../utils/diff.js').Step[]|null} steps
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 * @returns {import('../utils/diff.js').Step[]|null}
 */
function latest(steps, a, b) {
  if (!steps) return null
  const out = [...steps]
  /** @param {import('../utils/diff.js').Step} step */
  const itemOf = step => (step.op === 'insert' ? b[step.b] : a[step.a])
  for (let k = 0; k < out.length; ) {
    const { op } = out[k]
    let end = k
    while (end < out.length && out[end].op === op) end++
    const next = out[end]
    // From the first of a run's items that is the one after it again, the
    // run is the same change one along: that item kept, and the one after
    // put in or taken out.
    const from =
      op === 'equal' || next?.op !== 'equal'
        ? -1
        : out.slice(k, end).findIndex(step => itemOf(step) === itemOf(next))
    if (from === -1) {
      k = end
      continue
    }
    const at = k + from
    const step = out[at]
    const kept = /** @type {{op: 'equal', a: number, b: number}} */ (next)
    out.splice(
      at,
      end - at + 1,
      step.op === 'insert'
        ? { op: 'equal', a: kept.a, b: step.b }
        : { op: 'equal', a: step.a, b: kept.b },
      ...out.slice(at + 1, end),
      step.op === 'insert' ? { op: 'insert', b: kept.b } : { op: 'delete', a: kept.a }
    )
    k = at + 1
  }
  return out
}

/** @param {Node} node */
const isList = node =>
  node.type === schema.nodes.bullet_list || node.type === schema.nodes.ordered_list

/**
 * Blocks a change took out and put in at one place, laid out: those alike
 * paired and changed within, the rest taken out or put in whole.
 *
 * @param {Node[]} gone
 * @param {Node[]} come
 * @param {string} id
 * @returns {Node[]|null}
 */
function stretchOf(gone, come, id) {
  const pairs = pairsOf(gone, come)
  /** @type {Array<Node|null>} */
  const out = []
  let i = 0
  let j = 0
  for (const [a, b] of pairs) {
    while (i < a) out.push(wholly(gone[i++], schema.marks.deletion, id))
    while (j < b) out.push(wholly(come[j++], schema.marks.insertion, id))
    const changed = changedOf(gone[a], come[b], id)
    if (!changed) return null
    out.push(...changed)
    i = a + 1
    j = b + 1
  }
  while (i < gone.length) out.push(wholly(gone[i++], schema.marks.deletion, id))
  while (j < come.length) out.push(wholly(come[j++], schema.marks.insertion, id))
  return out.every(Boolean) ? /** @type {Node[]} */ (out) : null
}

/**
 * The blocks of a stretch that are one changed, in order: of those taken out
 * and put in, as many alike pairs as can be, the likest. Weighing every pair
 * costs the one count times the other, so in a long stretch, a whole text
 * changed throughout, each taken out is paired instead with the first alike
 * of the next few put in.
 *
 * @param {Node[]} gone
 * @param {Node[]} come
 * @returns {Array<[number, number]>}
 */
function pairsOf(gone, come) {
  if (gone.length * come.length <= MAX_PAIRS) {
    return pairUp(gone.length, come.length, (i, j) => likeness(gone[i], come[j])).filter(([i, j]) =>
      alike(gone[i], come[j])
    )
  }
  /** @type {Array<[number, number]>} */
  const out = []
  let j = 0
  for (let i = 0; i < gone.length && j < come.length; i++) {
    const end = Math.min(j + NEAR_BLOCKS, come.length)
    for (let k = j; k < end; k++) {
      if (!alike(gone[i], come[k])) continue
      out.push([i, k])
      j = k + 1
      break
    }
  }
  return out
}

/**
 * One block changed into another of its kind: words by words, a list, a
 * quote or an item child by child, a table cell by cell. Of another kind, a
 * table of another shape, or a code block, the one taken out and the other
 * put in.
 *
 * @param {Node} before
 * @param {Node} after
 * @param {string} id
 * @returns {Node[]|null}
 */
function changedOf(before, after, id) {
  if (markupKey(before) === markupKey(after)) {
    if (before.isTextblock) {
      const words = !before.type.spec.code && wordsChanged(before, after, id)
      if (words) return [words]
    } else if (before.type === schema.nodes.table) {
      const table = tableChanged(before, after, id)
      if (table) return [table]
    } else if (!before.isLeaf) {
      const children = sequenceOf(childrenOf(before), childrenOf(after), id)
      const made = children && remade(before, children)
      if (made) return [made]
    }
  }
  const gone = wholly(before, schema.marks.deletion, id)
  const come = wholly(after, schema.marks.insertion, id)
  return gone && come ? [gone, come] : null
}

/**
 * A table changed cell by cell, when it keeps its shape. Null when it does
 * not, for the table to be taken out and put in whole.
 *
 * @param {Node} before
 * @param {Node} after
 * @param {string} id
 * @returns {Node|null}
 */
function tableChanged(before, after, id) {
  const [rows, others] = [childrenOf(before), childrenOf(after)]
  if (rows.length !== others.length) return null
  /** @type {Node[]} */
  const made = []
  for (let r = 0; r < rows.length; r++) {
    const [cells, otherCells] = [childrenOf(rows[r]), childrenOf(others[r])]
    if (cells.length !== otherCells.length) return null
    /** @type {Node[]} */
    const row = []
    for (let c = 0; c < cells.length; c++) {
      if (markupKey(cells[c]) !== markupKey(otherCells[c])) return null
      const cell =
        keyOf(cells[c]) === keyOf(otherCells[c])
          ? cells[c]
          : wordsChanged(cells[c], otherCells[c], id)
      if (!cell) return null
      row.push(cell)
    }
    const remadeRow = remade(rows[r], row)
    if (!remadeRow) return null
    made.push(remadeRow)
  }
  return remade(before, made)
}

/**
 * A block of words changed into another of its kind, word by word: the words
 * both have as `before` has them, the others marked. A space between two
 * changes goes with them, so a phrase rewritten reads as one change. Null
 * when the change is too large to lay out, or would leave nothing of either
 * side to tell it by: an empty block filled, or one emptied, which is the
 * one block taken out and the other put in.
 *
 * @param {Node} before
 * @param {Node} after
 * @param {string} id
 * @returns {Node|null}
 */
function wordsChanged(before, after, id) {
  const cell = before.type === schema.nodes.table_cell
  if (!cell && (before.childCount === 0 || after.childCount === 0)) return null
  const [a, b] = [wordsOf(before), wordsOf(after)]
  const [aKeys, bKeys] = [a.map(word => word.key), b.map(word => word.key)]
  const steps = latest(diffSequences(aKeys, bKeys, { maxEdits: MAX_EDITS }), aKeys, bKeys)
  if (!steps) return null
  /** @type {Array<{op: 'equal'|'delete'|'insert', node: Node}>} */
  const laid = steps.map(step =>
    step.op === 'insert'
      ? { op: step.op, node: b[step.b].node }
      : { op: step.op, node: a[step.a].node }
  )
  // Changes parted only by a space are one change: all it takes out, the
  // spaces among them, then all it puts in.
  /** @type {typeof laid} */
  const folded = []
  for (let k = 0; k < laid.length; ) {
    if (laid[k].op === 'equal') {
      folded.push(laid[k++])
      continue
    }
    let end = k
    while (end < laid.length) {
      const word = laid[end]
      const between =
        word.op === 'equal' && /^\s$/.test(word.node.text ?? '') && laid[end + 1]?.op !== 'equal'
      if (word.op !== 'equal' || (between && end + 1 < laid.length)) end++
      else break
    }
    const change = laid.slice(k, end)
    for (const word of change)
      if (word.op !== 'insert') folded.push({ op: 'delete', node: word.node })
    for (const word of change)
      if (word.op !== 'delete') folded.push({ op: 'insert', node: word.node })
    k = end
  }
  /** @type {Node[]} */
  const content = []
  for (let k = 0; k < folded.length; k++) {
    const { op, node } = folded[k]
    if (op === 'equal') content.push(node)
    else if (op === 'delete') content.push(marked(node, schema.marks.deletion, id))
    else content.push(marked(inComments(node, folded, k), schema.marks.insertion, id))
  }
  return remade(before, content)
}

/**
 * Words put in, with the comments both the words before and after them are
 * in: words put in inside a commented passage are in its comment.
 *
 * @param {Node} node
 * @param {Array<{op: string, node: Node}>} laid
 * @param {number} at
 * @returns {Node}
 */
function inComments(node, laid, at) {
  let b = at - 1
  while (b >= 0 && laid[b].op === 'insert') b--
  let f = at + 1
  while (f < laid.length && laid[f].op === 'insert') f++
  const before = b >= 0 ? commentsOf(laid[b].node) : []
  const after = f < laid.length ? commentsOf(laid[f].node) : []
  const around = before.filter(mark => after.some(each => each.eq(mark)))
  return around.reduce((each, mark) => each.mark(mark.addToSet(each.marks)), node)
}

/**
 * A block put in or taken out whole: its words marked, or where it has none
 * to mark, itself. A list's or a quote's are its blocks'.
 *
 * @param {Node} node
 * @param {MarkType} type
 * @param {string} id
 * @returns {Node|null}
 */
function wholly(node, type, id) {
  if (node.isTextblock && node.childCount > 0 && !node.type.spec.code) {
    /** @type {Node[]} */
    const content = []
    node.forEach(child => content.push(marked(child, type, id)))
    return remade(node, content)
  }
  if (node.isTextblock || node.isLeaf || node.type === schema.nodes.table) {
    return marked(node, type, id)
  }
  /** @type {Node[]} */
  const children = []
  for (const child of childrenOf(node)) {
    const made = wholly(child, type, id)
    if (!made) return null
    children.push(made)
  }
  return remade(node, children)
}

/**
 * The steps that take out of a document what carries a mark `drops` picks,
 * and take the marks `keeps` picks off what stays. A block of words goes
 * when they all do, and a list, a quote or an item when its blocks all go; a
 * table's cells stay, emptied. A document left with nothing is one empty
 * paragraph.
 *
 * @param {Node} doc
 * @param {(mark: Mark) => boolean} drops
 * @param {(mark: Mark) => boolean} keeps
 * @returns {Transform}
 */
function dropping(doc, drops, keeps) {
  const tr = new Transform(doc)
  const gone = goneIn(doc, -1, true, drops)
  if (!gone) tr.replaceWith(0, doc.content.size, schema.nodes.paragraph.create())
  else {
    // From the end, so each range is where it was.
    for (const [from, to] of gone.reverse()) tr.maybeStep(new ReplaceStep(from, to, Slice.empty))
  }
  /** @type {Mark[]} */
  const inline = []
  tr.doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (!keeps(mark)) continue
      if (!node.isInline) tr.removeNodeMark(pos, mark)
      else if (!inline.some(each => each.eq(mark))) inline.push(mark)
    }
  })
  for (const mark of inline) tr.removeMark(0, tr.doc.content.size, mark)
  return tr
}

/**
 * What of a node goes when what carries a mark `drops` picks is taken out:
 * null when all of it, or else the ranges inside it, in order.
 *
 * @param {Node} node
 * @param {number} pos - Where it starts; -1 for the document
 * @param {boolean} removable - False for a table's row or cell, which goes only with the table
 * @param {(mark: Mark) => boolean} drops
 * @returns {Array<[number, number]>|null}
 */
function goneIn(node, pos, removable, drops) {
  if (removable && node.marks.some(drops)) return null
  if (node.isLeaf) return []
  const cells = node.type === schema.nodes.table || node.type === schema.nodes.table_row
  /** @type {Array<[number, number]>} */
  const out = []
  let all = node.childCount > 0
  node.forEach((child, offset) => {
    const at = pos + 1 + offset
    const inner = child.isInline
      ? child.marks.some(drops)
        ? null
        : []
      : goneIn(child, at, !cells, drops)
    if (!inner) out.push([at, at + child.nodeSize])
    else {
      all = false
      out.push(...inner)
    }
  })
  return all && removable ? null : out
}

/**
 * Markdown-it rules that read a suggestion's markup: for each half, one that
 * opens it at `{++` or `{--` when its close is ahead, and one that closes it
 * at `++}{>>…<<}` or `--}{>>…<<}`. A half left without its other is the
 * text it was, as a comment's is. A block's halves stand on lines of their
 * own around it.
 *
 * @param {import('markdown-it').MarkdownIt} md
 */
export function suggestionMarkupPlugin(md) {
  /** @type {WeakMap<import('markdown-it').StateInline, Set<string>>} */
  const opened = new WeakMap()

  // First, so that nothing reads its open as the start of something else:
  // `{--` over a rule's `---` would be a heading.
  md.block.ruler.before('table', 'suggestion_block', suggestedBlock)

  for (const [kind, { open, close }] of Object.entries(SUGGESTION_MARKUP)) {
    md.inline.ruler.before(
      'emphasis',
      kind,
      /** @type {(state: import('markdown-it').StateInline, silent: boolean) => boolean} */ (
        (state, silent) => {
          const { src, pos, posMax } = state
          if (!src.startsWith(open, pos)) return false
          const end = closeAhead(src, pos + open.length, posMax, close)
          if (!end) return false
          if (silent) {
            state.pos = end.end
            return true
          }
          const token = state.push(`${kind}_open`, kind === 'insertion' ? 'ins' : 'del', 1)
          token.attrSet('id', end.id)
          state.pos += open.length
          let kinds = opened.get(state)
          if (!kinds) opened.set(state, (kinds = new Set()))
          kinds.add(kind)
          return true
        }
      )
    )

    md.inline.ruler.before(
      'emphasis',
      `${kind}_close`,
      /** @type {(state: import('markdown-it').StateInline, silent: boolean) => boolean} */ (
        (state, silent) => {
          const { src, pos, posMax } = state
          if (!opened.get(state)?.has(kind) || !src.startsWith(close, pos)) return false
          const match = ID_PATTERN.exec(src.slice(pos + close.length, posMax))
          if (!match) return false
          if (!silent) {
            const token = state.push(`${kind}_close`, kind === 'insertion' ? 'ins' : 'del', -1)
            token.attrSet('id', match[1])
            token.markup = close + match[0]
          }
          state.pos += close.length + match[0].length
          return true
        }
      )
    )
  }

  md.inline.ruler2.push(
    'suggestion_balance',
    /** @type {(state: import('markdown-it').StateInline) => boolean} */ (
      state => {
        if (!opened.get(state)) return false
        // Each close ends the open before it of its kind and id; a half left
        // over is the text it was.
        /** @type {number[]} */
        const open = []
        /** @type {number[]} */
        const loose = []
        state.tokens.forEach((token, i) => {
          const kind = /^(insertion|deletion)_(open|close)$/.exec(token.type)
          if (!kind) return
          if (kind[2] === 'open') {
            open.push(i)
            return
          }
          let at = open.length - 1
          while (
            at >= 0 &&
            (state.tokens[open[at]].type !== `${kind[1]}_open` ||
              state.tokens[open[at]].attrGet('id') !== token.attrGet('id'))
          )
            at--
          if (at === -1) loose.push(i)
          else open.splice(at, 1)
        })
        for (const i of [...open, ...loose]) {
          const kind = /** @type {'insertion'|'deletion'} */ (state.tokens[i].type.split('_')[0])
          const text = new state.Token('text', '', 0)
          text.content =
            state.tokens[i].nesting === 1 ? SUGGESTION_MARKUP[kind].open : state.tokens[i].markup
          state.tokens[i] = text
        }
        opened.delete(state)
        return false
      }
    )
  )
}

/**
 * Where the close is that ends a half opening at a place, and its id: the
 * first close of its kind ahead, since a half holds no other of its kind.
 *
 * @param {string} src
 * @param {number} from - Past the open
 * @param {number} max
 * @param {string} close
 * @returns {{id: string, end: number}|null}
 */
function closeAhead(src, from, max, close) {
  for (let at = src.indexOf(close, from); at !== -1 && at < max; at = src.indexOf(close, at + 1)) {
    const match = ID_PATTERN.exec(src.slice(at + close.length, max))
    if (match) return { id: match[1], end: at + close.length + match[0].length }
  }
  return null
}

/**
 * The block rule for a whole block's suggestion: its open on a line of its
 * own, the blocks it is on, and its close and id on a line after them, at
 * the open's depth. Nothing between is an empty paragraph, which is all an
 * empty paragraph writes.
 *
 * @param {import('markdown-it').StateBlock} state
 * @param {number} startLine
 * @param {number} endLine
 * @param {boolean} silent
 * @returns {boolean}
 */
function suggestedBlock(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const lineOf = (/** @type {number} */ line) =>
    state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trimEnd()
  const open = lineOf(startLine)
  const kind = /** @type {const} */ (['insertion', 'deletion']).find(
    each => SUGGESTION_MARKUP[each].open === open
  )
  if (!kind) return false
  const { close } = SUGGESTION_MARKUP[kind]
  let end = startLine + 1
  /** @type {RegExpExecArray|null} */
  let match = null
  for (; end < endLine; end++) {
    if (state.sCount[end] < state.blkIndent && !state.isEmpty(end)) return false
    const text = lineOf(end)
    match = text.startsWith(close) ? ID_PATTERN.exec(text.slice(close.length)) : null
    if (match && close.length + match[0].length === text.length) break
    match = null
  }
  if (!match) return false
  if (silent) return true

  const tag = kind === 'insertion' ? 'ins' : 'del'
  const first = state.push(`${kind}_open`, tag, 1)
  first.attrSet('id', match[1])
  first.block = true
  first.map = [startLine, end + 1]
  const [lineMax, parentType] = [state.lineMax, state.parentType]
  state.lineMax = end
  // A rule of markdown-it's own, as its container blocks set it.
  state.parentType = /** @type {any} */ ('suggestion')
  const count = state.tokens.length
  state.md.block.tokenize(state, startLine + 1, end)
  if (state.tokens.length === count) {
    state.push('paragraph_open', 'p', 1)
    const inline = state.push('inline', '', 0)
    inline.content = ''
    inline.children = []
    state.push('paragraph_close', 'p', -1)
  }
  state.lineMax = lineMax
  state.parentType = parentType
  const last = state.push(`${kind}_close`, tag, -1)
  last.block = true
  state.line = end + 1
  return true
}

/**
 * A block's words, each with what it is for comparing: its text and marks,
 * comments and suggestions aside. An inline node is one word.
 *
 * @param {Node} block
 * @returns {Array<{key: string, node: Node}>}
 */
function wordsOf(block) {
  /** @type {Array<{key: string, node: Node}>} */
  const out = []
  block.forEach(child => {
    if (child.isText) {
      const marks = marksKey(child.marks)
      for (const piece of /** @type {string} */ (child.text).match(PIECES) ?? []) {
        out.push({ key: `t${piece}\u0001${marks}`, node: schema.text(piece, child.marks) })
      }
    } else out.push({ key: `n${keyOf(child)}`, node: child })
  })
  return out
}

/**
 * How alike two blocks are: the words they share, and one more for being of
 * one kind, so that a pair of one kind is taken over a pair of two.
 *
 * @param {Node} a
 * @param {Node} b
 * @returns {number}
 */
function likeness(a, b) {
  return (a.type === b.type ? 1 : 0) + sharedCount(wordsIn(a), wordsIn(b))
}

/** @type {WeakMap<Node, string[]>} */
const blockWords = new WeakMap()

/**
 * A block's words, those of its blocks and cells apart, without the
 * punctuation every block shares. Read once for each block, which a stretch
 * weighs against every block on the other side of it.
 *
 * @param {Node} node
 * @returns {string[]}
 */
function wordsIn(node) {
  let found = blockWords.get(node)
  if (!found) {
    const text = node.textBetween(0, node.content.size, ' ', ' ')
    found = (text.match(PIECES) ?? []).filter(piece => /[\p{L}\p{N}]/u.test(piece))
    blockWords.set(node, found)
  }
  return found
}

/**
 * Whether two blocks are one changed rather than one taken out and another
 * put in: of one kind, and sharing at least half the words of the shorter.
 *
 * @param {Node} a
 * @param {Node} b
 */
function alike(a, b) {
  if (a.type !== b.type) return false
  const shorter = Math.min(wordsIn(a).length, wordsIn(b).length)
  return shorter > 0 && 2 * sharedCount(wordsIn(a), wordsIn(b)) >= shorter
}

/**
 * @param {Node} node
 * @param {MarkType} type
 * @param {string} id
 * @returns {Node}
 */
function marked(node, type, id) {
  // What a pending suggestion takes out already stays its own.
  if (type === schema.marks.deletion && node.marks.some(isSuggestion)) return node
  return node.mark(type.create({ id }).addToSet(node.marks))
}

/** @param {Mark} mark */
const isSuggestion = mark =>
  mark.type === schema.marks.insertion || mark.type === schema.marks.deletion

/**
 * @param {Node} node
 * @returns {Mark[]}
 */
function commentsOf(node) {
  return node.marks.filter(mark => mark.type === schema.marks.comment)
}

/**
 * A node of the kind `like` is, holding `content`. Null when it cannot.
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
 * @param {Node} node
 * @returns {Node[]}
 */
function childrenOf(node) {
  /** @type {Node[]} */
  const out = []
  node.forEach(child => out.push(child))
  return out
}

/** @type {WeakMap<Node, string>} */
const keys = new WeakMap()

/**
 * What a node is, for comparing: all of it but comments and suggestions, its
 * text joined where only those parted it.
 *
 * @param {Node} node
 * @returns {string}
 */
function keyOf(node) {
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
 * Marks, comments and suggestions left out.
 *
 * @param {readonly Mark[]} marks
 * @returns {string}
 */
function marksKey(marks) {
  let out = ''
  for (const mark of marks) {
    if (mark.type !== schema.marks.comment && !isSuggestion(mark)) {
      out += JSON.stringify(mark.toJSON())
    }
  }
  return out
}
