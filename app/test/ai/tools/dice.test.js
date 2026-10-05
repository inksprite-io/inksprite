import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseDiceNotation,
  rollDice,
  diceToolDefinition,
  executeDiceTool,
} from '@/ai/tools/dice.js'

describe('dice tool', () => {
  describe('parseDiceNotation', () => {
    it('should parse simple dice notation', () => {
      expect(parseDiceNotation('1d20')).toEqual({ count: 1, sides: 20, modifier: 0 })
      expect(parseDiceNotation('2d6')).toEqual({ count: 2, sides: 6, modifier: 0 })
      expect(parseDiceNotation('4d10')).toEqual({ count: 4, sides: 10, modifier: 0 })
    })

    it('should parse notation without count (defaults to 1)', () => {
      expect(parseDiceNotation('d20')).toEqual({ count: 1, sides: 20, modifier: 0 })
      expect(parseDiceNotation('d6')).toEqual({ count: 1, sides: 6, modifier: 0 })
    })

    it('should parse notation with positive modifier', () => {
      expect(parseDiceNotation('1d20+5')).toEqual({ count: 1, sides: 20, modifier: 5 })
      expect(parseDiceNotation('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 })
    })

    it('should parse notation with negative modifier', () => {
      expect(parseDiceNotation('1d20-2')).toEqual({ count: 1, sides: 20, modifier: -2 })
      expect(parseDiceNotation('4d6-1')).toEqual({ count: 4, sides: 6, modifier: -1 })
    })

    it('should handle uppercase notation', () => {
      expect(parseDiceNotation('1D20')).toEqual({ count: 1, sides: 20, modifier: 0 })
      expect(parseDiceNotation('2D6+3')).toEqual({ count: 2, sides: 6, modifier: 3 })
    })

    it('should handle spaces in notation', () => {
      expect(parseDiceNotation('1 d 20')).toEqual({ count: 1, sides: 20, modifier: 0 })
      expect(parseDiceNotation('2d6 + 3')).toEqual({ count: 2, sides: 6, modifier: 3 })
    })

    it('should return null for invalid notation', () => {
      expect(parseDiceNotation('')).toBeNull()
      expect(parseDiceNotation(null)).toBeNull()
      expect(parseDiceNotation(undefined)).toBeNull()
      expect(parseDiceNotation('invalid')).toBeNull()
      expect(parseDiceNotation('20')).toBeNull()
      expect(parseDiceNotation('d')).toBeNull()
      expect(parseDiceNotation('dd20')).toBeNull()
    })

    it('should reject out-of-range count', () => {
      expect(parseDiceNotation('0d20')).toBeNull()
      expect(parseDiceNotation('101d20')).toBeNull()
    })

    it('should reject out-of-range sides', () => {
      expect(parseDiceNotation('1d1')).toBeNull()
      expect(parseDiceNotation('1d1001')).toBeNull()
    })

    it('should reject out-of-range modifier', () => {
      expect(parseDiceNotation('1d20+1001')).toBeNull()
      expect(parseDiceNotation('1d20-1001')).toBeNull()
    })
  })

  describe('rollDice', () => {
    let mathRandomSpy

    beforeEach(() => {
      // Mock Math.random to return predictable values
      mathRandomSpy = vi.spyOn(Math, 'random')
    })

    afterEach(() => {
      mathRandomSpy.mockRestore()
    })

    it('should roll a single die', () => {
      mathRandomSpy.mockReturnValue(0.5) // Middle of range

      const result = rollDice({ count: 1, sides: 20, modifier: 0 })

      expect(result.rolls).toHaveLength(1)
      expect(result.rolls[0]).toBe(11) // 0.5 * 20 + 1 = 11
      expect(result.total).toBe(11)
      expect(result.modifier).toBe(0)
    })

    it('should roll multiple dice', () => {
      mathRandomSpy
        .mockReturnValueOnce(0.0) // Roll 1
        .mockReturnValueOnce(0.5) // Roll 4
        .mockReturnValueOnce(0.99) // Roll 6

      const result = rollDice({ count: 3, sides: 6, modifier: 0 })

      expect(result.rolls).toHaveLength(3)
      expect(result.rolls).toEqual([1, 4, 6])
      expect(result.total).toBe(11)
    })

    it('should apply positive modifier', () => {
      mathRandomSpy.mockReturnValue(0.5)

      const result = rollDice({ count: 1, sides: 20, modifier: 5 })

      expect(result.rolls[0]).toBe(11)
      expect(result.total).toBe(16) // 11 + 5
      expect(result.modifier).toBe(5)
    })

    it('should apply negative modifier', () => {
      mathRandomSpy.mockReturnValue(0.5)

      const result = rollDice({ count: 1, sides: 20, modifier: -3 })

      expect(result.rolls[0]).toBe(11)
      expect(result.total).toBe(8) // 11 - 3
      expect(result.modifier).toBe(-3)
    })

    it('should roll minimum value', () => {
      mathRandomSpy.mockReturnValue(0.0)

      const result = rollDice({ count: 1, sides: 20, modifier: 0 })

      expect(result.rolls[0]).toBe(1)
      expect(result.total).toBe(1)
    })

    it('should roll near maximum value', () => {
      mathRandomSpy.mockReturnValue(0.999)

      const result = rollDice({ count: 1, sides: 20, modifier: 0 })

      expect(result.rolls[0]).toBe(20)
      expect(result.total).toBe(20)
    })
  })

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
    let mathRandomSpy

    beforeEach(() => {
      mathRandomSpy = vi.spyOn(Math, 'random')
    })

    afterEach(() => {
      mathRandomSpy.mockRestore()
    })

    it('should execute valid dice roll', async () => {
      mathRandomSpy.mockReturnValue(0.5)

      const result = await executeDiceTool({ dice: '1d20' })

      expect(result.total).toBe(11)
      expect(result.rolls).toEqual([11])
      expect(result.modifier).toBe(0)
      expect(result.notation).toBe('1d20')
    })

    it('should execute dice roll with modifier', async () => {
      mathRandomSpy.mockReturnValue(0.5)

      const result = await executeDiceTool({ dice: '2d6+3' })

      expect(result.rolls).toHaveLength(2)
      expect(result.modifier).toBe(3)
      expect(result.notation).toBe('2d6+3')
    })

    it('should return error for invalid notation', async () => {
      const result = await executeDiceTool({ dice: 'invalid' })

      expect(result.error).toBeDefined()
      expect(result.error).toContain('Invalid dice notation')
    })

    it('should return error for empty notation', async () => {
      const result = await executeDiceTool({ dice: '' })

      expect(result.error).toBeDefined()
    })
  })
})
