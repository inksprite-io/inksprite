/* global DOMException */
import { describe, it, expect } from 'vitest'
import { CloudError } from '@/cloud/api.js'
import { createDiagnostics, errorTag } from '@/cloud/diagnostics.js'

describe('diagnostics', () => {
  it('reports what was counted since the last report, and nothing when nothing was', () => {
    let clock = 1000
    const diagnostics = createDiagnostics({ now: () => clock })
    expect(diagnostics.take({ app: 'x' })).toBeNull()
    diagnostics.count('rounds')
    diagnostics.count('rounds')
    diagnostics.count('pushed', 0)
    diagnostics.error('offline')
    diagnostics.took(120.4)
    diagnostics.took(80)
    diagnostics.outbox(3, 5000)
    diagnostics.outbox(1, 200)
    clock = 9000
    expect(diagnostics.take({ app: 'x' })).toEqual({
      v: 1,
      app: 'x',
      from: 1000,
      to: 9000,
      counts: { rounds: 2 },
      errors: { offline: 1 },
      timing: { roundMsMax: 120, roundMsTotal: 200 },
      outbox: { most: 3, oldestMs: 5000 },
    })
    expect(diagnostics.take({ app: 'x' })).toBeNull()
  })

  it('tags an error by its kind, never by its message', () => {
    expect(errorTag(new CloudError('The sync server at x can’t be reached.', 0))).toBe('offline')
    expect(errorTag(new CloudError('Full', 507))).toBe('http:507')
    expect(errorTag(new DOMException('bad tag', 'OperationError'))).toBe('decrypt')
    expect(errorTag(new TypeError('Chapter 3 is missing'))).toBe('TypeError')
    expect(errorTag({ name: 'a name with spaces' })).toBe('other')
    expect(errorTag(null)).toBe('other')
  })
})
