/**
 * @module editor/projectSearch
 * @description Find across a project: every document that has what the
 * writer looks for, with the line each match is on, found as the document's
 * own find would find it.
 *
 * A document laid out is found in as the editor finds (`search`): in the
 * text its markdown makes, block by block, so "the long road" finds "the
 * **long** road", and nothing is found in a link's address or a comment's
 * id. A plain document, and a file's text, are found in as their field finds
 * (`plainSearch`): in the text as it is. Either way the matches are counted
 * in the order that find comes to them, so the third here is the third
 * there, and going to it is asking the document's view for its third match.
 *
 * Making the text of a laid-out document means reading its markdown, which
 * is the cost of a search. So a document is read only when its markdown has
 * every word of the query in it, which is a document that might match; and
 * what was read is kept, by document, for as long as its markdown is the
 * same, so the next letter typed reads nothing again. A document open in the
 * editor is found in as it stands there.
 */

import { parseMarkdown } from './markdown.js'
import { NOT_TEXT, patternFor, textblocksOf } from './search.js'

/**
 * @typedef {import('./search.js').SearchOptions} SearchOptions
 * @typedef {import('prosemirror-model').Node} Node
 *
 * A document as a search reads it.
 * @typedef {Object} Searchable
 * @property {string} id
 * @property {string} title - As the outline shows it
 * @property {string} content - Its markdown, or its text, as it stands
 * @property {boolean} laidOut - Whether its view lays it out, and is found
 *   in as the editor finds, rather than in its text as it is
 * @property {Node|null} [doc] - The editor's own, while it is open there
 *
 * One match, with what is around it on its line: for a laid-out document
 * its paragraph, heading or cell; for a plain one its line.
 * @typedef {Object} FoundLine
 * @property {number} index - Which of the document's matches it is, from 0
 * @property {string} before - Its line up to it, cut to the last few words
 * @property {string} match
 * @property {string} after - Its line after it
 * @property {number} [at] - Where it is in the text, in a document found in
 *   as it is
 *
 * A document that has what was looked for.
 * @typedef {Object} FoundDocument
 * @property {string} id
 * @property {boolean} inTitle
 * @property {number} count - How many matches its text has
 * @property {FoundLine[]} lines - Them, while the search has room for them
 *
 * @typedef {Object} ProjectFound
 * @property {FoundDocument[]} documents - In the order they were given
 * @property {number} count - Every match, in every document
 * @property {boolean} cut - Whether there were more lines than are listed
 */

/** How many lines a search lists, in all; the counts go on past them. */
export const LINE_LIMIT = 1000

/** How much of a line comes before a match, at most: a few words, so the match is in sight in a narrow sidebar. */
const BEFORE = 24

/** How much of it comes after, at most; the list cuts it to the panel's width. */
const AFTER = 160

/** A query's letters and digits: what the markdown must have for it to match. */
const RUN = /[\p{L}\p{N}]+/gu

/** A laid-out document's blocks, by document, while its markdown is the same. */
const read = new Map()

/** The editor's blocks for a state it holds, while it holds it. @type {WeakMap<Node, string[]>} */
const readOpen = new WeakMap()

/** A document's markdown in lower case, while it is the same. */
const lowered = new Map()

/**
 * @param {string} id
 * @param {string} content
 * @returns {string}
 */
const lowerOf = (id, content) => {
  const kept = lowered.get(id)
  if (kept?.content === content) return kept.lower
  const lower = content.toLowerCase()
  lowered.set(id, { content, lower })
  return lower
}

/**
 * The text a laid-out document's find looks in, one entry per block.
 *
 * @param {Searchable} document
 * @returns {string[]}
 */
function blocksOf(document) {
  if (document.doc) {
    let blocks = readOpen.get(document.doc)
    if (!blocks) {
      blocks = textblocksOf(document.doc).map(block => block.text)
      readOpen.set(document.doc, blocks)
    }
    return blocks
  }
  const kept = read.get(document.id)
  if (kept?.content === document.content) return kept.blocks
  const blocks = textblocksOf(parseMarkdown(document.content)).map(block => block.text)
  read.set(document.id, { content: document.content, blocks })
  return blocks
}

/**
 * A match on its line, the line cut around it, and what is not text in a
 * block shown as a space.
 *
 * @param {string} line
 * @param {number} start
 * @param {number} end
 * @param {number} index
 * @returns {FoundLine}
 */
function lineOf(line, start, end, index) {
  const shown = (/** @type {string} */ text) => text.replaceAll(NOT_TEXT, ' ').replace(/\s+/g, ' ')
  let before = shown(line.slice(0, start)).trimStart()
  if (before.length > BEFORE) {
    const cut = before.slice(-BEFORE)
    const word = cut.indexOf(' ')
    before = `…${word > 0 && word < cut.length - 1 ? cut.slice(word + 1) : cut}`
  }
  let after = shown(line.slice(end, end + AFTER + 1)).trimEnd()
  if (after.length > AFTER) after = `${after.slice(0, AFTER)}…`
  return { index, before, match: shown(line.slice(start, end)), after }
}

/**
 * Every document that has the query in its title or its text, in the order
 * given, each with its matches' lines until the search has listed
 * `LINE_LIMIT` of them in all. An empty query finds nothing.
 *
 * @param {Searchable[]} documents
 * @param {string} query
 * @param {SearchOptions} [options]
 * @returns {ProjectFound}
 */
export function searchProject(documents, query, options = {}) {
  /** @type {ProjectFound} */
  const found = { documents: [], count: 0, cut: false }
  if (!query) return found
  const pattern = patternFor(query, options)
  const words = (query.toLowerCase().match(RUN) ?? []).filter(Boolean)
  let listed = 0

  for (const document of documents) {
    const inTitle = document.title.search(pattern) !== -1
    const content = document.content || ''
    // One open in the editor may have the words its stored markdown lacks.
    const possible =
      document.doc || (content && words.every(word => lowerOf(document.id, content).includes(word)))
    /** @type {FoundLine[]} */
    const lines = []
    let count = 0

    if (possible) {
      const room = () => listed + lines.length < LINE_LIMIT
      if (document.laidOut) {
        for (const block of blocksOf(document)) {
          for (const hit of block.matchAll(pattern)) {
            const start = hit.index ?? 0
            if (room()) lines.push(lineOf(block, start, start + hit[0].length, count))
            count++
          }
        }
      } else {
        for (const hit of content.matchAll(pattern)) {
          const at = hit.index ?? 0
          if (room()) {
            const from = content.lastIndexOf('\n', at - 1) + 1
            const to = content.indexOf('\n', at)
            const line = content.slice(from, to === -1 ? content.length : to)
            lines.push({ ...lineOf(line, at - from, at - from + hit[0].length, count), at })
          }
          count++
        }
      }
    }

    if (!inTitle && count === 0) continue
    if (lines.length < count) found.cut = true
    listed += lines.length
    found.count += count
    found.documents.push({ id: document.id, inTitle, count, lines })
  }

  // What was read of documents no longer in the project goes with them.
  const ids = new Set(documents.map(document => document.id))
  for (const kept of [read, lowered]) {
    for (const id of kept.keys()) if (!ids.has(id)) kept.delete(id)
  }
  return found
}
