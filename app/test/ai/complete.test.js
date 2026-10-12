import { describe, it, expect, vi } from 'vitest'
import { complete } from '@/ai/complete.js'

const streamAnthropic = vi.fn()
vi.mock('@/ai/anthropic.js', () => ({ streamAnthropic: (...args) => streamAnthropic(...args) }))

describe('complete on Anthropic', () => {
  it('answers whole, with the words as they came and nothing of the thinking', async () => {
    streamAnthropic.mockImplementation(async ({ onChunk }) => {
      onChunk({ content: '', reasoning: 'Hm.' })
      onChunk({ content: 'Chapter ', reasoning: null })
      onChunk({ content: 'one', reasoning: null })
      return {
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        finishReason: 'stop',
      }
    })
    const pieces = []

    const result = await complete({
      provider: { id: 'p', type: 'anthropic', apiKey: 'k' },
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'Convert this.' }],
      onChunk: piece => pieces.push(piece),
    })

    expect(result).toEqual({
      content: 'Chapter one',
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      finishReason: 'stop',
    })
    expect(pieces).toEqual(['Chapter ', 'one'])
    // A job asks without tools.
    expect(streamAnthropic.mock.calls[0][0]).not.toHaveProperty('tools')
  })
})
