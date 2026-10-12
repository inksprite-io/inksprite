import { describe, it, expect } from 'vitest'
import { compareNames } from '@/utils/compareNames.js'

describe('compareNames', () => {
  it('reads runs of digits as numbers', () => {
    expect(['Chapter 10', 'Chapter 2', 'Chapter 1'].sort(compareNames)).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Chapter 10',
    ])
  })

  it('sorts version-like names by each number', () => {
    expect(['v1.10', 'v1.9', 'v1.2'].sort(compareNames)).toEqual(['v1.2', 'v1.9', 'v1.10'])
  })

  it('still sorts words alphabetically', () => {
    expect(['Notes', 'drafts', 'Archive'].sort(compareNames)).toEqual([
      'Archive',
      'drafts',
      'Notes',
    ])
  })
})
