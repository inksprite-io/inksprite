import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  interpretDefinition,
  executeInterpret,
  INTERPRET_PROMPT,
  buildInterpretPrompt,
  describeCard,
  INTERPRET_SETTINGS,
} from '@/ai/skills/interpret/index.js'
/** What the transcript Interpret reads calls the two voices at the table. */
const TABLE_ROLES = { user: 'player', assistant: 'game_master' }
import { TAROT_DECK } from '@/ai/tools/data/tarot.js'

describe('interpret skill', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('definition', () => {
    it('takes one question, and requires it', () => {
      expect(interpretDefinition.function.name).toBe('interpret')
      expect(interpretDefinition.function.parameters.required).toEqual(['question'])
      expect(interpretDefinition.function.parameters.properties.question.type).toBe('string')
    })

    it('promises an answer the caller can play as it stands', () => {
      // Not a card to decode. A caller that expects a raw draw narrates the
      // decoding.
      expect(interpretDefinition.function.description).toMatch(/sentence or two/i)
      expect(interpretDefinition.function.description).toMatch(/specific question/i)
    })
  })

  describe('prompt', () => {
    it('is loaded and trimmed', () => {
      expect(INTERPRET_PROMPT.length).toBeGreaterThan(0)
      expect(INTERPRET_PROMPT).toBe(INTERPRET_PROMPT.trim())
    })
  })

  describe('buildInterpretPrompt', () => {
    it('carries the role, the question and the card', () => {
      const prompt = buildInterpretPrompt('What is she hiding?', {
        card: 'The Tower',
        reversed: true,
      })

      expect(prompt).toContain(INTERPRET_PROMPT)
      expect(prompt).toContain('What is she hiding?')
      expect(prompt).toContain('The Tower, reversed')
    })
  })

  describe('describeCard', () => {
    it('says which way up the card came, both ways', () => {
      expect(describeCard({ card: 'Three of Cups', reversed: false })).toBe(
        'Three of Cups, upright'
      )
      expect(describeCard({ card: 'Three of Cups', reversed: true })).toBe(
        'Three of Cups, reversed'
      )
    })
  })

  describe('execute', () => {
    it('draws a card, consults on it, and hands back what came of it', async () => {
      const consult = vi.fn().mockResolvedValue('The innkeeper is hiding her son.')

      const result = await executeInterpret({ question: 'What is she hiding?' }, { consult })

      expect(result).toEqual({ interpretation: 'The innkeeper is hiding her son.' })

      const [prompt] = consult.mock.calls[0]
      expect(prompt).toContain('What is she hiding?')
      expect(
        TAROT_DECK.some(card => new RegExp(`\\n${card}, (upright|reversed)$`).test(prompt))
      ).toBe(true)
    })

    it('asks for no tools of its own', async () => {
      // Its roll is already made and everything else belongs to the caller, so
      // it answers in one round rather than opening a loop inside a loop.
      const consult = vi.fn().mockResolvedValue('An idea.')

      await executeInterpret({ question: 'Where should this turn?' }, { consult })

      expect(consult).toHaveBeenCalledTimes(1)
      expect(consult.mock.calls[0][1]).toBeUndefined()
    })

    it('reads the game under the table names, at its own settings', async () => {
      const consult = vi.fn().mockResolvedValue('An idea.')

      await executeInterpret({ question: 'Where should this turn?' }, { consult })

      expect(consult.mock.calls[0][2]).toEqual({
        roles: TABLE_ROLES,
        overrides: INTERPRET_SETTINGS,
      })
    })

    it('draws again on every call', async () => {
      // The same question asked twice is two draws, not a cached one — asking
      // again is how a caller gets a second angle on it.
      const consult = vi.fn().mockResolvedValue('An idea.')

      vi.spyOn(Math, 'random').mockReturnValue(0)
      await executeInterpret({ question: 'What waits on the road?' }, { consult })

      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      await executeInterpret({ question: 'What waits on the road?' }, { consult })

      expect(consult.mock.calls[0][0]).not.toBe(consult.mock.calls[1][0])
      expect(consult.mock.calls[0][0]).toContain(`${TAROT_DECK[0]}, reversed`)
    })

    it('returns only the interpretation', async () => {
      // Nothing of the draw goes back with it — not the card, not that there
      // was one.
      const consult = vi.fn().mockResolvedValue('The road is watched.')

      const result = await executeInterpret({ question: 'What waits on the road?' }, { consult })

      expect(Object.keys(result)).toEqual(['interpretation'])
    })

    it('asks for a question when it was given none', async () => {
      const consult = vi.fn()

      expect(await executeInterpret({}, { consult })).toEqual({
        error: expect.stringMatching(/ask a question/i),
      })
      expect(await executeInterpret({ question: '   ' }, { consult })).toEqual({
        error: expect.stringMatching(/ask a question/i),
      })
      expect(consult).not.toHaveBeenCalled()
    })

    it('reports an error rather than throwing when nothing can run it', async () => {
      const result = await executeInterpret({ question: 'What is she hiding?' })

      expect(result).toEqual({ error: expect.stringMatching(/not available/i) })
    })

    it('reports an error when nothing came back', async () => {
      const consult = vi.fn().mockResolvedValue('')

      const result = await executeInterpret({ question: 'What is she hiding?' }, { consult })

      expect(result).toEqual({ error: expect.stringMatching(/nothing to say/i) })
    })
  })
})
