/**
 * @module tts/voices
 * @description A project's voices: who reads it, and who speaks in it.
 *
 * A voice is a name for the writer, what the server is asked for, and a
 * colour to know its lines by. A project with none has one, a narrator,
 * until the writer makes the list their own; the first change writes the
 * whole list, that one and all. One voice is the default, and reads whatever
 * nobody else has been given.
 */

/** @typedef {import('@/types/models.js').TtsVoice} TtsVoice */
/** @typedef {import('@/types/models.js').StoryNarration} StoryNarration */

/**
 * The voice a project starts with: a Kokoro mix that reads fiction well.
 * `af_nicole` carries it and is slow on its own, so the others and the speed
 * bring it up to a reading pace.
 */
export const DEFAULT_VOICES = Object.freeze([
  Object.freeze({
    id: 'narrator',
    name: 'Narrator',
    voice: 'af_heart+af_nicole(2)+af_jadzia',
    speed: 1.1,
  }),
])

/**
 * The colours a voice can have, for telling speakers apart at a glance.
 * Shown behind text at a fraction of their strength, so they read on a light
 * page and a dark one.
 */
export const VOICE_COLORS = Object.freeze([
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
])

/**
 * A colour for a new voice: the first nobody has, and once they all have
 * one, the next around.
 *
 * @param {TtsVoice[]} voices
 * @returns {string}
 */
export function nextColor(voices) {
  const taken = new Set(voices.map(voice => voice.color))
  return (
    VOICE_COLORS.find(color => !taken.has(color)) ??
    VOICE_COLORS[voices.length % VOICE_COLORS.length]
  )
}

/** What a voice says when the writer wants to hear it. */
export const SAMPLE_TEXT =
  'It was late, and the house had gone quiet. She turned the page, and read on.'

/**
 * The project's voices: its own, or the default while it has none.
 *
 * @param {StoryNarration|null|undefined} narration
 * @returns {TtsVoice[]}
 */
export function voicesOf(narration) {
  const voices = narration?.voices
  return voices?.length ? voices : [...DEFAULT_VOICES]
}

/**
 * The default voice, which reads whatever nobody else has been given: the
 * one chosen, while it is still there, else the first. A project that chose
 * one while the choice was called the narrator still has it.
 *
 * @param {StoryNarration|null|undefined} narration
 * @param {TtsVoice[]} [voices] - As `voicesOf` gives them
 * @returns {string} A voice id
 */
export function defaultVoiceOf(narration, voices = voicesOf(narration)) {
  const id = narration?.defaultVoiceId ?? narration?.narratorId
  return voices.some(voice => voice.id === id) ? /** @type {string} */ (id) : voices[0].id
}

/**
 * The voice a block is read in: its speaker, while that voice is still
 * there, else the default.
 *
 * @param {TtsVoice[]} voices
 * @param {string|null|undefined} voiceId - The block's speaker, if any
 * @param {string} defaultVoiceId
 * @returns {TtsVoice}
 */
export function voiceFor(voices, voiceId, defaultVoiceId) {
  return (
    voices.find(voice => voice.id === voiceId) ??
    voices.find(voice => voice.id === defaultVoiceId) ??
    voices[0]
  )
}
