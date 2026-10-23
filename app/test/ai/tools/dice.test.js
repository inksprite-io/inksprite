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

    it('answers with each die by kind, the modifier, and the total', async () => {
      expect(await executeDiceTool({ dice: '3d6+2d4-1' })).toEqual({
        roll: '3d6+2d4-1',
        dice: { d6: [4, 4, 4], d4: [3, 3] },
        modifier: -1,
        total: 17,
      })
      expect(await executeDiceTool({ dice: 'd20' })).toEqual({
        roll: 'd20',
        dice: { d20: [11] },
        modifier: 0,
        total: 11,
      })
    })

    it('reads notation the way /roll does', async () => {
      expect(await executeDiceTool({ dice: '2D6 + 3' })).toMatchObject({
        dice: { d6: [4, 4] },
        modifier: 3,
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
        modifier: -2,
        total: 22,
      })
      expect(await executeDiceTool({ dice: 'min(3d6)+max(2d4)' })).toMatchObject({
        dice: { d6: [4, 4, 4], d4: [3, 3] },
        total: 7,
      })
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
