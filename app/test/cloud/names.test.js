import { describe, it, expect } from 'vitest'
import { nameProblem } from '@/cloud/names.js'

describe('a sync account name', () => {
  it('is 3 to 30 of the letters a to z, digits and hyphens', () => {
    for (const name of ['abc', 'Colin', 'colin-h', 'a1-b2', 'x'.repeat(30)]) {
      expect(nameProblem(name), name).toBeNull()
    }
    expect(nameProblem('ab')).toBe('Use a name of at least 3 characters.')
    expect(nameProblem('x'.repeat(31))).toBe('Use a name of at most 30 characters.')
    for (const name of ['colin_h', 'josé', 'col in']) {
      expect(nameProblem(name), name).toBe(
        'Use only the letters a to z, digits and hyphens in a name.'
      )
    }
  })

  it('has a hyphen only between two letters or digits', () => {
    for (const name of ['-colin', 'colin-', 'colin--h']) {
      expect(nameProblem(name), name).toBe(
        'Put each hyphen in a name between two letters or digits.'
      )
    }
  })
})
