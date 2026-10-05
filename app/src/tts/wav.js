/**
 * @module tts/wav
 * @description WAV files, read and written by hand: enough to join the clips
 * a speech server returns into one track, a breath between paragraphs, and
 * to know where in the track each clip starts. Byte-level, so it needs no
 * audio context and runs the same under test as on the page.
 */

/**
 * @typedef {Object} WavFormat
 * @property {number} channels
 * @property {number} sampleRate
 * @property {number} bitsPerSample
 */

/**
 * @typedef {WavFormat & {data: Uint8Array}} Wav
 */

/**
 * A track: the clips as one file, and where in it each plays.
 *
 * The file is given in parts — a header, then each clip's samples and the
 * silences between as they already stand in memory — for a `Blob` to be
 * made of. A chapter is tens of megabytes, and joining it into one buffer
 * first would hold it all twice.
 *
 * @typedef {Object} Track
 * @property {Uint8Array[]} parts - One WAV file, in order
 * @property {Array<{start: number, end: number}>} segments - Each clip's place in the track, in seconds
 * @property {number} duration - The whole track, in seconds
 */

/**
 * Four ASCII bytes as the chunk id they spell.
 * @param {DataView} view
 * @param {number} at
 */
const tag = (view, at) =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3)
  )

/**
 * Read a WAV file.
 *
 * The data chunk's declared length is not trusted. A server that streams
 * its answer writes the header before it knows how long the answer is, and
 * leaves the length at zero or at the most it could be; the data then runs
 * to the end of the file.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Wav}
 * @throws {Error} When it is not a WAV file, or has no data
 */
export function parseWav(buffer) {
  const view = new DataView(buffer)
  if (buffer.byteLength < 12 || tag(view, 0) !== 'RIFF' || tag(view, 8) !== 'WAVE') {
    throw new Error('Not a WAV file')
  }

  /** @type {WavFormat|null} */
  let format = null
  let at = 12
  while (at + 8 <= buffer.byteLength) {
    const id = tag(view, at)
    const size = view.getUint32(at + 4, true)
    const start = at + 8
    if (id === 'fmt ') {
      format = {
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bitsPerSample: view.getUint16(start + 14, true),
      }
    } else if (id === 'data') {
      if (!format) throw new Error('WAV data before its format')
      const available = buffer.byteLength - start
      const length = size === 0 || size > available ? available : size
      return { ...format, data: new Uint8Array(buffer, start, length) }
    }
    // Chunks are word-aligned: an odd length is followed by a pad byte.
    at = start + size + (size % 2)
  }
  throw new Error('WAV file has no data')
}

/**
 * @param {WavFormat} format
 * @returns {number} Bytes per second of audio
 */
export const bytesPerSecond = format =>
  (format.sampleRate * format.channels * format.bitsPerSample) / 8

/**
 * How long a clip plays.
 *
 * @param {Wav} wav
 * @returns {number} Seconds
 */
export const durationOf = wav => wav.data.byteLength / bytesPerSecond(wav)

/**
 * The 44 bytes that open a PCM WAV file holding so much data.
 *
 * @param {WavFormat} format
 * @param {number} dataLength - Bytes of samples to follow
 * @returns {Uint8Array}
 */
export function wavHeader(format, dataLength) {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const blockAlign = (format.channels * format.bitsPerSample) / 8

  /** @param {number} at @param {string} text */
  const write = (at, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }

  write(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, format.channels, true)
  view.setUint32(24, format.sampleRate, true)
  view.setUint32(28, format.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, format.bitsPerSample, true)
  write(36, 'data')
  view.setUint32(40, dataLength, true)
  return header
}

/**
 * Parts as one buffer.
 *
 * @param {Uint8Array[]} parts
 * @returns {ArrayBuffer}
 */
export function concatParts(parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out.buffer
}

/**
 * Write a WAV file: a header, then the parts as given, PCM.
 *
 * @param {WavFormat} format
 * @param {Uint8Array[]} parts
 * @returns {ArrayBuffer}
 */
export function encodeWav(format, parts) {
  const dataLength = parts.reduce((total, part) => total + part.byteLength, 0)
  return concatParts([wavHeader(format, dataLength), ...parts])
}

/**
 * The clips as one track, a pause between each, and where in it each plays.
 *
 * Every clip must be in the format of the first. A speech server answers in
 * one format, and joining two would mean decoding, which this does not do.
 * The pause is silence for 16-bit and wider PCM, which is what a server
 * sends; 8-bit WAV puts silence at 128, and would get a faint click.
 *
 * @param {ArrayBuffer[]} clips
 * @param {{gap?: number}} [options] - The pause between clips, in seconds
 * @returns {Track}
 * @throws {Error} With no clips, or clips that differ in format
 */
export function joinClips(clips, { gap = 0.4 } = {}) {
  if (clips.length === 0) throw new Error('No clips to join')

  const wavs = clips.map(parseWav)
  const { channels, sampleRate, bitsPerSample } = wavs[0]
  const format = { channels, sampleRate, bitsPerSample }
  const blockAlign = (channels * bitsPerSample) / 8
  const perSecond = bytesPerSecond(format)
  // One silence, however many pauses: the parts are views, not copies.
  const silence = new Uint8Array(
    Math.max(0, Math.round((gap * perSecond) / blockAlign)) * blockAlign
  )

  /** @type {Uint8Array[]} */
  const data = []
  /** @type {Array<{start: number, end: number}>} */
  const segments = []
  let time = 0
  wavs.forEach((wav, i) => {
    if (
      wav.channels !== channels ||
      wav.sampleRate !== sampleRate ||
      wav.bitsPerSample !== bitsPerSample
    ) {
      throw new Error(`Clip ${i + 1} is not in the format of the first`)
    }
    if (i > 0 && silence.byteLength > 0) {
      data.push(silence)
      time += silence.byteLength / perSecond
    }
    const duration = durationOf(wav)
    segments.push({ start: time, end: time + duration })
    data.push(wav.data)
    time += duration
  })

  const dataLength = data.reduce((total, part) => total + part.byteLength, 0)
  return { parts: [wavHeader(format, dataLength), ...data], segments, duration: time }
}

/**
 * Which segment is playing at a moment: the one it falls in, or the one
 * about to start during the pause before it.
 *
 * @param {{segments: Array<{start: number, end: number}>}} track
 * @param {number} time - Seconds into the track
 * @returns {number|null} A segment index, or null past the end
 */
export function segmentAt(track, time) {
  const index = track.segments.findIndex(segment => time < segment.end)
  return index < 0 ? null : index
}
