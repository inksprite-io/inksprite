/**
 * @module tts/script
 * @description A document as something to be read aloud: its blocks, and
 * who speaks each.
 *
 * A block is a paragraph: any node that holds text, with the markdown taken
 * off. It is the smallest thing that can have a speaker of its own, and one
 * request to the speech server. Speech is not stood apart from the narration
 * around it within a paragraph. That was tried, so that a character could
 * have the line and the narrator the tag, and it reads badly: a sentence cut
 * at its quotation marks is said as two or three, each ending where it was
 * cut, with a pause in the middle of it. A character's line is given a voice
 * by giving them the paragraph.
 *
 * The document is the writer's, and nothing here is written into it. The
 * speakers are an overlay. Each assignment remembers the block it was made
 * on — its text, and where it was — and is found again by the text, at the
 * nearest place to where it was, when the document has changed since. A
 * block that has moved keeps its speaker; two that read the same keep theirs
 * apart; one that has been rewritten finds nothing, and reads in the default
 * voice again. Nobody can say who speaks a line that no longer exists.
 */

import { parseMarkdown } from '@/editor/markdown.js'

/** @typedef {import('@/types/models.js').SpeakerAssignment} SpeakerAssignment */

/**
 * One paragraph, as it is spoken.
 *
 * @typedef {Object} Block
 * @property {string} text - Its words
 * @property {number} from - Where they start in the document, as the editor counts
 * @property {number} to - Where they end
 */

/**
 * One node's text as it should be spoken: its words with the marks taken
 * off, and a line break where the writer ended a line. One character to a
 * document position, so an offset into it is an offset into the node.
 *
 * @param {import('prosemirror-model').Node} node
 * @returns {string}
 */
function spoken(node) {
  let text = ''
  node.forEach(child => {
    if (child.isText) text += child.text
    else text += child.type.name === 'hard_break' ? '\n' : ' '.repeat(child.nodeSize)
  })
  return text
}

/**
 * A document's blocks, in reading order, as they are to be spoken.
 *
 * Every node that holds text is one — a paragraph proper, a heading, a list
 * item, a quoted line — with the markdown taken off. Code is not read aloud,
 * and a rule has nothing to say. Nothing empty is kept.
 *
 * @param {import('prosemirror-model').Node} doc
 * @returns {Block[]}
 */
export function blocksOfDoc(doc) {
  /** @type {Block[]} */
  const blocks = []

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'code_block') return false

    const whole = spoken(node)
    const text = whole.trim()
    if (text) {
      // The node's content starts one position in, and its words after
      // whatever space leads them.
      const from = pos + 1 + whole.indexOf(text)
      blocks.push({ text, from, to: from + text.length })
    }
    return false
  })

  return blocks
}

/**
 * @param {string|null|undefined} markdown
 * @returns {Block[]}
 */
export function blocksOf(markdown) {
  return blocksOfDoc(parseMarkdown(markdown))
}

/**
 * A block as an assignment remembers it: its words, one space apart.
 *
 * @param {string} text
 * @returns {string}
 */
export function keyOf(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Who speaks each block, given assignments made on some version of the
 * document. Each assignment claims the unclaimed block with its text nearest
 * to where it was, in the order the assignments were made.
 *
 * @param {string[]} texts - The blocks' texts
 * @param {SpeakerAssignment[]|null|undefined} assignments
 * @returns {(string|null)[]} A voice id per block; null is the default voice's
 */
export function resolveSpeakers(texts, assignments) {
  /** @type {(string|null)[]} */
  const speakers = texts.map(() => null)
  if (!assignments?.length) return speakers

  /** @type {Map<string, number[]>} */
  const positions = new Map()
  texts.forEach((text, index) => {
    const key = keyOf(text)
    const list = positions.get(key)
    if (list) list.push(index)
    else positions.set(key, [index])
  })

  const claimed = new Set()
  for (const assignment of assignments) {
    const candidates = (positions.get(keyOf(assignment.text)) || []).filter(i => !claimed.has(i))
    if (candidates.length === 0) continue
    const nearest = candidates.reduce((best, i) =>
      Math.abs(i - assignment.index) < Math.abs(best - assignment.index) ? i : best
    )
    claimed.add(nearest)
    speakers[nearest] = assignment.voiceId
  }
  return speakers
}

/**
 * The assignments to keep after some blocks are given a speaker, or given
 * back to the default voice. Written from the blocks as they stand, so an
 * assignment whose block is gone goes with it rather than piling up.
 *
 * @param {string[]} texts - The blocks' texts
 * @param {(string|null)[]} speakers - As resolved for these blocks
 * @param {number[]} indices - The blocks changing hands
 * @param {string|null} voiceId - Their speaker, or null for the default voice
 * @returns {SpeakerAssignment[]}
 */
export function assignSpeaker(texts, speakers, indices, voiceId) {
  const given = new Set(indices)
  /** @type {SpeakerAssignment[]} */
  const kept = []
  texts.forEach((text, i) => {
    const voice = given.has(i) ? voiceId : speakers[i]
    if (voice) kept.push({ text: keyOf(text), index: i, voiceId: voice })
  })
  return kept
}
