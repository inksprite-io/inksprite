/**
 * @module tts/reading
 * @description What a reading asks the speech server for, and what it has.
 *
 * Each block is one utterance: its words after the hints, in its speaker's
 * voice. An utterance is known by its signature — the voice as the server is
 * asked for it, the speed, and the words — and audio is kept by signature.
 * So whatever changes what would be said — an edit, a new speaker, a voice
 * remixed, a hint — leaves that block without audio and every other with the
 * audio it had. Putting the words back brings it back.
 */

import { applyHints } from './hints.js'
import { voiceFor } from './voices.js'

/** @typedef {import('@/types/models.js').TtsVoice} TtsVoice */
/** @typedef {import('./script.js').Block} Block */
/** @typedef {import('./hints.js').Hint} Hint */

/**
 * One request to the speech server: a block, in a voice.
 *
 * @typedef {Object} Utterance
 * @property {number} index - The block it is
 * @property {string} text - What is sent, hints applied
 * @property {TtsVoice} voice
 * @property {string} signature - What the audio for it is kept under
 */

/**
 * Where each block of a document stands in a reading.
 *
 * @typedef {'ready'|'missing'|'running'|'failed'} BlockState
 */

/** The pause between blocks in a track, in seconds. */
export const BLOCK_GAP = 0.4

/**
 * @param {TtsVoice} voice
 * @param {string} text - As sent
 * @returns {string}
 */
export function signatureOf(voice, text) {
  return `${voice.voice}\n${voice.speed ?? 1}\n${text}`
}

/**
 * What the server is asked to say, in order: one utterance to a block.
 *
 * @param {Block[]} blocks
 * @param {(string|null)[]} speakers - A voice id per block, as resolved
 * @param {TtsVoice[]} voices
 * @param {string} defaultId - The voice for blocks with no speaker
 * @param {Hint[]} hints
 * @returns {Utterance[]}
 */
export function utterancesOf(blocks, speakers, voices, defaultId, hints) {
  return blocks.map((block, index) => {
    const voice = voiceFor(voices, speakers[index], defaultId)
    const text = applyHints(block.text, hints)
    return { index, text, voice, signature: signatureOf(voice, text) }
  })
}

/**
 * What a run should ask for. Asked for some blocks, it reads those, again if
 * they have been read. Asked for the document, it reads what has no audio,
 * and when nothing lacks any, all of it again.
 *
 * @param {Utterance[]} utterances
 * @param {(signature: string) => boolean} has - Whether there is audio for a signature
 * @param {number[]} [blocks] - The blocks asked for; none means the document
 * @returns {Utterance[]}
 */
export function targetsOf(utterances, has, blocks) {
  if (blocks?.length) return utterances.filter(utterance => blocks.includes(utterance.index))
  const missing = utterances.filter(utterance => !has(utterance.signature))
  return missing.length > 0 ? missing : utterances
}

/**
 * Names a track by what is in it and where: the utterances it was joined
 * from, each with the block it is. A track is in step with a document while
 * this is what the document would join.
 *
 * @param {Utterance[]} included
 * @returns {string}
 */
export function trackKeyOf(included) {
  return included.map(utterance => `${utterance.index}:${utterance.signature}`).join('\u0000')
}

/**
 * Where each block stands: read, not read, being read now, or where the
 * last run failed.
 *
 * @param {Utterance[]} utterances - One to a block, in order
 * @param {{clips: {has: (signature: string) => boolean}, current: string|null, failed: string|null}|null} reading
 * @returns {BlockState[]}
 */
export function blockStatesOf(utterances, reading) {
  return utterances.map(({ signature }) => {
    if (!reading) return 'missing'
    if (reading.current === signature) return 'running'
    if (reading.failed === signature) return 'failed'
    return reading.clips.has(signature) ? 'ready' : 'missing'
  })
}
