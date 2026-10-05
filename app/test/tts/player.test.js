/* global AbortController */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { objectUrl, playClip, release } from '@/tts/player.js'

/** An audio element, as far as the player asks of one. */
class FakeAudio {
  /** @type {FakeAudio[]} */
  static made = []
  static playable = true

  constructor(url) {
    this.url = url
    this.listeners = {}
    this.paused = false
    FakeAudio.made.push(this)
  }
  addEventListener(name, listener) {
    this.listeners[name] = listener
  }
  play() {
    return FakeAudio.playable ? Promise.resolve() : Promise.reject(new Error('NotAllowedError'))
  }
  pause() {
    this.paused = true
  }
}

const clip = new ArrayBuffer(8)

describe('player', () => {
  const createObjectURL = URL.createObjectURL
  const revokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    FakeAudio.made = []
    FakeAudio.playable = true
    vi.stubGlobal('Audio', FakeAudio)
    URL.createObjectURL = vi.fn(() => 'blob:clip')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
  })

  it('makes a URL of a WAV file in parts, and lets go of it', () => {
    expect(objectUrl([clip, new Uint8Array(4)])).toBe('blob:clip')
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(12)

    release('blob:clip')
    release(null)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('has no URL to give where the page cannot make one', () => {
    URL.createObjectURL = undefined
    expect(objectUrl([clip])).toBeNull()
  })

  it('plays a clip to its end, then lets go of it', async () => {
    const played = playClip(clip)
    const [audio] = FakeAudio.made
    expect(audio.url).toBe('blob:clip')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    audio.listeners.ended()
    await played
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip')
  })

  it('stops when told to, and says no more about it', async () => {
    const controller = new AbortController()
    const played = playClip(clip, controller.signal)
    controller.abort()
    await played

    expect(FakeAudio.made[0].paused).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip')
  })

  it('plays nothing once it has been told to stop', async () => {
    const controller = new AbortController()
    controller.abort()
    await playClip(clip, controller.signal)
    expect(FakeAudio.made).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip')
  })

  it('fails when the page will not play it', async () => {
    FakeAudio.playable = false
    await expect(playClip(clip)).rejects.toThrow('NotAllowedError')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip')
  })

  it('fails when the clip cannot be played', async () => {
    const played = playClip(clip)
    FakeAudio.made[0].listeners.error()
    await expect(played).rejects.toThrow('could not be played')
  })
})
