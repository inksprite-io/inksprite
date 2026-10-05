import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VOICES,
  VOICE_COLORS,
  defaultVoiceOf,
  nextColor,
  voiceFor,
  voicesOf,
} from '@/tts/voices.js'

const riley = { id: 'riley', name: 'Riley', voice: 'af_heart+af_nicole(2)', speed: 1.1 }
const cody = { id: 'cody', name: 'Cody', voice: 'am_michael' }

describe('voicesOf', () => {
  it('is the default voice for a project with none', () => {
    expect(voicesOf(undefined)).toEqual(DEFAULT_VOICES)
    expect(voicesOf({})).toEqual(DEFAULT_VOICES)
    expect(voicesOf({ voices: [] })).toEqual(DEFAULT_VOICES)
  })

  it("is the project's own once it has any", () => {
    expect(voicesOf({ voices: [riley] })).toEqual([riley])
  })
})

describe('defaultVoiceOf', () => {
  it('is the voice chosen while it is still there', () => {
    expect(defaultVoiceOf({ voices: [riley, cody], defaultVoiceId: 'cody' })).toBe('cody')
  })

  it('falls back to the first voice', () => {
    expect(defaultVoiceOf({ voices: [riley, cody] })).toBe('riley')
    expect(defaultVoiceOf({ voices: [riley, cody], defaultVoiceId: 'gone' })).toBe('riley')
    expect(defaultVoiceOf(undefined)).toBe('narrator')
  })

  it('still reads a choice made while it was called the narrator', () => {
    expect(defaultVoiceOf({ voices: [riley, cody], narratorId: 'cody' })).toBe('cody')
    expect(
      defaultVoiceOf({ voices: [riley, cody], narratorId: 'cody', defaultVoiceId: 'riley' })
    ).toBe('riley')
  })
})

describe('nextColor', () => {
  it('is the first colour nobody has', () => {
    expect(nextColor([])).toBe(VOICE_COLORS[0])
    expect(nextColor([{ ...riley, color: VOICE_COLORS[0] }, cody])).toBe(VOICE_COLORS[1])
  })

  it('goes around again once they all have one', () => {
    const everyone = VOICE_COLORS.map((color, i) => ({ ...riley, id: `v${i}`, color }))
    expect(nextColor(everyone)).toBe(VOICE_COLORS[0])
  })
})

describe('voiceFor', () => {
  it('is the speaker, else the narrator, else the first voice', () => {
    expect(voiceFor([riley, cody], 'cody', 'riley')).toBe(cody)
    expect(voiceFor([riley, cody], null, 'cody')).toBe(cody)
    expect(voiceFor([riley, cody], 'gone', 'cody')).toBe(cody)
    expect(voiceFor([riley, cody], 'gone', 'also gone')).toBe(riley)
  })
})
