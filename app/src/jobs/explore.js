/**
 * @module jobs/explore
 * @description What a project holds, described for the model.
 *
 * The model finds its way around a project by the listing, and a listing of
 * titles says little: "Notes 3", a paper by its file name. Explore gives each
 * document and folder a digest (`Digest` in types/models.js): a line for the
 * listing and a paragraph for when the model looks closer. It does it without
 * tools. The app knows what is in a folder, so it walks the tree itself and
 * sends each piece's text with a prompt, and a small model that can't be
 * trusted to call tools can still say what it read.
 *
 * How the work is cut follows from how much text one request carries (the
 * budget, `budgetFor`):
 *
 * - A folder whose text all fits is read whole, and the one answer describes
 *   it and each document in it long enough to be worth a line of its own. A
 *   lorebook of short entries is one request.
 * - Otherwise each document is read, small ones several to a request, and one
 *   longer than a request is read in parts along its headings, then put
 *   together from what was said of each part.
 * - A folder too big to read whole is put together from what was said of
 *   what it holds, its short documents as they are, in parts when they will
 *   not go in one request. The project's digest is put together last.
 *
 * A document that holds others, as an import may make one, is described from
 * its own text when it has one, and what it holds beside it, each by itself;
 * one with no text of its own, a card's picture or an epub, is described from
 * what it holds, as a folder is.
 *
 * A long section of a document (`SECTION_WORDS`) gets a line of its own, so
 * the model can tell which part of a long document to read: asked for in
 * the request that reads the section's heading, and kept on the document's
 * digest. Which sections is decided by how long they are, not by their
 * level: a book's chapters may be four headings down, and a rulebook's
 * one-sentence entries one.
 *
 * Each request is a step of an `explore` job, waiting on the steps it reads
 * from (`after`), so documents are read side by side as far as the
 * connection allows. What is current is left alone: a digest says what it was
 * made from (`of`), and a document whose text has not changed, or a folder
 * nothing under it has changed in, keeps its digest.
 *
 * Everything here is pure: the tree comes in as `ExploreNode`s, made from the
 * documents by whoever starts the job (`jobs/index.js`), and a step reads the
 * project as it stands when it runs through an `ExploreReader`.
 */

import explorePrompt from '@/ai/prompts/explore.md?raw'
import { textHash } from '@/ai/context/reads.js'
import { sectionsOfText } from '@/ai/tools/slices.js'
import { linesOfText, planRequests, unitsOf } from './sections.js'

/** @typedef {import('@/types/models.js').Digest} Digest */
/** @typedef {import('@/types/models.js').JobStep} JobStep */

/**
 * A document or folder as explore sees it.
 *
 * @typedef {Object} ExploreNode
 * @property {string} id
 * @property {string} path - As the tools give it: `Notes/Elara`, and `/` for the project
 * @property {string} title
 * @property {'folder'|'text'|'file'} type
 * @property {string} text - What is read of it: a text's markdown, the text
 *   read out of a file; '' for a folder
 * @property {number} words
 * @property {string} [leftOut] - Why it is not read, said in its folder's
 *   digest: `a codebase`, `a file with no text`
 * @property {ExploreNode[]} children - The ones shown to the model, in the outline's
 *   order: a folder's, or a document's that holds others
 * @property {Digest} [digest]
 */

/**
 * What a step puts together from: a digest made already, a short document's
 * text, an earlier step's answer, or something not read, by name.
 *
 * @typedef {{digest: string}|{text: string}|{step: string}|{left: string}} Piece
 */

/**
 * One request of an explore job.
 *
 * @typedef {Object} ExploreWork
 * @property {'read'|'part'|'gather'} kind - Read documents whole, read part of
 *   one, or put together what was said of others
 * @property {string[]} [reads] - read: the documents whose text it sends
 * @property {string} [whole] - read: the folder read whole, when it is one
 * @property {string} [of] - part: the document it reads part of; gather: the
 *   document or folder it puts together
 * @property {number} [from] - part: its first line, of `linesOfText`
 * @property {number} [to] - part: its end, exclusive
 * @property {number} [part] - part, and a gather in parts: which, from 1
 * @property {number} [parts] - How many parts there are
 * @property {Piece[]} [pieces] - gather: what it reads
 * @property {Record<string, string>} answers - What it describes, by id, with
 *   what each digest is made from. Empty for a part, whose answer only goes
 *   into what is put together from it.
 * @property {string[]} [drop] - Short documents whose old digests go: they are
 *   read as part of their folder's now
 * @property {Record<string, string[]>} [sections] - read and part: the long
 *   sections whose headings it reads, by link, by the document's id: each is
 *   asked for a line
 * @property {string[]} [sectionsFrom] - gather of a document read in parts:
 *   the parts whose answers hold its sections' lines
 */

