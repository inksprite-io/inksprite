/* global TextEncoder */
import { describe, it, expect } from 'vitest'
import {
  concatParts,
  durationOf,
  encodeWav,
  joinClips,
  parseWav,
  segmentAt,
  wavHeader,
} from '@/tts/wav.js'

const MONO_16 = { channels: 1, sampleRate: 24000, bitsPerSample: 16 }

/**
 * A clip of so many seconds of the same sample, in a format.
 * @param {number} seconds
 * @param {number} [sample]
 * @param {typeof MONO_16} [format]
 */
const clip = (seconds, sample = 7, format = MONO_16) => {
  const bytesPerSample = (format.channels * format.bitsPerSample) / 8
  const data = new Uint8Array(Math.round(seconds * format.sampleRate) * bytesPerSample)
  data.fill(sample)
  return encodeWav(format, [data])
}

/**
 * The same clip as a server that streams would write it: the data length
 * left at what it was before anything was written.
 * @param {ArrayBuffer} buffer
 * @param {number} declared
 */
const withDataLength = (buffer, declared) => {
  const copy = buffer.slice(0)
  new DataView(copy).setUint32(40, declared, true)
  return copy
}

describe('encodeWav and parseWav', () => {
  it('round-trip a file', () => {
    const wav = parseWav(clip(0.5, 9))
    expect(wav.channels).toBe(1)
    expect(wav.sampleRate).toBe(24000)
    expect(wav.bitsPerSample).toBe(16)
    expect(wav.data.byteLength).toBe(24000)
    expect(wav.data[0]).toBe(9)
    expect(wav.data[23999]).toBe(9)
    expect(durationOf(wav)).toBe(0.5)
  })

  it('write a stereo file the same way', () => {
    const stereo = { channels: 2, sampleRate: 44100, bitsPerSample: 16 }
    const wav = parseWav(clip(1, 1, stereo))
    expect(wav.channels).toBe(2)
    expect(wav.data.byteLength).toBe(44100 * 4)
    expect(durationOf(wav)).toBe(1)
  })

  it('read the data to the end when its length was not known', () => {
    expect(parseWav(withDataLength(clip(0.25), 0)).data.byteLength).toBe(12000)
    expect(parseWav(withDataLength(clip(0.25), 0xffffffff)).data.byteLength).toBe(12000)
  })

  it('step over chunks that are not the format or the data', () => {
    // A LIST chunk of odd length, padded to a word, between the format and
    // the data.
    const plain = clip(0.1)
    const extra = new Uint8Array(8 + 3 + 1)
    const view = new DataView(extra.buffer)
    extra.set([0x4c, 0x49, 0x53, 0x54], 0) // LIST
    view.setUint32(4, 3, true)
    const bytes = new Uint8Array(plain)
    const out = new Uint8Array(plain.byteLength + extra.byteLength)
    out.set(bytes.subarray(0, 36), 0)
    out.set(extra, 36)
    out.set(bytes.subarray(36), 36 + extra.byteLength)
    expect(parseWav(out.buffer).data.byteLength).toBe(4800)
  })

  it('refuse what is not a WAV file', () => {
    expect(() => parseWav(new ArrayBuffer(4))).toThrow('Not a WAV file')
    expect(() => parseWav(new TextEncoder().encode('RIFF....WAVEjunk').buffer)).toThrow('no data')
  })
})

describe('joinClips', () => {
  it('joins clips with a pause between, and says where each plays', () => {
    const track = joinClips([clip(1, 1), clip(0.5, 2), clip(0.25, 3)], { gap: 0.4 })

    expect(track.segments).toEqual([
      { start: 0, end: 1 },
      { start: 1.4, end: 1.9 },
      { start: 2.3, end: 2.55 },
    ])
    expect(track.duration).toBe(2.55)

    const wav = parseWav(concatParts(track.parts))
    expect(wav.sampleRate).toBe(24000)
    expect(wav.data.byteLength).toBe(122400)
    // The first clip, then silence, then the second.
    expect(wav.data[0]).toBe(1)
    expect(wav.data[48000]).toBe(0)
    expect(wav.data[1.4 * 48000]).toBe(2)
  })

  it('keeps the pause on a sample boundary', () => {
    const stereo = { channels: 2, sampleRate: 44100, bitsPerSample: 16 }
    const track = joinClips([clip(0.1, 1, stereo), clip(0.1, 2, stereo)], { gap: 0.333 })
    const wav = parseWav(concatParts(track.parts))
    expect(wav.data.byteLength % 4).toBe(0)
  })

  it('joins with no pause at all when asked', () => {
    const track = joinClips([clip(1), clip(1)], { gap: 0 })
    expect(track.segments[1].start).toBe(1)
    expect(parseWav(concatParts(track.parts)).data.byteLength).toBe(96000)
  })

  it('hands the file over in parts, the clips as they already stand', () => {
    const first = clip(1, 5)
    const track = joinClips([first, clip(1, 6)])
    expect(track.parts).toHaveLength(4)
    // However many pauses, one silence.
    const three = joinClips([first, clip(1, 6), clip(1, 7)])
    expect(three.parts[2]).toBe(three.parts[4])
    expect(track.parts[0]).toEqual(wavHeader(MONO_16, 48000 * 2 + 19200))
    // A view over the clip's own memory, not a copy of it.
    expect(track.parts[1].buffer).toBe(first)
  })

  it('has a default pause', () => {
    const track = joinClips([clip(1), clip(1)])
    expect(track.segments[1].start).toBeCloseTo(1.4)
  })

  it('needs at least one clip, all in one format', () => {
    expect(() => joinClips([])).toThrow('No clips')
    const stereo = { channels: 2, sampleRate: 24000, bitsPerSample: 16 }
    expect(() => joinClips([clip(0.1), clip(0.1, 1, stereo)])).toThrow('Clip 2')
  })
})

describe('segmentAt', () => {
  const track = joinClips([clip(1), clip(1)], { gap: 0.5 })

  it('is the segment a moment falls in', () => {
    expect(segmentAt(track, 0)).toBe(0)
    expect(segmentAt(track, 0.99)).toBe(0)
    expect(segmentAt(track, 1.6)).toBe(1)
  })

  it('is the segment about to start during the pause before it', () => {
    expect(segmentAt(track, 1.2)).toBe(1)
  })

  it('is nothing past the end', () => {
    expect(segmentAt(track, 2.5)).toBeNull()
  })
})
