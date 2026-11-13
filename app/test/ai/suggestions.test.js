import { describe, it, expect } from 'vitest'
import { suggestModel, SONNET } from '@/ai/suggestions.js'

/** @param {string} id @param {Partial<import('@/ai/models.js').AIModel>} [more] */
const model = (id, more = {}) => ({ id, name: id, ...more })

describe('suggestModel', () => {
  it('takes the one model a server has loaded', () => {
    expect(suggestModel('lmstudio', [model('qwen-local')])).toBe('qwen-local')
  })

  it('has nothing to suggest from nothing', () => {
    expect(suggestModel('openrouter', [])).toBeNull()
  })

  it('starts OpenRouter on Sonnet, its newest where the alias isn’t listed', () => {
    const listed = [
      model('anthropic/claude-sonnet-4'),
      model('anthropic/claude-sonnet-4.5'),
      model('z-ai/glm-5.2'),
    ]
    expect(suggestModel('openrouter', listed)).toBe('anthropic/claude-sonnet-4.5')
    expect(suggestModel('openrouter', [...listed, model(SONNET)])).toBe(SONNET)
  })

  it('starts an account that never bought credits on a free model that calls tools', () => {
    const listed = [
      model('anthropic/claude-sonnet-4.5'),
      model('acme/tiny:free', { free: true, traits: { tools: false } }),
      model('meta-llama/llama-3.3-70b-instruct:free', { free: true, traits: { tools: true } }),
      model('z-ai/glm-4.5-air:free', { free: true, traits: { tools: true } }),
    ]
    expect(suggestModel('openrouter', listed, { freeTier: true })).toBe('z-ai/glm-4.5-air:free')
  })

  it('takes any free model where none is known to call tools', () => {
    const listed = [model('a/paid'), model('b/odd:free', { free: true })]
    expect(suggestModel('openrouter', listed, { freeTier: true })).toBe('b/odd:free')
  })

  it('starts Anthropic on its newest Sonnet, and OpenAI on the first of its list', () => {
    expect(
      suggestModel('anthropic', [
        model('claude-3-7-sonnet-20250219'),
        model('claude-opus-4-1-20250805'),
        model('claude-sonnet-4-5-20250929'),
      ])
    ).toBe('claude-sonnet-4-5-20250929')
    expect(suggestModel('openai', [model('gpt-4o'), model('gpt-4.1'), model('o3')])).toBe('gpt-4.1')
  })

  it('starts NanoGPT on Sonnet, its newest where the alias isn’t listed', () => {
    const listed = [
      model('anthropic/claude-sonnet-4.6'),
      model('anthropic/claude-sonnet-5.5'),
      model('anthropic/claude-sonnet-5.5:thinking'),
      model('z-ai/glm-5.3'),
    ]
    expect(suggestModel('nanogpt', listed)).toBe('anthropic/claude-sonnet-5.5')
    expect(suggestModel('nanogpt', [...listed, model('anthropic/claude-sonnet-latest')])).toBe(
      'anthropic/claude-sonnet-latest'
    )
  })

  it('starts anything else on the first in its list', () => {
    expect(suggestModel('vllm', [model('first'), model('second')])).toBe('first')
  })
})
