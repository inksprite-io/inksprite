/**
 * @module tts/highlight
 * @description Where in a document each speaker's lines are, for the editor
 * to colour. The same reading of the document the narration makes — blocks,
 * and the speakers overlay resolved against them — kept to the blocks
 * somebody has been given, in a voice that has a colour.
 */

import { blocksOfDoc, resolveSpeakers } from './script.js'

/** @typedef {import('@/types/models.js').TtsVoice} TtsVoice */
/** @typedef {import('@/types/models.js').SpeakerAssignment} SpeakerAssignment */

/**
 * @typedef {Object} SpeakerRange
 * @property {number} from - Document position
 * @property {number} to
 * @property {string} color - The voice's colour
 * @property {string} name - The voice's name
 */

/** How strongly a voice's colour shows behind text: the alpha, as hex. */
export const TINT = '38'

/**
 * @param {import('prosemirror-model').Node} doc
 * @param {SpeakerAssignment[]|null|undefined} assignments
 * @param {TtsVoice[]} voices
 * @returns {SpeakerRange[]}
 */
export function speakerRanges(doc, assignments, voices) {
  if (!assignments?.length) return []
  const blocks = blocksOfDoc(doc)
  const speakers = resolveSpeakers(
    blocks.map(block => block.text),
    assignments
  )

  /** @type {SpeakerRange[]} */
  const ranges = []
  blocks.forEach((block, index) => {
    const voice = voices.find(candidate => candidate.id === speakers[index])
    if (voice?.color) {
      ranges.push({ from: block.from, to: block.to, color: voice.color, name: voice.name })
    }
  })
  return ranges
}
