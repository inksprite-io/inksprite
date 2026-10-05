/* global Blob, Audio */
/**
 * @module tts/player
 * @description WAV audio, handed to the page to play: as an object URL for a
 * player of the page's own, or played here through to its end.
 */

/**
 * A WAV file, whole or in parts, as something a player can be pointed at,
 * where the page can make one; a test runner cannot, and gets null.
 *
 * @param {BlobPart[]} parts
 * @returns {string|null}
 */
export function objectUrl(parts) {
  return typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(new Blob(parts, { type: 'audio/wav' }))
    : null
}

/**
 * Let go of an object URL, and the audio behind it.
 * @param {string|null} url
 */
export function release(url) {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

/**
 * Play a clip through to its end, or until told to stop. Either way it
 * resolves, and the audio is let go of; it rejects only when the page cannot
 * play the clip at all.
 *
 * @param {ArrayBuffer} clip - A WAV file
 * @param {AbortSignal} [signal] - Stops the playing
 * @returns {Promise<void>}
 */
export function playClip(clip, signal) {
  return new Promise((resolve, reject) => {
    const url = objectUrl([clip])
    if (!url || signal?.aborted) {
      release(url)
      resolve()
      return
    }

    const audio = new Audio(url)
    /** @param {() => void} settle */
    const finish = settle => {
      signal?.removeEventListener('abort', halt)
      release(url)
      settle()
    }
    const halt = () => {
      audio.pause()
      finish(resolve)
    }

    signal?.addEventListener('abort', halt, { once: true })
    audio.addEventListener('ended', () => finish(resolve), { once: true })
    audio.addEventListener(
      'error',
      () => finish(() => reject(new Error('The audio could not be played.'))),
      { once: true }
    )
    Promise.resolve(audio.play()).catch(error => finish(() => reject(error)))
  })
}