/**
 * What an explore job is planned from.
 *
 * @typedef {Object} ExplorePlan
 * @property {string} rootId - What was explored: a folder, a document, or the
 *   project's root
 * @property {number} budget - How much text a request carries, in characters
 * @property {Record<string, ExploreWork>} work - By step id
 */

/**
 * A plan, and what it will cost.
 *
 * @typedef {Object} PlannedExplore
 * @property {ExplorePlan} plan
 * @property {JobStep[]} steps
 * @property {number} documents - How many documents it reads
 * @property {number} chars - About how much text it sends, in all
 */

/**
 * What a step reads, as the project is when it runs.
 *
 * @typedef {Object} ExploreReader
 * @property {(id: string) => ExploreNode|null} node - Null for one gone or hidden since
 * @property {(stepId: string) => string} output - What an earlier step answered
 */

/**
 * A section this long, its subsections with it, gets a line of its own on its
 * document's digest. Shorter, it is quicker to read than to describe.
 */
export const SECTION_WORDS = 1000

/** The most sections of one document that get a line: the longest first. */
export const SECTIONS_MOST = 60

/**
 * A document shorter than this has no digest of its own: its text is about as
 * short as one would be, and it is read in its folder's. A note of a hundred
 * words is worth a line of its own in the listing; a standup of forty is not.
 */
export const SHORT_WORDS = 80

/** How many documents one request describes at most, when several go together. */
export const PACK_MOST = 8

/** What a request carries where nothing says how long a context the model has. */
export const DEFAULT_BUDGET = 48000

/** The most a request carries: past this a description gets worse rather than better. */
export const MOST_BUDGET = 400000

/** What a digest comes to, about, for planning what is put together from them. */
const DIGEST_CHARS = 1200

/** What each document costs in a request beside its text: its tags and path. */
const OVERHEAD = 120

/** Characters to a token, counted low: a PDF's text is noisy, and too much is refused. */
const CHARS_PER_TOKEN = 3

/** Tokens kept for the prompt around the text and for the answer. */
const KEPT_TOKENS = 8000

/**
 * How much text one request carries, in characters, for a model with this
 * long a context: what fits after the prompt and room for the answer, up to
 * MOST_BUDGET; half the context for a small one; DEFAULT_BUDGET when nothing
 * says.
 *
 * @param {number|undefined} contextLength - In tokens
 * @returns {number}
 */
export function budgetFor(contextLength) {
  if (!contextLength || contextLength <= 0) return DEFAULT_BUDGET
  const tokens = Math.max(contextLength / 2, contextLength - KEPT_TOKENS)
  return Math.min(MOST_BUDGET, Math.floor(tokens * CHARS_PER_TOKEN))
}

// ---------------------------------------------------------------------------
// What is current
// ---------------------------------------------------------------------------

/**
 * Documents' bases as last worked out, by id, with what they were worked out
 * from. The listing asks after every digest on every turn, and a document
 * whose text is the same string as before needs no hashing again.
 *
 * @type {Map<string, {title: string, text: string, basis: string}>}
 */
const bases = new Map()

/**
 * What a document's digest is made from, hashed: its title and its text.
 *
 * @param {ExploreNode} node
 * @returns {string}
 */
export function documentBasis(node) {
  const had = bases.get(node.id)
  if (had && had.title === node.title && had.text === node.text) return had.basis
  const basis = textHash(`${node.title}\n${node.text}`)
  bases.set(node.id, { title: node.title, text: node.text, basis })
  return basis
}

/**
 * What a folder's digest is made from, hashed: everything shown under it,
 * each by its id, its title and what its own digest is made from. Anything
 * changed, added, hidden or taken out below changes it.
 *
 * @param {ExploreNode} folder
 * @param {Map<string, string>} [known] - Folders worked out already
 * @returns {string}
 */
export function folderBasis(folder, known = new Map()) {
  const had = known.get(folder.id)
  if (had) return had
  const basis = textHash(
    folder.children.map(child => `${child.id} ${child.title} ${basisOf(child, known)}`).join('\n')
  )
  known.set(folder.id, basis)
  return basis
}

/**
 * What a document's or a folder's digest is made from.
 *
 * @param {ExploreNode} node
 * @param {Map<string, string>} [known] - Worked out already, by id
 * @returns {string}
 */
export function basisOf(node, known) {
  if (fromWhatItHolds(node)) return folderBasis(node, known)
  if (node.leftOut) return 'left'
  const had = known?.get(node.id)
  if (had) return had
  const basis = documentBasis(node)
  known?.set(node.id, basis)
  return basis
}

// ---------------------------------------------------------------------------
// Long documents, in parts
// ---------------------------------------------------------------------------

