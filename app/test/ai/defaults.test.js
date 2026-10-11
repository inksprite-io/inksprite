import { describe, it, expect } from 'vitest'
import { AI_DEFAULTS, resolveAISettings } from '@/ai/defaults.js'

describe('resolveAISettings', () => {
  it('returns the defaults when there are no overrides', () => {
    expect(resolveAISettings()).toBe(AI_DEFAULTS)
    expect(resolveAISettings(undefined)).toBe(AI_DEFAULTS)
  })

  it('applies top-level overrides without touching the rest', () => {
    const settings = resolveAISettings({ maxTokens: 512 })

    expect(settings.maxTokens).toBe(512)
    expect(settings.reasoningEffort).toBe(AI_DEFAULTS.reasoningEffort)
    expect(settings.parameters).toEqual(AI_DEFAULTS.parameters)
  })

  it('merges a sparse parameters bag over the defaults', () => {
    const settings = resolveAISettings({ parameters: { temperature: 0.2 } })

    // The overridden key changes; siblings keep their default values rather
    // than dropping out of the request.
    expect(settings.parameters.temperature).toBe(0.2)
    expect(settings.parameters.topP).toBe(AI_DEFAULTS.parameters.topP)
    expect(settings.parameters.repetitionPenalty).toBe(AI_DEFAULTS.parameters.repetitionPenalty)
  })

  it('does not mutate AI_DEFAULTS', () => {
    const before = JSON.parse(JSON.stringify(AI_DEFAULTS))

    resolveAISettings({ maxTokens: 99, parameters: { temperature: 0 } })

    expect(AI_DEFAULTS).toEqual(before)
  })

  it('treats an empty override object as defaults', () => {
    expect(resolveAISettings({})).toEqual(AI_DEFAULTS)
  })
})
