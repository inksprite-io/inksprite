/* global crypto, TextEncoder */
/**
 * @module tts/reading
 * @description What a reading asks the speech server for, and what it has.
 *
 * Each block is one utterance: its words after the filters and the hints,
 * in its speaker's voice. An utterance is known by its signature — the
 * connection and model it is asked of, the voice as the server is asked for
 * it, the speed, and the words — and audio is kept by signature. So whatever
 * changes what would be said — an edit, a new speaker, a voice remixed, a
 * hint, a filter, another model — leaves that block without audio and every
 * other with the audio it had. Putting the words back brings it back. A block
 * the filters take all of is skipped: nothing is asked for.
 */

import { applyFilters } from './filters.js'
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
 * @property {string} text - What is sent, filters and hints applied
 * @property {TtsVoice} voice
 * @property {string} signature - What the audio for it is kept under
 * @property {boolean} [skipped] - The filters took all of it, and it is not read
 */

/**
 * Where each block of a document stands in a reading.
 *
 * @typedef {'ready'|'missing'|'running'|'failed'|'skipped'} BlockState
 */

/** The pause between blocks in a track, in seconds. */
export const BLOCK_GAP = 0.4

/**
 * @param {TtsVoice} voice
 * @param {string} text - As sent
 * @param {string} [via] - The connection and model it is asked of
 * @returns {string}
 */
export function signatureOf(voice, text, via = '') {
  return `${via}\n${voice.voice}\n${voice.speed ?? 1}\n${text}`
}

/**
 * What a clip is kept under on disk: its signature hashed, which says what
 * was asked for without saying the words, in characters any file name takes.
 *
 * @param {string} signature
 * @returns {Promise<string>} 64 hex digits
 */
export async function audioKeyOf(signature) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * What the server is asked to say, in order: one utterance to a block, the
 * skipped ones among them.
 *
 * @param {Block[]} blocks
 * @param {(string|null)[]} speakers - A voice id per block, as resolved
 * @param {TtsVoice[]} voices
 * @param {string} defaultId - The voice for blocks with no speaker
 * @param {Hint[]} hints
 * @param {RegExp[]} [filters]
 * @param {string} [via] - The connection and model the audio is asked of
 * @returns {Utterance[]}
 */
export function utterancesOf(blocks, speakers, voices, defaultId, hints, filters = [], via = '') {
  return blocks.map((block, index) => {
    const voice = voiceFor(voices, speakers[index], defaultId)
    const said = applyFilters(block.text, filters)
    if (!said) return { index, text: '', voice, signature: '', skipped: true }
    const text = applyHints(said, hints)
    return { index, text, voice, signature: signatureOf(voice, text, via) }
  })
}

/**
 * What a run should ask for. Asked for some blocks, it reads those, again if
 * they have been read. Asked for the document, it reads what has no audio,
 * which once everything has some is nothing. A skipped block is never read.
 *
 * @param {Utterance[]} utterances
 * @param {(signature: string) => boolean} has - Whether there is audio for a signature
 * @param {number[]} [blocks] - The blocks asked for; none means the document
 * @returns {Utterance[]}
 */
export function targetsOf(utterances, has, blocks) {
  const read = utterances.filter(utterance => !utterance.skipped)
  if (blocks?.length) return read.filter(utterance => blocks.includes(utterance.index))
  return read.filter(utterance => !has(utterance.signature))
}

/** About how much a sample says, in characters: half a minute or so. */
export const SAMPLE_LENGTH = 500

/**
 * The blocks a sample of the document is read from: its opening, as many
 * blocks as it takes to say `length` characters, and at least one. Skipped
 * blocks say nothing, and are passed over.
 *
 * @param {Utterance[]} utterances
 * @param {number} [length]
 * @returns {number[]}
 */
export function sampleOf(utterances, length = SAMPLE_LENGTH) {
  /** @type {number[]} */
  const indices = []
  let said = 0
  for (const utterance of utterances) {
    if (utterance.skipped) continue
    if (indices.length > 0 && said >= length) break
    indices.push(utterance.index)
    said += utterance.text.length
  }
  return indices
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
 * Where each block stands: read, not read, being read now, where the last
 * run failed, or not to be read at all.
 *
 * @param {Utterance[]} utterances - One to a block, in order
 * @param {{clips: {has: (signature: string) => boolean}, current: string|null, failed: string|null}|null} reading
 * @returns {BlockState[]}
 */
export function blockStatesOf(utterances, reading) {
  return utterances.map(({ signature, skipped }) => {
    if (skipped) return 'skipped'
    if (!reading) return 'missing'
    if (reading.current === signature) return 'running'
    if (reading.failed === signature) return 'failed'
    return reading.clips.has(signature) ? 'ready' : 'missing'
  })
}
