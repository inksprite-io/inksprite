/* global AbortController */
/**
 * @module composables/useSpeech
 * @description Something read aloud then and there: a chat message, in one
 * voice. One thing at a time, app-wide — starting another stops the one that
 * was speaking, the way one person reads.
 *
 * What is read comes as lines, a paragraph each. They are asked for in order,
 * each as soon as the last is back, and played in order, each as soon as it
 * is there: the reading starts when the first line arrives rather than when
 * the last does, and the next is usually waiting by the time one ends.
 * Nothing is kept; read again, it is asked for again.
 *
 * A document's narration is a different thing (`useNarration`): many voices,
 * audio kept and joined into a track. This is for hearing a message once.
 */

import { ref } from 'vue'
import { synthesize } from '@/tts/client.js'
import { playClip } from '@/tts/player.js'

/**
 * @typedef {Object} SpeechRequest
 * @property {import('@/tts/client.js').SpeechConnection} connection
 * @property {import('@/types/models.js').TtsVoice} voice
 * @property {string[]} lines - What to say, a paragraph each, in order
 */

/** What is being read: whatever the caller named it. @type {import('vue').Ref<string|null>} */
const current = ref(null)

/**
 * How far along it is: waiting on the first line, or speaking.
 * @type {import('vue').Ref<'idle'|'loading'|'speaking'>}
 */
const status = ref('idle')

/** @type {AbortController|null} */
let controller = null

/** Stop whatever is being read. */
function stop() {
  controller?.abort()
}

/**
 * A promise, and the means to settle it from outside.
 * @returns {{promise: Promise<ArrayBuffer>, resolve: (clip: ArrayBuffer) => void, reject: (error: unknown) => void}}
 */
function deferred() {
  /** @type {(clip: ArrayBuffer) => void} */
  let resolve = () => {}
  /** @type {(error: unknown) => void} */
  let reject = () => {}
  /** @type {Promise<ArrayBuffer>} */
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  // A line that fails after the listener has gone is nobody's to hear about.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

/**
 * Read lines aloud, in one voice. Resolves when the last has been spoken, or
 * when the reading is stopped, by `stop` or by another starting.
 *
 * @param {string} key - What this is a reading of, for `current` to say
 * @param {SpeechRequest} request
 * @returns {Promise<void>}
 * @throws {Error} When the server refuses a line, or it cannot be played
 */
async function speak(key, { connection, voice, lines }) {
  stop()
  if (lines.length === 0) return

  const own = new AbortController()
  controller = own
  current.value = key
  status.value = 'loading'

  const clips = lines.map(deferred)
  const asking = async () => {
    for (const [index, line] of lines.entries()) {
      try {
        const request = { input: line, voice: voice.voice, speed: voice.speed ?? 1 }
        clips[index].resolve(await synthesize(connection, request, own.signal))
      } catch (error) {
        clips[index].reject(error)
        return
      }
    }
  }
  asking()

  try {
    for (const clip of clips) {
      const audio = await clip.promise
      if (own.signal.aborted) break
      status.value = 'speaking'
      await playClip(audio, own.signal)
      if (own.signal.aborted) break
    }
  } catch (error) {
    if (!own.signal.aborted) throw error
  } finally {
    // Whatever is still being asked for is no longer wanted.
    own.abort()
    if (controller === own) {
      controller = null
      current.value = null
      status.value = 'idle'
    }
  }
}

/**
 * @returns {{
 *   current: import('vue').Ref<string|null>,
 *   status: import('vue').Ref<'idle'|'loading'|'speaking'>,
 *   speak: (key: string, request: SpeechRequest) => Promise<void>,
 *   stop: () => void,
 * }}
 */
export function useSpeech() {
  return { current, status, speak, stop }
}
