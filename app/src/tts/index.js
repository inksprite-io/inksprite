/**
 * @module tts
 * @description A document read aloud by a speech server, in the project's
 * voices. Pure: nothing here holds state or touches a store. The
 * `useNarration` composable does, and this is what it is made of.
 *
 * - **script** - A document as blocks to be spoken, a paragraph each, and who
 *   speaks each: an overlay that survives edits
 * - **reading** - What the server is asked for: each block in its voice, known
 *   by a signature its audio is kept under
 * - **hints** - Pronunciation hints, `word:say`, applied to what is sent
 * - **voices** - The project's voices, their colours, and the default
 * - **highlight** - Where each speaker's lines are in a document, to colour
 * - **client** - The speech server, spoken to in the OpenAI shape
 * - **wav** - Clips joined into one track, and where in it each plays
 * - **player** - Audio handed to the page: an object URL, or a clip played to its end
 *
 * Design: `.llm/narration_design.md`.
 *
 * @example
 * import { blocksOf, resolveSpeakers } from '@/tts/script.js'
 * const blocks = blocksOf(document.content)
 * const speakers = resolveSpeakers(blocks.map(b => b.text), document.speakers)
 */

export { blocksOf, blocksOfDoc, keyOf, resolveSpeakers, assignSpeaker } from './script.js'
export {
  BLOCK_GAP,
  signatureOf,
  utterancesOf,
  targetsOf,
  trackKeyOf,
  blockStatesOf,
} from './reading.js'
export { speakerRanges } from './highlight.js'
export { parseHints, applyHints } from './hints.js'
export {
  DEFAULT_VOICES,
  VOICE_COLORS,
  SAMPLE_TEXT,
  voicesOf,
  defaultVoiceOf,
  voiceFor,
  nextColor,
} from './voices.js'
export {
  DEFAULT_MODEL,
  DEFAULT_ENDPOINT,
  speechUrl,
  voicesUrl,
  synthesize,
  listVoices,
  describeFailure,
} from './client.js'
export {
  parseWav,
  encodeWav,
  wavHeader,
  concatParts,
  joinClips,
  segmentAt,
  durationOf,
} from './wav.js'
export { objectUrl, release, playClip } from './player.js'
