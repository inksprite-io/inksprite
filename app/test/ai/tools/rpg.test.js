import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LIKELIHOOD_TARGETS,
  interpretRoll,
  oracleDefinition,
  executeOracle,
  drawCard,
  rollTableDefinition,
  executeRollTable,
  drawTarot,
  TAROT_DECKS,
} from '@/ai/tools/rpg.js'
import { getToolDefinitions } from '@/ai/tools/index.js'
import { MAJOR_ARCANA, MINOR_ARCANA, TAROT_DECK } from '@/ai/tools/data/tarot.js'

describe('oracle and cards', () => {
  describe('LIKELIHOOD_TARGETS', () => {
    it('covers the seven buckets in monotonic order', () => {
      const order = [
        'nearly_impossible',
        'very_unlikely',
        'unlikely',
        'fifty_fifty',
        'likely',
        'very_likely',
        'nearly_certain',
      ]
      const values = order.map(k => LIKELIHOOD_TARGETS[k])
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1])
      }
      expect(LIKELIHOOD_TARGETS.fifty_fifty).toBe(50)
    })
  })

  describe('interpretRoll', () => {
    it('returns yes when roll <= target, no otherwise', () => {
      expect(interpretRoll(1, 50).result).toBe('yes')
      expect(interpretRoll(50, 50).result).toBe('yes')
      expect(interpretRoll(51, 50).result).toBe('no')
      expect(interpretRoll(100, 50).result).toBe('no')
    })

    it('flags exceptional yes in the lowest 1/5 of the yes range', () => {
      // target=50 → exc yes when roll <= 10
      expect(interpretRoll(1, 50)).toEqual({ result: 'yes', exceptional: true })
      expect(interpretRoll(10, 50)).toEqual({ result: 'yes', exceptional: true })
      expect(interpretRoll(11, 50)).toEqual({ result: 'yes', exceptional: false })
      expect(interpretRoll(50, 50)).toEqual({ result: 'yes', exceptional: false })
    })

    it('flags exceptional no in the highest 1/5 of the no range', () => {
      // target=50 → no range 51-100 (size 50), exc no when roll >= 91
      expect(interpretRoll(51, 50)).toEqual({ result: 'no', exceptional: false })
      expect(interpretRoll(90, 50)).toEqual({ result: 'no', exceptional: false })
      expect(interpretRoll(91, 50)).toEqual({ result: 'no', exceptional: true })
      expect(interpretRoll(100, 50)).toEqual({ result: 'no', exceptional: true })
    })

    it('handles asymmetric targets', () => {
      // target=85 (very_likely) → exc yes <= 17, exc no >= 98
      expect(interpretRoll(17, 85)).toEqual({ result: 'yes', exceptional: true })
      expect(interpretRoll(18, 85)).toEqual({ result: 'yes', exceptional: false })
      expect(interpretRoll(97, 85)).toEqual({ result: 'no', exceptional: false })
      expect(interpretRoll(98, 85)).toEqual({ result: 'no', exceptional: true })
    })
  })

  describe('oracle tool definition', () => {
    it('declares required params and the likelihood enum', () => {
      expect(oracleDefinition.function.name).toBe('oracle')
      expect(oracleDefinition.function.parameters.required).toEqual(['question', 'likelihood'])
      const enumValues = oracleDefinition.function.parameters.properties.likelihood.enum
      expect(enumValues).toContain('fifty_fifty')
      expect(enumValues).toContain('nearly_certain')
      expect(enumValues.length).toBe(7)
    })
  })

  describe('executeOracle', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0) // → roll = 1
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('answers with the answer and nothing else', async () => {
      // Not the question echoed back, the bucket, the target, or the d100. A
      // model handed the working narrates the working: the player hears about
      // a 73 against a target of 65.
      const out = await executeOracle({ question: 'does the door creak?', likelihood: 'likely' })

      expect(out).toBe('exceptional yes')
    })

    it('says plain yes outside the exceptional band', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.3) // roll = 31, target 50
      expect(await executeOracle({ question: 'q', likelihood: 'fifty_fifty' })).toBe('yes')
    })

    it('says no, and exceptional no, on the other side', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.6) // roll = 61
      expect(await executeOracle({ question: 'q', likelihood: 'fifty_fifty' })).toBe('no')

      vi.spyOn(Math, 'random').mockReturnValue(0.95) // roll = 96
      expect(await executeOracle({ question: 'q', likelihood: 'fifty_fifty' })).toBe(
        'exceptional no'
      )
    })

    it('only ever answers one of the four', async () => {
      const answers = new Set()
      vi.restoreAllMocks()
      for (let i = 0; i < 400; i++) {
        answers.add(await executeOracle({ question: 'q', likelihood: 'fifty_fifty' }))
      }

      for (const answer of answers) {
        expect(['yes', 'no', 'exceptional yes', 'exceptional no']).toContain(answer)
      }
    })

    it('follows the likelihood it was given', async () => {
      // roll = 51: a yes if the target is above it, a no if below.
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      expect(LIKELIHOOD_TARGETS.likely).toBeGreaterThan(51)
      expect(await executeOracle({ question: 'q', likelihood: 'likely' })).toBe('yes')
      expect(await executeOracle({ question: 'q', likelihood: 'unlikely' })).toBe('no')
    })

    it('rolls a random event for nobody', async () => {
      // Doubles used to fire a random event off the back of a yes/no
      // question. A random event is `interpret`'s, a call the Game Master
      // makes when it wants one.
      vi.spyOn(Math, 'random').mockReturnValue(0.1) // roll = 11, the old trigger
      const out = await executeOracle({ question: 'q', likelihood: 'fifty_fifty' })

      expect(typeof out).toBe('string')
      expect(out).not.toContain('action')
    })

    it('rejects an unknown likelihood', async () => {
      const out = await executeOracle({ question: 'q', likelihood: 'maybe' })
      expect(out.error).toMatch(/Unknown likelihood/)
    })
  })

  describe('drawCard', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('turns over one card from the whole deck', () => {
      const { card, reversed } = drawCard()

      expect(TAROT_DECK).toContain(card)
      expect(typeof reversed).toBe('boolean')
    })

    it('reaches the minor cards as well as the major ones', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.999)

      expect(drawCard().card).toBe('King of Pentacles')
    })

    it('comes up reversed half the time', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.25)
      expect(drawCard().reversed).toBe(true)

      vi.spyOn(Math, 'random').mockReturnValue(0.75)
      expect(drawCard().reversed).toBe(false)
    })

    it('is not a tool any model is offered', () => {
      // The card is a prompt, not an answer, and whoever is handed it reads it
      // at the front of their next paragraph. `interpret` draws it out of
      // sight and hands back what it made of it.
      const names = getToolDefinitions().map(d => d.function.name)

      expect(names).not.toContain('draw_card')
      expect(names).toContain('interpret')
    })
  })

  describe('drawTarot', () => {
    it('turns over three cards from the Major Arcana unless told otherwise', () => {
      const cards = drawTarot()

      expect(cards).toHaveLength(3)
      for (const card of cards) expect(MAJOR_ARCANA).toContain(card)
    })

    it('draws as many as asked, from the deck it is handed', () => {
      const cards = drawTarot(5, TAROT_DECK)

      expect(cards).toHaveLength(5)
      for (const card of cards) expect(TAROT_DECK).toContain(card)
    })

    it('draws without replacement, and stops when the deck is out', () => {
      const cards = drawTarot(TAROT_DECK.length + 1, TAROT_DECK)

      expect(cards).toHaveLength(TAROT_DECK.length)
      expect(new Set(cards).size).toBe(TAROT_DECK.length)
    })

    it('names the two decks there are', () => {
      expect(TAROT_DECKS.major).toBe(MAJOR_ARCANA)
      expect(TAROT_DECKS.full).toBe(TAROT_DECK)
    })

    it('is not a tool any model is offered', () => {
      const names = getToolDefinitions().map(d => d.function.name)

      expect(names).not.toContain('tarot')
      expect(names).not.toContain('draw_tarot')
    })
  })

  describe('the deck', () => {
    it('is the seventy-eight cards, each once, frozen', () => {
      expect(MAJOR_ARCANA).toHaveLength(22)
      expect(MINOR_ARCANA).toHaveLength(56)
      expect(TAROT_DECK).toHaveLength(78)
      expect(new Set(TAROT_DECK).size).toBe(78)
      expect(Object.isFrozen(TAROT_DECK)).toBe(true)
    })

    it('runs each suit from the ace to the king', () => {
      expect(MINOR_ARCANA[0]).toBe('Ace of Wands')
      expect(MINOR_ARCANA[13]).toBe('King of Wands')
      expect(MINOR_ARCANA[55]).toBe('King of Pentacles')
    })
  })

  describe('roll_table', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('declares options as a required string array', () => {
      const params = rollTableDefinition.function.parameters
      expect(rollTableDefinition.function.name).toBe('roll_table')
      expect(params.required).toEqual(['options'])
      expect(params.properties.options.type).toBe('array')
      expect(params.properties.options.items.type).toBe('string')
    })

    it('picks the option the roll lands on', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5) // → index 1 of 3

      const out = await executeRollTable({ options: ['a', 'b', 'c'] })

      expect(out.result).toBe('b')
      // 1-based so it reads like a table roll, not an array index.
      expect(out.roll).toBe(2)
      expect(out.options_count).toBe(3)
    })

    it('can land on the last option', async () => {
      // Math.random() never returns 1, so the top of the range must still be
      // reachable rather than rounding past the end of the table.
      vi.spyOn(Math, 'random').mockReturnValue(0.999999)

      expect((await executeRollTable({ options: ['a', 'b', 'c'] })).result).toBe('c')
    })

    it('echoes the table name only when given', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      const named = await executeRollTable({ options: ['a'], table_name: 'the satchel' })
      const unnamed = await executeRollTable({ options: ['a'] })

      expect(named.table_name).toBe('the satchel')
      expect(unnamed).not.toHaveProperty('table_name')
    })

    it('weights an option repeated in the list', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5) // → index 1 of 3

      expect((await executeRollTable({ options: ['a', 'a', 'b'] })).result).toBe('a')
    })

    it('drops blank and non-string entries before rolling', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      const out = await executeRollTable({ options: ['   ', 'kept', null, 42] })

      expect(out.options_count).toBe(1)
      expect(out.result).toBe('kept')
    })

    it('trims surrounding whitespace from the result', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      expect((await executeRollTable({ options: ['  a rusty key  '] })).result).toBe('a rusty key')
    })

    it('errors on a missing, empty, or all-blank table', async () => {
      expect((await executeRollTable({})).error).toMatch(/non-empty/)
      expect((await executeRollTable({ options: [] })).error).toMatch(/non-empty/)
      expect((await executeRollTable({ options: ['', '  '] })).error).toMatch(/non-empty/)
    })

    it('errors on an implausibly long table', async () => {
      const out = await executeRollTable({ options: Array.from({ length: 101 }, (_, i) => `${i}`) })

      expect(out.error).toMatch(/at most 100/)
    })
  })
})
