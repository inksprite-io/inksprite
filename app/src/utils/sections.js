/**
 * @module utils/sections
 * @description A Markdown document's sections: its headings, each with the
 * link that names it, where it runs, and how long it is.
 *
 * A link is made from a heading the way Markdown viewers make one — lower
 * case, spaces as hyphens, punctuation dropped, a repeat numbered `-1`,
 * `-2` — so an index written with them works outside the app too, and the
 * model reads a section by the same name the index gives it.
 */

/** A Markdown heading line. */
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/

/** A fence opening or closing a code block. */
const FENCE = /^[ \t]{0,3}(```|~~~)/

/**
 * One section of a Markdown text.
 *
 * @typedef {Object} MarkdownSection
 * @property {string} title - The heading's text, emphasis marks aside
 * @property {number} level - 1 for `#`
 * @property {string} link - Unique within the text
 * @property {number} offset - Where the heading line starts
 * @property {number} end - Where the next heading of any level starts: the section's own text ends
 * @property {number} until - Where the next heading at its level or above starts: the section and its subsections end
 * @property {number} words - In the section and its subsections
 */

/**
 * A node of the section tree, as the model is shown it.
 *
 * @typedef {Object} SectionNode
 * @property {string} link
 * @property {string} title
 * @property {number} words
 * @property {SectionNode[]} [sections]
 * @property {number} [entries] - How many subsections a long run has, not listed here
 * @property {string} [range] - The first and last of that run
 * @property {number} [more] - Subsections left out of this tree for its size
 */

/**
 * The link a heading's title makes, before it is made unique.
 * @param {string} title
 * @returns {string}
 */
export function slugOf(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/**
 * A maker of unique links for one text: the first `intro`, then `intro-1`.
 * @returns {(title: string) => string}
 */
export function linker() {
  /** @type {Map<string, number>} */
  const seen = new Map()
  return title => {
    const base = slugOf(title) || 'section'
    let link = base
    if (seen.has(base)) {
      let count = seen.get(base) || 0
      do {
        count++
        link = `${base}-${count}`
      } while (seen.has(link))
      seen.set(base, count)
    }
    seen.set(link, 0)
    return link
  }
}

/**
 * A heading's text without the marks that dress it: `**Rules**` is Rules.
 * @param {string} text
 */
const plainTitle = text =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .trim()

/**
 * How many words a stretch of text has.
 * @param {string} text
 */
const wordsOf = text => text.split(/\s+/).filter(Boolean).length

/**
 * The sections of a Markdown text, in order. A `#` line inside a code
 * block is code, not a heading.
 *
 * @param {string} markdown
 * @returns {MarkdownSection[]}
 */
export function markdownSections(markdown) {
  const link = linker()
  /** @type {Array<{title: string, level: number, link: string, offset: number}>} */
  const found = []
  let offset = 0
  let fence = null
  for (const line of markdown.split('\n')) {
    const opens = line.match(FENCE)
    if (opens) {
      if (fence === null) fence = opens[1]
      else if (opens[1] === fence) fence = null
    } else if (fence === null) {
      const heading = line.match(HEADING)
      if (heading) {
        const title = plainTitle(heading[2])
        found.push({ title, level: heading[1].length, link: link(title), offset })
      }
    }
    offset += line.length + 1
  }

  const length = markdown.length
  return found.map((section, at) => {
    const end = at + 1 < found.length ? found[at + 1].offset : length
    const next = found.slice(at + 1).find(other => other.level <= section.level)
    const until = next ? next.offset : length
    return { ...section, end, until, words: wordsOf(markdown.slice(section.offset, until)) }
  })
}

/** How many nodes the tree shows at most; a long map is its own cost. */
export const TREE_LIMIT = 300

/** How many subsections a node lists before it says how many instead. */
export const LIST_LIMIT = 30

/**
 * The sections as a tree, cut to size. A node with a long run of
 * subsections — every spell, every monster — gives how many there are and
 * the first and last of them instead of listing them, since that is a
 * list to look into, not a map to read; then, if the tree is still too big,
 * whole levels are kept from the top down while they fit, and a node whose
 * subsections were left out says how many there are.
 *
 * The top level is listed whole however long it is: for the subsections of
 * one section, asked for by name, that list is the answer.
 *
 * @param {MarkdownSection[]} sections
 * @param {number} [limit]
 * @param {number} [list] - How many subsections a node lists before it counts them instead
 * @returns {SectionNode[]}
 */
export function sectionTree(sections, limit = TREE_LIMIT, list = LIST_LIMIT) {
  /** @type {Array<{node: SectionNode, level: number, depth: number}>} */
  const stack = []
  /** @type {SectionNode[]} */
  const roots = []
  for (const section of sections) {
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) stack.pop()
    /** @type {SectionNode} */
    const node = { link: section.link, title: section.title, words: section.words }
    const parent = stack[stack.length - 1]
    if (parent) {
      parent.node.sections = parent.node.sections || []
      parent.node.sections.push(node)
    } else {
      roots.push(node)
    }
    stack.push({ node, level: section.level, depth: stack.length })
  }

  /** @param {SectionNode} node */
  const collapse = node => {
    const children = node.sections
    if (!children) return
    if (children.length > list) {
      delete node.sections
      node.entries = children.length
      node.range = `${children[0].title} … ${children[children.length - 1].title}`
      return
    }
    children.forEach(collapse)
  }
  roots.forEach(collapse)

  /** @type {Array<{depth: number}>} */
  const all = []
  const measure = (/** @type {SectionNode[]} */ nodes, /** @type {number} */ depth) => {
    for (const node of nodes) {
      all.push({ depth })
      measure(node.sections || [], depth + 1)
    }
  }
  measure(roots, 0)
  if (all.length <= limit) return roots

  // The deepest level that still fits, counting every node down to it.
  let depth = 0
  while (all.filter(entry => entry.depth <= depth + 1).length <= limit) depth++
  /**
   * @param {SectionNode} node
   * @param {number} at
   */
  const cut = (node, at) => {
    if (!node.sections) return
    if (at >= depth) {
      node.more = countOf(node.sections)
      delete node.sections
      return
    }
    node.sections.forEach(child => cut(child, at + 1))
  }
  roots.forEach(root => cut(root, 0))
  return roots
}

/**
 * How many nodes a list of subtrees holds.
 * @param {SectionNode[]} nodes
 * @returns {number}
 */
function countOf(nodes) {
  return nodes.reduce((sum, node) => sum + 1 + countOf(node.sections || []), 0)
}

/**
 * The section a reference names: its link, or else its title, case aside;
 * failing both, the first whose title contains the reference.
 *
 * @param {MarkdownSection[]} sections
 * @param {string} reference
 * @returns {MarkdownSection|null}
 */
export function findSection(sections, reference) {
  const wanted = reference.trim().replace(/^#/, '')
  if (!wanted) return null
  // Named by where it sits, the way a search hit says it: `Part / Chapter / Section`.
  if (wanted.includes(' / ')) {
    const parts = wanted.split(' / ').map(part => part.trim())
    const last = parts[parts.length - 1].toLowerCase()
    const index = sections.findIndex(
      (section, at) =>
        section.title.toLowerCase() === last &&
        sectionPath(sections, at).toLowerCase() === parts.join(' / ').toLowerCase()
    )
    if (index >= 0) return sections[index]
    return findSection(sections, parts[parts.length - 1])
  }
  const lower = wanted.toLowerCase()
  return (
    sections.find(section => section.link === wanted) ||
    sections.find(section => section.link === slugOf(wanted)) ||
    sections.find(section => section.title.toLowerCase() === lower) ||
    sections.find(section => section.title.toLowerCase().includes(lower)) ||
    null
  )
}

/**
 * An index of a text's sections as a Markdown list of links, down to a
 * depth below the text's top level.
 *
 * @param {MarkdownSection[]} sections
 * @param {number} [depth] - How many levels, counting the top
 * @returns {string} '' for a text with no headings
 */
export function indexOf(sections, depth = 3) {
  if (sections.length === 0) return ''
  const top = Math.min(...sections.map(section => section.level))
  // A section with a long run of subsections gets how many, not a line each:
  // an index of every spell is the spell list again.
  const children = sections.map(() => 0)
  /** @type {number[]} */
  const open = []
  sections.forEach((section, at) => {
    while (open.length > 0 && sections[open[open.length - 1]].level >= section.level) open.pop()
    if (open.length > 0) children[open[open.length - 1]]++
    open.push(at)
  })
  /** @type {string[]} */
  const lines = []
  let skipUntil = -1
  sections.forEach((section, at) => {
    if (section.offset < skipUntil || section.level >= top + depth) return
    const long = children[at] > LIST_LIMIT
    const entry = `- [${section.title.replace(/[[\]]/g, '\\$&')}](#${section.link})`
    lines.push(
      `${'  '.repeat(section.level - top)}${entry}${long ? ` (${children[at]} entries)` : ''}`
    )
    if (long) skipUntil = section.until
  })
  return lines.join('\n')
}

/**
 * The section an offset falls in: the last heading at or before it.
 *
 * @param {MarkdownSection[]} sections
 * @param {number} offset
 * @returns {number} Its index, or -1 before the first heading
 */
export function sectionIndexAt(sections, offset) {
  let found = -1
  for (let at = 0; at < sections.length && sections[at].offset <= offset; at++) found = at
  return found
}

/**
 * The titles from the top down to a section: where it sits, as a reader
 * would say it — `Spells / Spell Descriptions / Fire Burst`.
 *
 * @param {MarkdownSection[]} sections
 * @param {number} index
 * @returns {string}
 */
export function sectionPath(sections, index) {
  const titles = []
  let level = Infinity
  for (let at = index; at >= 0; at--) {
    if (sections[at].level < level) {
      titles.unshift(sections[at].title)
      level = sections[at].level
    }
  }
  return titles.join(' / ')
}