/**
 * Where a document longer than a request is cut: along its headings, as a
 * conversion cuts one, and at a paragraph or a page within a section too
 * long for one request. Lines are those of `linesOfText`, which takes a
 * PDF's page markers out and keeps each line's page.
 *
 * @param {string} text
 * @param {number} budget
 * @returns {Array<{from: number, to: number, chars: number}>}
 */
export function partsOf(text, budget) {
  const lines = linesOfText(text)
  const headings = lines.flatMap((line, at) => {
    const heading = /^(#{1,6})\s+(\S.*)$/.exec(line.text)
    return heading ? [{ title: heading[2], level: heading[1].length, line: at, consumed: 0 }] : []
  })
  return planRequests(lines, unitsOf(lines, headings), budget).map(request => {
    const from = request.units[0].from
    const to = request.units[request.units.length - 1].to
    let chars = 0
    for (let at = from; at < to; at++) chars += lines[at].text.length + 1
    return { from, to, chars }
  })
}

/**
 * A part's text, with its page markers written back in where the page turns.
 *
 * @param {import('./sections.js').SourceLine[]} lines
 * @param {number} from
 * @param {number} to
 * @returns {string}
 */
export function partText(lines, from, to) {
  /** @type {string[]} */
  const out = []
  /** @type {number|null} */
  let page = null
  for (const line of lines.slice(from, to)) {
    if (line.page !== null && line.page !== page) {
      out.push(`[p.${line.page}]`)
      page = line.page
    }
    out.push(line.text)
  }
  return out.join('\n').trim()
}

/**
 * The pages a part runs over, as a label says them: `pp. 12–19`.
 *
 * @param {import('./sections.js').SourceLine[]} lines
 * @param {number} from
 * @param {number} to
 * @returns {string} '' for a text without pages
 */
export function pagesOf(lines, from, to) {
  const first = lines.slice(from, to).find(line => line.page !== null)?.page
  const last = lines
    .slice(from, to)
    .reverse()
    .find(line => line.page !== null)?.page
  if (first === undefined || first === null || last === undefined || last === null) return ''
  return first === last ? `p. ${first}` : `pp. ${first}–${last}`
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * What a step's label calls a document or folder: its title, a folder's with
 * a slash.
 * @param {ExploreNode} node
 */
const labelOf = node =>
  node.type === 'folder' && node.path !== '/' ? `${node.title}/` : node.title

/** @param {ExploreNode} node */
const isRead = node => node.type !== 'folder' && !node.leftOut && node.text.trim() !== ''

/**
 * Whether a digest is made from what something holds: a folder's, or a
 * document's that holds others and has no text of its own.
 *
 * @param {ExploreNode} node
 */
const fromWhatItHolds = node =>
  node.type === 'folder' || (node.children.length > 0 && !isRead(node))

/** @param {ExploreNode} node */
const worthALine = node => isRead(node) && node.words >= SHORT_WORDS

/**
 * The sections of a document long enough to get a line of their own, in the
 * order they come: at most `SECTIONS_MOST`, the longest kept. One that is
 * nearly the whole document is left to the document's own line.
 *
 * @param {ExploreNode} node
 * @returns {import('@/utils/sections.js').MarkdownSection[]}
 */
export function longSections(node) {
  if (!isRead(node) || node.words < SECTION_WORDS) return []
  const long = sectionsOfText(node.text).filter(
    section => section.words >= SECTION_WORDS && section.words < node.words * 0.9
  )
  if (long.length <= SECTIONS_MOST) return long
  const kept = new Set([...long].sort((a, b) => b.words - a.words).slice(0, SECTIONS_MOST))
  return long.filter(section => kept.has(section))
}

/**
 * The long sections of documents read whole, by the document's id, for a
 * request to ask a line of each.
 *
 * @param {ExploreNode[]} docs
 * @returns {Record<string, string[]>|undefined}
 */
function sectionsOf(docs) {
  const links = docs.flatMap(doc => {
    const long = longSections(doc).map(section => section.link)
    return long.length > 0 ? [[doc.id, long]] : []
  })
  return links.length > 0 ? Object.fromEntries(links) : undefined
}

/**
 * Which part of a document read in parts each long section's heading is in:
 * that part is asked for the section's line. Found by the heading's line,
 * in order.
 *
 * @param {ExploreNode} doc
 * @param {Array<{from: number, to: number}>} parts
 * @returns {Map<number, string[]>} The sections' links, by part
 */
function sectionsByPart(doc, parts) {
  const lines = linesOfText(doc.text)
  /** @type {Map<number, string[]>} */
  const byPart = new Map()
  let from = 0
  for (const section of longSections(doc)) {
    const end = doc.text.indexOf('\n', section.offset)
    const heading = doc.text.slice(section.offset, end < 0 ? undefined : end).trim()
    let at = from
    while (at < lines.length && lines[at].text.trim() !== heading) at++
    if (at >= lines.length) continue
    from = at + 1
    const part = parts.findIndex(one => one.from <= at && at < one.to)
    if (part >= 0) byPart.set(part, [...(byPart.get(part) || []), section.link])
  }
  return byPart
}

/**
 * Plan explore over a folder, the whole project from its root, or one
 * document: the steps, and what they cost. Nothing is planned for what is
 * current. A document is described however short it is, since it was asked
 * for; in a folder, one too short to need a line is read as it is.
 *
 * @param {ExploreNode} root
 * @param {number} budget - How much text a request carries
 * @returns {PlannedExplore}
 */
export function planExplore(root, budget) {
  /** @type {Map<string, string>} */
  const known = new Map()
  /** @type {JobStep[]} */
  const steps = []
  /** @type {Record<string, ExploreWork>} */
  const work = {}
  /** The step that answers for each document or folder. @type {Map<string, string>} */
  const answeredBy = new Map()
  /** @type {Map<string, ExploreNode>} */
  const nodes = new Map()
  let documents = 0
  let chars = 0

  /** @param {ExploreNode} node */
  const index = node => {
    nodes.set(node.id, node)
    node.children.forEach(index)
  }
  index(root)

  /** @param {ExploreNode} node */
  const below = node => {
    /** @type {ExploreNode[]} */
    const all = []
    const walk = (/** @type {ExploreNode} */ at) => {
      for (const child of at.children) {
        all.push(child)
        if (!child.leftOut) walk(child)
      }
    }
    walk(node)
    return all
  }

  /** @param {ExploreNode} node */
  const hasText = node => below(node).some(isRead)

  /** @param {ExploreNode} node */
  const current = node => node.digest?.of === basisOf(node, known)

  /** @param {ExploreNode[]} answered */
  const hashes = answered =>
    Object.fromEntries(answered.map(node => [node.id, basisOf(node, known)]))

  /**
   * @param {string} prefix
   * @param {string} label
   * @param {string[]} after
   * @param {ExploreWork} item
   * @param {number} sent
   */
  const add = (prefix, label, after, item, sent) => {
    const id = `${prefix}-${steps.length + 1}`
    steps.push({ id, label, status: 'pending', after: [...new Set(after)] })
    work[id] = item
    for (const answered of Object.keys(item.answers)) answeredBy.set(answered, id)
    chars += sent
    return id
  }

  /** @param {Piece} piece */
  const sizeOf = piece => {
    if ('text' in piece) return (nodes.get(piece.text)?.text.length || 0) + OVERHEAD
    if ('digest' in piece) {
      const node = nodes.get(piece.digest)
      const digest = node && current(node) ? node.digest : null
      return (digest ? digest.line.length + digest.text.length : DIGEST_CHARS) + OVERHEAD
    }
    if ('step' in piece) return DIGEST_CHARS + OVERHEAD
    return OVERHEAD
  }

  /** @param {Piece} piece */
  const waitsOn = piece =>
    'step' in piece ? piece.step : 'digest' in piece ? answeredBy.get(piece.digest) : undefined

  /**
   * Put a document or folder together from its pieces, in parts when they
   * will not all go in one request.
   *
   * @param {ExploreNode} node
   * @param {Piece[]} pieces
   * @param {string[]} [drop]
   * @param {string[]} [sectionsFrom] - For a document: the parts its sections' lines are in
   * @returns {string} The step that answers for it
   */
  const gather = (node, pieces, drop = [], sectionsFrom = []) => {
    /** @param {Piece[]} some */
    const waits = some => /** @type {string[]} */ (some.map(waitsOn).filter(Boolean))
    /** @param {Piece[]} some */
    const sizeOfAll = some => some.reduce((sum, piece) => sum + sizeOf(piece), 0)

    /** @type {Piece[][]} */
    const groups = [[]]
    let used = 0
    for (const piece of pieces) {
      const size = sizeOf(piece)
      if (groups[groups.length - 1].length > 0 && used + size > budget) {
        groups.push([])
        used = 0
      }
      groups[groups.length - 1].push(piece)
      used += size
    }
    // One request when it all fits, and when cutting it would leave as many
    // parts as there are pieces: a budget that small has to be gone over.
    if (groups.length === 1 || groups.length >= pieces.length) {
      return add(
        'gather',
        `${labelOf(node)} · put together`,
        waits(pieces),
        {
          kind: 'gather',
          of: node.id,
          pieces,
          answers: hashes([node]),
          ...(drop.length > 0 ? { drop } : {}),
          ...(sectionsFrom.length > 0 ? { sectionsFrom } : {}),
        },
        sizeOfAll(pieces)
      )
    }
    const partial = groups.map((group, at) =>
      add(
        'gather',
        `${labelOf(node)} · put together, part ${at + 1} of ${groups.length}`,
        waits(group),
        {
          kind: 'gather',
          of: node.id,
          pieces: group,
          part: at + 1,
          parts: groups.length,
          answers: {},
        },
        sizeOfAll(group)
      )
    )
    return gather(
      node,
      partial.map(step => ({ step })),
      drop,
      sectionsFrom
    )
  }

  /**
   * Read documents small enough to go together, several to a request.
   * @param {ExploreNode[]} docs
   */
  const pack = docs => {
    /** @type {ExploreNode[]} */
    let group = []
    let used = 0
    const close = () => {
      if (group.length === 0) return
      const label = group.length > 1 ? `${group[0].title} +${group.length - 1}` : group[0].title
      const sections = sectionsOf(group)
      add(
        'read',
        label,
        [],
        {
          kind: 'read',
          reads: group.map(doc => doc.id),
          answers: hashes(group),
          ...(sections ? { sections } : {}),
        },
        used
      )
      documents += group.length
      group = []
      used = 0
    }
    for (const doc of docs) {
      const size = doc.text.length + OVERHEAD
      if (group.length >= PACK_MOST || (group.length > 0 && used + size > budget)) close()
      group.push(doc)
      used += size
    }
    close()
  }

  /**
   * Read a document too long for one request in parts, then put it together.
   * @param {ExploreNode} doc
   */
  const inParts = doc => {
    const lines = linesOfText(doc.text)
    const parts = partsOf(doc.text, budget - OVERHEAD)
    const sections = sectionsByPart(doc, parts)
    const ids = parts.map((part, at) => {
      const pages = pagesOf(lines, part.from, part.to)
      const links = sections.get(at)
      return add(
        'part',
        `${doc.title} · ${pages || `part ${at + 1} of ${parts.length}`}`,
        [],
        {
          kind: 'part',
          of: doc.id,
          from: part.from,
          to: part.to,
          part: at + 1,
          parts: parts.length,
          answers: {},
          ...(links ? { sections: { [doc.id]: links } } : {}),
        },
        part.chars + OVERHEAD
      )
    })
    documents += 1
    gather(
      doc,
      ids.map(step => ({ step })),
      [],
      ids.filter((id, at) => sections.has(at))
    )
  }

  /**
   * Plan a folder and what is under it.
   * @param {ExploreNode} node
   * @returns {boolean} Whether it has a digest, or will
   */
  const plan = node => {
    if (!hasText(node)) return false
    const all = below(node)
    const whole = all.filter(isRead).reduce((sum, doc) => sum + doc.text.length + OVERHEAD, 0)
    const drop = all.filter(doc => doc.digest && isRead(doc) && !worthALine(doc)).map(doc => doc.id)

    if (whole <= budget) {
      // The documents, then the folders inside from the deepest out, then
      // this one: each described after what it holds.
      const folders = all.filter(
        child => fromWhatItHolds(child) && !child.leftOut && hasText(child)
      )
      const answered = [...all.filter(worthALine), ...folders.reverse(), node]
      if (answered.every(current) && drop.length === 0) return true
      const reads = all.filter(isRead)
      const sections = sectionsOf(reads)
      add(
        'read',
        `${labelOf(node)} · all of it`,
        [],
        {
          kind: 'read',
          reads: reads.map(doc => doc.id),
          whole: node.id,
          answers: hashes(answered),
          ...(drop.length > 0 ? { drop } : {}),
          ...(sections ? { sections } : {}),
        },
        whole
      )
      documents += reads.length
      return true
    }

    /** @type {Piece[]} */
    const pieces = []
    /** @type {ExploreNode[]} */
    const packed = []
    /** @type {string[]} */
    const shortWithDigests = []
    const before = steps.length
    /** @param {ExploreNode} child */
    const take = child => {
      if (child.leftOut) {
        pieces.push({ left: child.id })
        return
      }
      if (fromWhatItHolds(child)) {
        pieces.push(plan(child) ? { digest: child.id } : { left: child.id })
        return
      }
      if (!worthALine(child)) {
        pieces.push({ text: child.id })
        if (child.digest) shortWithDigests.push(child.id)
      } else {
        pieces.push({ digest: child.id })
        if (!current(child)) {
          if (child.text.length + OVERHEAD > budget) inParts(child)
          else packed.push(child)
        }
      }
      // What a document with text of its own holds goes beside it.
      child.children.forEach(take)
    }
    node.children.forEach(take)
    pack(packed)
    if (steps.length === before && current(node) && shortWithDigests.length === 0) return true
    gather(node, pieces, shortWithDigests)
    return true
  }

  /**
   * A document asked for, and what it holds, each described by itself.
   * @param {ExploreNode} node
   */
  const alone = node => {
    if (fromWhatItHolds(node)) {
      plan(node)
      return
    }
    if (isRead(node) && !current(node)) {
      if (node.text.length + OVERHEAD > budget) inParts(node)
      else pack([node])
    }
    node.children.forEach(alone)
  }
  alone(root)
  return { plan: { rootId: root.id, budget, work }, steps, documents, chars }
}

// ---------------------------------------------------------------------------
// The requests
// ---------------------------------------------------------------------------

/**
 * A path as a heading writes it: a folder's with a slash, the project's as `/`.
 * @param {ExploreNode} node
 */
export const headingPath = node =>
  node.type === 'folder' && node.path !== '/' ? `${node.path}/` : node.path

/** @param {number} n */
const counted = n => n.toLocaleString('en-US')

/**
 * How many documents are under a folder.
 * @param {ExploreNode} folder
 * @returns {number}
 */
function documentsUnder(folder) {
  let count = 0
  for (const child of folder.children) {
    if (child.type !== 'folder') count++
    if (!child.leftOut) count += documentsUnder(child)
  }
  return count
}

/**
 * A document's text, as a request sends it.
 * @param {ExploreNode} node
 */
const documentBlock = node =>
  `<document path="${headingPath(node)}" words="${counted(node.words)}">\n${node.text.trim()}\n</document>`

/**
 * A digest made already, as a request sends it.
 * @param {ExploreNode} node
 */
function descriptionBlock(node) {
  const size = fromWhatItHolds(node)
    ? `documents="${counted(documentsUnder(node))}"`
    : `words="${counted(node.words)}"`
  const said = node.digest
    ? `${node.digest.line}\n\n${node.digest.text}`
    : `(Not described. It begins:)\n${node.text.slice(0, DIGEST_CHARS).trim()}…`
  return `<description path="${headingPath(node)}" ${size}>\n${said.trim()}\n</description>`
}

/**
 * Why something is not read, as a request names it.
 * @param {ExploreNode} node
 */
const whyLeft = node =>
  `${headingPath(node)} (${node.leftOut || (fromWhatItHolds(node) ? 'nothing in it to read' : 'empty')})`

/** What joins a document's path to a section's title in a heading. */
const SECTION_MARK = ' § '

/**
 * The headings an answer is to be given under, as the request asks for them.
 * @param {string[]} headings
 */
const asking = headings => {
  const listed =
    headings.length === 1
      ? `Describe it under this heading:\n\n## ${headings[0]}`
      : `Describe each of these, under its own heading:\n\n${headings.map(heading => `## ${heading}`).join('\n')}`
  return headings.some(heading => heading.includes(SECTION_MARK))
    ? `${listed}\n\nThose with § are sections of a document: give each one line, and no paragraph.`
    : listed
}

/**
 * A section asked for a line: the document it is in, its link, and the
 * heading it is answered under. Its id is the document's and its link.
 *
 * @typedef {{id: string, path: string, of: string, link: string}} SectionAsk
 */

/**
 * The sections a step asks a line of, as the documents are now: one whose
 * link is gone since it was planned is not asked.
 *
 * @param {Record<string, string[]>|undefined} sections
 * @param {ExploreReader} read
 * @returns {SectionAsk[]}
 */
export function sectionsAskedFor(sections, read) {
  return Object.entries(sections || {}).flatMap(([id, links]) => {
    const node = read.node(id)
    if (!node) return []
    const titles = new Map(sectionsOfText(node.text).map(section => [section.link, section.title]))
    return links.flatMap(link => {
      const title = titles.get(link)
      return title
        ? [
            {
              id: `${id}#${link}`,
              path: `${headingPath(node)}${SECTION_MARK}${title}`,
              of: id,
              link,
            },
          ]
        : []
    })
  })
}

/**
 * What a step asks for: the headings its answer comes under, by the id each
 * is for. Documents and folders; the sections are `sectionsAskedFor`'s.
 *
 * @param {ExploreWork} work
 * @param {ExploreReader} read
 * @returns {Array<{id: string, path: string}>}
 */
export function askedFor(work, read) {
  return Object.keys(work.answers).flatMap(id => {
    const node = read.node(id)
    return node ? [{ id, path: headingPath(node) }] : []
  })
}

/**
 * The heading a part, or a gather in parts, is answered under.
 * @param {ExploreNode} node
 * @param {ExploreWork} work
 */
const partHeading = (node, work) => `${headingPath(node)}, part ${work.part} of ${work.parts}`

/**
 * The messages that ask for one step's descriptions, from the project as it
 * is now. Null when there is nothing left to send: what it was to read has
 * gone, or been hidden, since it was planned.
 *
 * @param {ExploreWork} work
 * @param {ExploreReader} read
 * @returns {Array<{role: string, content: string}>|null}
 */
export function exploreMessages(work, read) {
  const system = { role: 'system', content: explorePrompt.trim() }
  const sections = sectionsAskedFor(work.sections, read).map(one => one.path)
  const headings = [...askedFor(work, read).map(one => one.path), ...sections]

  if (work.kind === 'read') {
    const docs = (work.reads || []).map(read.node).filter(node => node !== null)
    if (docs.length === 0 || headings.length === 0) return null
    const folder = work.whole ? read.node(work.whole) : null
    const intro =
      folder?.path === '/'
        ? 'These are all the documents in the project. Describe the ones listed below, and the project as a whole.'
        : folder
          ? `These are the documents in ${headingPath(folder)}, all of them. Describe the ones listed below, and ${folder.type === 'folder' ? 'the folder' : headingPath(folder)} as a whole.`
          : docs.length > 1
            ? 'These are documents from the project.'
            : 'This is a document from the project.'
    const blocks = docs.map(documentBlock).join('\n\n')
    return [system, { role: 'user', content: `${intro}\n\n${blocks}\n\n${asking(headings)}` }]
  }

  const node = work.of ? read.node(work.of) : null
  if (!node) return null

  if (work.kind === 'part') {
    const lines = linesOfText(node.text)
    const text = partText(lines, work.from || 0, work.to || 0)
    if (!text) return null
    const pages = pagesOf(lines, work.from || 0, work.to || 0)
    const intro = `This is part ${work.part} of ${work.parts} of ${headingPath(node)}${pages ? `, ${pages}` : ''}: the document is too long to read at once, and what you write of each part is put together afterwards. Describe this part.`
    const block = `<document path="${headingPath(node)}" part="${work.part} of ${work.parts}">\n${text}\n</document>`
    return [
      system,
      {
        role: 'user',
        content: `${intro}\n\n${block}\n\n${asking([partHeading(node, work), ...sections])}`,
      },
    ]
  }

  // A gather: of a document's parts, or of what a folder holds.
  /** @type {string[]} */
  const blocks = []
  /** @type {string[]} */
  const left = []
  let partNumber = 0
  for (const piece of work.pieces || []) {
    if ('step' in piece) {
      partNumber++
      const said = read.output(piece.step).trim()
      if (said) blocks.push(`<part n="${partNumber}">\n${said}\n</part>`)
      continue
    }
    const id = 'digest' in piece ? piece.digest : 'text' in piece ? piece.text : piece.left
    const child = read.node(id)
    if (!child) continue
    if ('left' in piece) left.push(whyLeft(child))
    else if ('text' in piece)
      blocks.push(
        child.text.trim()
          ? documentBlock(child)
          : `<document path="${headingPath(child)}" words="0"></document>`
      )
    else blocks.push(descriptionBlock(child))
  }
  if (blocks.length === 0) return null

  const fromParts = (work.pieces || []).every(piece => 'step' in piece)
  const whose = headingPath(node)
  // The project by name rather than by its slash, or the model writes of a
  // root directory.
  const project = node.path === '/'
  const it = project ? 'The project' : whose
  const what = project ? 'the project' : node.type === 'folder' ? 'the folder' : whose
  let intro
  if (!fromWhatItHolds(node) && work.part) {
    intro = `${whose} was too long to read at once, and was read in parts, too many to put together at once. Here is what was written of ${partNumber} of them, in order, which is part ${work.part} of ${work.parts} of the document. Describe this part of it.`
  } else if (!fromWhatItHolds(node)) {
    intro = `${whose} was too long to read at once, and was read in ${partNumber} parts. Here is what was written of each. Describe the document as a whole.`
  } else if (fromParts) {
    intro = `${it} holds too much to describe at once, and was described in ${partNumber} parts. Here is what was written of each. Describe ${what} as a whole.`
  } else if (work.part) {
    intro = `This is part ${work.part} of ${work.parts} of what ${project ? 'the project' : whose} holds: descriptions of its documents and folders, and its short documents as they are. What you write is put together with the rest afterwards. Describe this part of ${what}.`
  } else {
    intro = `${it} holds too much to read at once. Here are descriptions of its documents and folders, and its short documents as they are. Describe ${what}.`
  }
  const notRead = left.length > 0 ? `\n\nNot read: ${left.join(', ')}.` : ''
  const heading = work.part ? partHeading(node, work) : whose
  return [
    system,
    {
      role: 'user',
      content: `${intro}\n\n${blocks.join('\n\n')}${notRead}\n\n${asking([heading])}`,
    },
  ]
}

// ---------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------

/**
 * An answer without what a model may wrap it in: its thinking, written into
 * the text, and a code fence around the whole.
 *
 * @param {string} answer
 * @returns {string}
 */
export function cleanAnswer(answer) {
  const text = (answer || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text)
  return fenced ? fenced[1].trim() : text
}

/**
 * A heading as it is matched to a path: its marks, quotes, slashes and case
 * taken away.
 *
 * @param {string} text
 * @returns {string}
 */
export function headingKey(text) {
  return text
    .replace(/[*_`"“”]/g, '')
    .replace(/,\s*part \d+ of \d+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

/**
 * What a line is a heading for, when it is one: `## Notes/Elara`, or a path
 * on its own in bold.
 *
 * @param {string} line
 * @returns {string|null}
 */
function headingText(line) {
  const marked = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
  if (marked) return marked[1]
  const bold = /^\s*\*\*(.+?)\*\*\s*:?\s*$/.exec(line)
  return bold ? bold[1] : null
}

/** The longest a line is kept, in characters; a longer one is cut at a word. */
const LINE_MOST = 300

/**
 * A line and a paragraph out of what was written under one heading. A model
 * that wrote a single paragraph has its first sentence for the line.
 *
 * @param {string} body
 * @returns {{line: string, text: string}|null}
 */
export function digestOf(body) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map(paragraph =>
      paragraph
        .replace(
          /^\s*(?:[-*]\s+)?(?:\*\*)?(?:line|paragraph|description)(?:\*\*)?\s*:\s*(?:\*\*)?/i,
          ''
        )
        .trim()
    )
    .filter(Boolean)
  if (paragraphs.length === 0) return null
  let line
  let text
  if (paragraphs.length > 1) {
    line = paragraphs[0]
    text = paragraphs.slice(1).join('\n\n')
  } else {
    const [first, ...rest] = paragraphs[0].split('\n')
    if (rest.length > 0) {
      line = first
      text = rest.join('\n').trim()
    } else {
      const sentence = /^(.+?[.!?])(\s|$)/.exec(first)
      line = sentence ? sentence[1] : first
      text = first
    }
  }
  line = line
    .replace(/\s+/g, ' ')
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .trim()
  if (line.length > LINE_MOST) {
    const cut = line.slice(0, LINE_MOST)
    line = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), LINE_MOST / 2))}…`
  }
  return { line, text: text.trim() }
}

/**
 * The descriptions in an answer, by the id of what each is of. A heading
 * that is a path asked for, or the last part of only one of them, starts
 * that one's; one asked alone is the whole answer when it has no heading.
 * What was not answered is not there.
 *
 * A section's heading is also found by its title alone.
 *
 * @param {string} answer
 * @param {Array<{id: string, path: string}>} asked
 * @param {{alone?: boolean}} [options] - `alone: false` when the answer is
 *   about something else too, as a part's is, so that a lone one asked takes
 *   only what is under its own heading
 * @returns {Map<string, {line: string, text: string}>}
 */
export function parseDigests(answer, asked, { alone = true } = {}) {
  const byKey = new Map(asked.map(one => [headingKey(one.path), one.id]))
  /** @type {Map<string, string[]>} */
  const byLast = new Map()
  for (const one of asked) {
    const key = headingKey(one.path)
    const mark = key.lastIndexOf(SECTION_MARK.trim())
    const last = mark >= 0 ? key.slice(mark + 1).trim() : key.split('/').pop() || ''
    byLast.set(last, [...(byLast.get(last) || []), one.id])
  }
  /** @param {string} heading */
  const match = heading => {
    const key = headingKey(heading)
    const exact = byKey.get(key)
    if (exact !== undefined) return exact
    const mark = key.lastIndexOf(SECTION_MARK.trim())
    const last = byLast.get(mark >= 0 ? key.slice(mark + 1).trim() : key.split('/').pop() || '')
    return last?.length === 1 ? last[0] : null
  }

  /** @type {Map<string, string[]>} */
  const bodies = new Map()
  /** @type {string[]} */
  const loose = []
  /** @type {string|null} */
  let at = null
  for (const line of cleanAnswer(answer).split('\n')) {
    const heading = headingText(line)
    const id = heading === null ? null : match(heading)
    if (id !== null) {
      at = id
      if (!bodies.has(id)) bodies.set(id, [])
      continue
    }
    if (at === null) loose.push(line)
    else bodies.get(at)?.push(line)
  }
  if (alone && bodies.size === 0 && asked.length === 1) {
    bodies.set(
      asked[0].id,
      loose.filter(line => headingText(line) === null)
    )
  }

  /** @type {Map<string, {line: string, text: string}>} */
  const found = new Map()
  for (const [id, lines] of bodies) {
    const digest = digestOf(lines.join('\n'))
    if (digest) found.set(id, digest)
  }
  return found
}

/**
 * What a part, or a gather in parts, answered: its text without its heading,
 * for what is put together from it.
 *
 * @param {string} answer
 * @param {string} path - What it is part of, as its heading names it
 * @returns {string}
 */
export function partAnswer(answer, path) {
  const key = headingKey(path)
  return cleanAnswer(answer)
    .split('\n')
    .filter(line => {
      const heading = headingText(line)
      return heading === null || headingKey(heading) !== key
    })
    .join('\n')
    .trim()
}
