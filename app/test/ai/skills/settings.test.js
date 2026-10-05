import { describe, it, expect } from 'vitest'
import { DIRECTOR_SETTINGS, INTERPRET_SETTINGS } from '@/ai/skills/index.js'
import { AI_DEFAULTS } from '@/ai/defaults.js'

/**
 * Every skill's settings bag, by the name it is exported under.
 *
 * A skill added without a line here is a skill running at whatever the Game
 * Master runs at, which is the thing these exist to stop. The list is written
 * out rather than discovered because there is nothing to discover it from —
 * skills are modules, not entries in a registry.
 */
const SKILL_SETTINGS = [
  ['DIRECTOR_SETTINGS', DIRECTOR_SETTINGS],
  ['INTERPRET_SETTINGS', INTERPRET_SETTINGS],
]

describe('skill settings', () => {
  it.each(SKILL_SETTINGS)('%s sets things the request format knows about', (_name, settings) => {
    const settable = Object.keys(AI_DEFAULTS)

    expect(Object.keys(settings).every(key => settable.includes(key))).toBe(true)

    for (const key of Object.keys(settings.parameters || {})) {
      expect(Object.keys(AI_DEFAULTS.parameters)).toContain(key)
    }
  })

  it.each(SKILL_SETTINGS)('%s stays sparse', (_name, settings) => {
    // Laid over what the writer tuned for their model, and every field it
    // leaves out is one they keep — including all of them, which is a role
    // saying it has no quarrel with the profile. A full bag would replace their sampling
    // wholesale on the way to changing one value. Which fields it names is the
    // knob and not the contract — this guards only that it is a knob.
    expect(Object.keys(settings).length).toBeLessThan(Object.keys(AI_DEFAULTS).length)

    if (settings.parameters) {
      expect(Object.keys(settings.parameters).length).toBeLessThan(
        Object.keys(AI_DEFAULTS.parameters).length
      )
    }
  })
})
