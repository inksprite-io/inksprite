/* global OfflineAudioContext */
/**
 * @module tts/decode
 * @description Compressed audio made a WAV clip, for a server that gives no
 * WAV: OpenRouter answers in MP3 or in raw samples at a rate it doesn't say.
 * The browser decodes it, at the rate Kokoro and OpenAI speak at, and the clip
 * then joins any other (`tts/wav.js`). The one place in `tts/` that needs an
 * audio context.
 */

import { encodeWav } from './wav.js'

/** Samples a second: what Kokoro and OpenAI answer in, so their clips and these join. */
export const SAMPLE_RATE = 24000

/**
 * Decode audio into a 16-bit mono WAV file.
 *
 * @param {ArrayBuffer} audio - An MP3, or anything else the browser decodes
 * @returns {Promise<ArrayBuffer>}
 * @throws {Error} When the browser can't decode it
 */
export async function decodeToWav(audio) {
  // An offline context decodes to its own rate, resampling on the way.
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const decoded = await context.decodeAudioData(audio)
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
    decoded.getChannelData(channel)
  )
  const samples = new Int16Array(decoded.length)
  for (let i = 0; i < samples.length; i++) {
    let sum = 0
    for (const channel of channels) sum += channel[i]
    const value = Math.max(-1, Math.min(1, sum / channels.length))
    samples[i] = value < 0 ? value * 0x8000 : value * 0x7fff
  }
  return encodeWav({ channels: 1, sampleRate: decoded.sampleRate, bitsPerSample: 16 }, [
    new Uint8Array(samples.buffer),
  ])
}
