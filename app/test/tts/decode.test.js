import { describe, it, expect, afterEach, vi } from 'vitest'
import { decodeToWav, SAMPLE_RATE } from '@/tts/decode.js'
import { parseWav } from '@/tts/wav.js'

/** An offline context that decodes anything into these channels, at the rate it was made with. */
const decodingTo = channels =>
  vi.fn(function (_channels, _length, sampleRate) {
    this.decodeAudioData = vi.fn(async () => ({
      sampleRate,
      length: channels[0].length,
      numberOfChannels: channels.length,
      getChannelData: index => Float32Array.from(channels[index]),
    }))
  })

describe('decodeToWav', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('makes 16-bit mono at the rate the other servers speak at', async () => {
    const context = decodingTo([[0, 0.5, -0.5, 1, -1, 2]])
    vi.stubGlobal('OfflineAudioContext', context)

    const wav = parseWav(await decodeToWav(new ArrayBuffer(8)))

    expect(context).toHaveBeenCalledWith(1, 1, SAMPLE_RATE)
    expect(wav).toMatchObject({ channels: 1, sampleRate: 24000, bitsPerSample: 16 })
    const samples = new Int16Array(wav.data.buffer, wav.data.byteOffset, wav.data.byteLength / 2)
    // Out of range is held at the edge.
    expect(Array.from(samples)).toEqual([0, 16383, -16384, 32767, -32768, 32767])
  })

  it('mixes stereo down to one channel', async () => {
    vi.stubGlobal(
      'OfflineAudioContext',
      decodingTo([
        [1, 0.5],
        [-1, 0.5],
      ])
    )
    const wav = parseWav(await decodeToWav(new ArrayBuffer(8)))
    const samples = new Int16Array(wav.data.buffer, wav.data.byteOffset, 2)
    expect(Array.from(samples)).toEqual([0, 16383])
  })
})
