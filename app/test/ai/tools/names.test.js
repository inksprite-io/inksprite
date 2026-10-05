import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateNamesDefinition, executeGenerateNames } from '@/ai/tools/names.js'
import { FEMALE_FIRST_NAMES, MALE_FIRST_NAMES, SURNAMES } from '@/ai/tools/data/names.js'

describe('generate_names', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('data pools', () => {
    it('are non-empty and shaped as [name, weight]', () => {
      for (const pool of [FEMALE_FIRST_NAMES, MALE_FIRST_NAMES, SURNAMES]) {
        expect(pool.length).toBeGreaterThan(0)
        for (const [name, weight] of pool) {
          expect(typeof name).toBe('string')
          expect(name.trim()).toBe(name)
          expect(Number.isInteger(weight)).toBe(true)
          expect(weight).toBeGreaterThan(0)
        }
      }
    })

    it('are sorted heaviest first, which the draw relies on for speed', () => {
      for (const pool of [FEMALE_FIRST_NAMES, MALE_FIRST_NAMES, SURNAMES]) {
        const weights = pool.map(([, w]) => w)
        expect(weights).toEqual([...weights].sort((a, b) => b - a))
      }
    })
  })

  describe('tool definition', () => {
    it('requires gender and caps count', () => {
      const params = generateNamesDefinition.function.parameters
      expect(generateNamesDefinition.function.name).toBe('generate_names')
      expect(params.required).toEqual(['gender'])
      expect(params.properties.gender.enum).toEqual(['female', 'male'])
      expect(params.properties.count.maximum).toBe(25)
    })
  })

  describe('execution', () => {
    it('returns one name by default', async () => {
      const out = await executeGenerateNames({ gender: 'female' })

      expect(out.names).toHaveLength(1)
      const [{ first, last, full }] = out.names
      expect(full).toBe(`${first} ${last}`)
    })

    it('returns the requested count', async () => {
      expect((await executeGenerateNames({ gender: 'male', count: 5 })).names).toHaveLength(5)
    })

    it('draws first names from the pool matching the gender', async () => {
      const female = new Set(FEMALE_FIRST_NAMES.map(([n]) => n))
      const surnames = new Set(SURNAMES.map(([n]) => n))

      const out = await executeGenerateNames({ gender: 'female', count: 10 })

      for (const { first, last } of out.names) {
        expect(female.has(first)).toBe(true)
        expect(surnames.has(last)).toBe(true)
      }
    })

    it('returns the heaviest name at the bottom of the range', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      const out = await executeGenerateNames({ gender: 'female' })

      expect(out.names[0].first).toBe(FEMALE_FIRST_NAMES[0][0])
      expect(out.names[0].last).toBe(SURNAMES[0][0])
    })

    it('stays in range at the very top of the draw', async () => {
      // Math.random() never returns 1, but the accumulator has to survive
      // floating-point drift across thousands of subtractions.
      vi.spyOn(Math, 'random').mockReturnValue(0.9999999999)
      const female = new Set(FEMALE_FIRST_NAMES.map(([n]) => n))

      const out = await executeGenerateNames({ gender: 'female' })

      expect(female.has(out.names[0].first)).toBe(true)
    })

    it('rejects a missing or unknown gender', async () => {
      expect((await executeGenerateNames({})).error).toMatch(/gender/)
      expect((await executeGenerateNames({ gender: 'other' })).error).toMatch(/gender/)
    })

    it('rejects a count that is not a positive whole number', async () => {
      expect((await executeGenerateNames({ gender: 'male', count: 0 })).error).toMatch(/whole/)
      expect((await executeGenerateNames({ gender: 'male', count: 2.5 })).error).toMatch(/whole/)
    })

    it('rejects a count past the cap', async () => {
      const out = await executeGenerateNames({ gender: 'male', count: 26 })

      expect(out.error).toMatch(/at most 25/)
    })
  })
})
