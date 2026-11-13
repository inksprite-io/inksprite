import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { diceToolDefinition, executeDiceTool } from '@/ai/tools/dice.js'

describe('dice tool', () => {
  describe('diceToolDefinition', () => {
    it('should have correct type', () => {
      expect(diceToolDefinition.type).toBe('function')
    })

    it('should have correct function name', () => {
      expect(diceToolDefinition.function.name).toBe('roll_dice')
    })

    it('should have description', () => {
      expect(diceToolDefinition.function.description).toBeTruthy()
      expect(typeof diceToolDefinition.function.description).toBe('string')
    })

    it('should have parameters with dice property', () => {
      expect(diceToolDefinition.function.parameters.type).toBe('object')
      expect(diceToolDefinition.function.parameters.properties.dice).toBeDefined()
      expect(diceToolDefinition.function.parameters.properties.dice.type).toBe('string')
      expect(diceToolDefinition.function.parameters.required).toContain('dice')
    })
  })

  describe('executeDiceTool', () => {
    beforeEach(() => {
      // Mid-range on every die, so the arithmetic is what is under test.
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('answers with each die by kind, the working, and the total', async () => {
      expect(await executeDiceTool({ dice: '3d6+2d4-1' })).toEqual({
        roll: '3d6+2d4-1',
        dice: { d6: [4, 4, 4], d4: [3, 3] },
        working: '3d6: 4, 4, 4 → 12\n2d4: 3, 3 → 6',
        total: 17,
      })
      // One die is its own total, with no working to show.
      expect(await executeDiceTool({ dice: 'd20' })).toEqual({
        roll: 'd20',
        dice: { d20: [11] },
        total: 11,
      })
    })

    it('reads notation the way /roll does', async () => {
      expect(await executeDiceTool({ dice: '2D6 + 3' })).toMatchObject({
        dice: { d6: [4, 4] },
        working: '4, 4 → 8',
        total: 11,
      })
      expect(await executeDiceTool({ dice: '1d6+1d6' })).toMatchObject({ dice: { d6: [4, 4] } })
    })

    it('counts only the lowest or highest of the dice in min() and max()', async () => {
      // A 3, a 15 and a 9 on a d20.
      const random = vi.spyOn(Math, 'random')
      for (const value of [0.1, 0.7, 0.4]) random.mockReturnValueOnce(value)

      expect(await executeDiceTool({ dice: 'max(2d20)+d20-2' })).toEqual({
        roll: 'max(2d20)+d20-2',
        dice: { d20: [3, 15, 9] },
        kept: { d20: [15, 9] },
        working: 'max(2d20): ~~3~~, 15\nd20: 9',
        total: 22,
      })
      expect(await executeDiceTool({ dice: 'min(3d6)+max(2d4)' })).toMatchObject({
        dice: { d6: [4, 4, 4], d4: [3, 3] },
        kept: { d6: [4], d4: [3] },
        total: 7,
      })
    })

    /** @param {number[]} values - What `Math.random` comes up, in turn */
    const dieFalls = values => {
      const random = vi.spyOn(Math, 'random')
      for (const value of values) random.mockReturnValueOnce(value)
    }

    it('throws an advantage die and drops the lowest', async () => {
      // A 5, a 2, a 1 and a 3 on a d6.
      dieFalls([0.7, 0.2, 0.05, 0.4])

      expect(await executeDiceTool({ dice: '3d6a' })).toEqual({
        roll: '3d6a',
        dice: { d6: [5, 2, 1, 3] },
        kept: { d6: [5, 2, 3] },
        working: '~~1~~, 5, 2, 3',
        total: 10,
      })
    })

    it('throws a burden die and drops the highest', async () => {
      // An 18, a 4, an 11 and a 9 on a d20.
      dieFalls([0.85, 0.15, 0.5, 0.4])

      expect(await executeDiceTool({ dice: '3d20b' })).toEqual({
        roll: '3d20b',
        dice: { d20: [18, 4, 11, 9] },
        kept: { d20: [4, 11, 9] },
        working: '~~18~~, 4, 11, 9',
        total: 24,
      })
    })

    it('throws as many extra dice as the number says, and drops as many', async () => {
      // A 3, a 15, a 9, an 18 and a 1 on a d20.
      dieFalls([0.1, 0.7, 0.4, 0.85, 0])

      expect(await executeDiceTool({ dice: '3d20a2+1' })).toEqual({
        roll: '3d20a2+1',
        dice: { d20: [3, 15, 9, 18, 1] },
        kept: { d20: [15, 9, 18] },
        working: '~~1, 3~~, 15, 9, 18 → 42',
        total: 43,
      })
    })

    it('reads an advantage die on one d20 as the higher of two', async () => {
      // A 3 and then a 15, for each roll.
      dieFalls([0.1, 0.7, 0.1, 0.7])

      const written = await executeDiceTool({ dice: 'd20a+5' })
      const bracketed = await executeDiceTool({ dice: 'max(2d20)+5' })

      expect(written).toMatchObject({ dice: { d20: [3, 15] }, kept: { d20: [15] }, total: 20 })
      expect(bracketed).toMatchObject({ dice: written.dice, kept: written.kept, total: 20 })
    })

    it('drops only one of two dice that tie', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      expect(await executeDiceTool({ dice: '2d6a' })).toMatchObject({
        dice: { d6: [4, 4, 4] },
        kept: { d6: [4, 4] },
        total: 8,
      })
    })

    it('keeps each term to its own dice, among others of the same kind', async () => {
      // A 5, a 2 and a 1 on a d6, a 3 on a d4, and a 6 and a 1 on a d6.
      dieFalls([0.7, 0.2, 0.05, 0.5, 0.9, 0.05])

      expect(await executeDiceTool({ dice: '2d6a+1d4+2d6' })).toEqual({
        roll: '2d6a+1d4+2d6',
        dice: { d6: [5, 2, 1, 6, 1], d4: [3] },
        kept: { d6: [5, 2, 6, 1], d4: [3] },
        working: '2d6a: ~~1~~, 5, 2 → 7\n1d4: 3\n2d6: 6, 1 → 7',
        total: 17,
      })
    })

    it('shows each term its own dice, among others of the same kind', async () => {
      // A 10 and a 20, then a 3 and a 20, all on a d20.
      dieFalls([0.45, 0.95, 0.1, 0.95])

      expect(await executeDiceTool({ dice: 'd20a1 + d20b1' })).toMatchObject({
        dice: { d20: [10, 20, 3, 20] },
        working: 'd20a1: ~~10~~, 20\nd20b1: ~~20~~, 3',
        total: 23,
      })
    })

    it('takes one roll from another', async () => {
      // A 4 and a 2, then a 5 and a 1, on a d6.
      dieFalls([0.5, 0.2, 0.7, 0.05])

      expect(await executeDiceTool({ dice: '2d6 - 2d6' })).toMatchObject({
        dice: { d6: [4, 2, 5, 1] },
        working: '2d6: 4, 2 → 6\n2d6: 5, 1 → 6',
        total: 0,
      })
      expect(await executeDiceTool({ dice: '-d4+2' })).toMatchObject({
        working: '3',
        total: -1,
      })
    })

    it('multiplies and divides before it adds, as arithmetic does', async () => {
      expect(await executeDiceTool({ dice: '2d6 * 4' })).toMatchObject({
        working: '4, 4 → 8',
        total: 32,
      })
      expect(await executeDiceTool({ dice: '5d4x10' })).toMatchObject({ total: 150 })
      expect(await executeDiceTool({ dice: '1d6+2*3' })).toMatchObject({ total: 10 })
      expect(await executeDiceTool({ dice: '3d6 + 1 * 4' })).toMatchObject({ total: 16 })
      expect(await executeDiceTool({ dice: '(1d6+2)*3' })).toMatchObject({
        working: '4',
        total: 18,
      })
    })

    it('takes what is written without spaces as one, against spaced signs', async () => {
      // 12 on the three d6s, every time.
      expect(await executeDiceTool({ dice: '3d6+1 * 4' })).toMatchObject({
        working: '4, 4, 4 → 12',
        total: 52,
      })
      expect(await executeDiceTool({ dice: '2 * 3d6+1' })).toMatchObject({ total: 26 })
      expect(await executeDiceTool({ dice: '3d6+1 * 2 + 3' })).toMatchObject({ total: 29 })
      expect(await executeDiceTool({ dice: '8d6+4 / 2' })).toMatchObject({ total: 18 })
      expect(await executeDiceTool({ dice: '(3d6 + 1) * 4' })).toMatchObject({ total: 52 })
      // A sign spaced on one side only is spaced.
      expect(await executeDiceTool({ dice: '3d6 +1 * 4' })).toMatchObject({ total: 16 })
    })

    it('divides by a whole number, rounding down', async () => {
      expect(await executeDiceTool({ dice: '2d4/3' })).toMatchObject({ total: 2 })
      expect(await executeDiceTool({ dice: '1d4/2' })).toMatchObject({ total: 1 })
      expect(await executeDiceTool({ dice: '(1d4-6)/2' })).toMatchObject({ total: -2 })
      expect(await executeDiceTool({ dice: '8d6/(2)' })).toMatchObject({ total: 16 })
      for (const dice of ['8d6/0', '8d6 / d4', '8d6/(1+1)', '8d6/-2']) {
        expect(await executeDiceTool({ dice })).toEqual({
          error: expect.stringMatching(/divide by a whole number/i),
        })
      }
    })

    it('says what is wrong with signs and brackets', async () => {
      expect(await executeDiceTool({ dice: '2d6 ^ 4' })).toEqual({
        error: 'Join dice with +, -, * or /, not "^".',
      })
      expect(await executeDiceTool({ dice: '(2d6+1' })).toEqual({
        error: expect.stringMatching(/"\(" with no "\)"/),
      })
      expect(await executeDiceTool({ dice: '2d6)' })).toEqual({
        error: expect.stringMatching(/"\)" with no "\("/),
      })
      expect(await executeDiceTool({ dice: '2d6+' })).toEqual({
        error: expect.stringMatching(/"2d6\+" is not dice/),
      })
    })

    it('says nothing of what was kept where nothing was dropped', async () => {
      expect(await executeDiceTool({ dice: '2d6+1' })).not.toHaveProperty('kept')
      expect(await executeDiceTool({ dice: '2d6a0' })).not.toHaveProperty('kept')
      expect(await executeDiceTool({ dice: 'max(1d20)' })).not.toHaveProperty('kept')
    })

    it('reads the letters in either case', async () => {
      expect(await executeDiceTool({ dice: '3D6A' })).toMatchObject({
        kept: { d6: expect.any(Array) },
      })
      expect(await executeDiceTool({ dice: '3d6 B2 + 1' })).toMatchObject({ total: 13 })
    })

    it('counts extra dice toward the limit on what can be thrown', async () => {
      expect(await executeDiceTool({ dice: '99d6a' })).not.toHaveProperty('error')
      expect(await executeDiceTool({ dice: '99d6a2' })).toEqual({
        error: expect.stringMatching(/between 1 and 100 dice.*not 101/i),
      })
      expect(await executeDiceTool({ dice: '0d6a' })).toEqual({
        error: expect.stringMatching(/not 0/),
      })
    })

    it('refuses dice with both advantage and burden', async () => {
      for (const dice of ['3d6a1b1', '3d6ba', '2d4+3d6b2a']) {
        expect(await executeDiceTool({ dice })).toEqual({
          error: expect.stringMatching(/both advantage and burden/),
        })
      }
    })

    it('refuses advantage and burden inside min() and max(), and on a number', async () => {
      expect(await executeDiceTool({ dice: 'max(3d6a)' })).toEqual({
        error: expect.stringMatching(/dice of one kind in max\(\)/),
      })
      expect(await executeDiceTool({ dice: '2d6+3a' })).toEqual({
        error: expect.stringMatching(/"3a" is not dice/),
      })
    })

    it('describes advantage and burden to the model, and not min() or max()', () => {
      const { description, parameters } = diceToolDefinition.function
      const said = `${description} ${JSON.stringify(parameters)}`

      expect(said).toMatch(/advantage/)
      expect(said).toMatch(/burden/)
      expect(said).not.toMatch(/\b(min|max)\(/)
    })

    it('says what is wrong with notation that is not dice', async () => {
      expect(await executeDiceTool({ dice: 'invalid' })).toEqual({
        error: expect.stringMatching(/not dice/i),
      })
      expect(await executeDiceTool({ dice: '' })).toEqual({ error: expect.any(String) })
      expect(await executeDiceTool({ dice: '20' })).toEqual({
        error: expect.stringMatching(/no dice/i),
      })
    })

    it('refuses dice nobody needs', async () => {
      expect(await executeDiceTool({ dice: '101d20' })).toEqual({
        error: expect.stringMatching(/between 1 and/i),
      })
      expect(await executeDiceTool({ dice: '1d1' })).toEqual({
        error: expect.stringMatching(/sides/i),
      })
    })
  })
})
