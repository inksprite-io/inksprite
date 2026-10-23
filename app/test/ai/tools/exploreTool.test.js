import { describe, it, expect } from 'vitest'
import { toolGroupOf, getToolTimeout } from '@/ai/tools/index.js'

describe('explore_documents among the tools', () => {
  it('is a document tool, given hours', () => {
    expect(toolGroupOf('explore_documents')).toBe('documents')
    expect(getToolTimeout('explore_documents')).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })
})
