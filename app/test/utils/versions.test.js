import { describe, it, expect } from 'vitest'
import { thinned } from '@/utils/versions.js'

const DAY = 24 * 60 * 60_000
const HOUR = 60 * 60_000

/** @returns {any} */
const version = (id, at, extra = {}) => ({ id, documentId: 'doc_1', at, ...extra })

describe('thinned', () => {
  // A Wednesday at noon, by the clock here.
  const now = new Date(2026, 9, 21, 12).getTime()

  it('keeps every version from the last day', () => {
    const versions = [1, 2, 3, 20].map(h => version(`v${h}`, now - h * HOUR))
    expect(thinned(versions, now)).toEqual([])
  })

  it('keeps the newest of each day for a month', () => {
    const yesterdayEvening = new Date(2026, 9, 20, 0, 30).getTime()
    const versions = [
      version('late', new Date(2026, 9, 19, 22).getTime()),
      version('early', new Date(2026, 9, 19, 8).getTime()),
      version('kept', yesterdayEvening),
    ]
    expect(thinned(versions, now)).toEqual(['early'])
  })

  it('keeps the newest of each week after that', () => {
    const versions = [
      // Two in one week, two months back: a Thursday and the Monday before it.
      version('thursday', new Date(2026, 7, 13, 10).getTime()),
      version('monday', new Date(2026, 7, 10, 10).getTime()),
      // The Sunday before is another week.
      version('sunday', new Date(2026, 7, 9, 10).getTime()),
    ]
    expect(thinned(versions, now)).toEqual(['monday'])
  })

  it('keeps a named version, whatever its age, without its taking a day’s place', () => {
    const versions = [
      version('named', now - 40 * DAY, { name: 'First draft' }),
      version('same week', now - 40 * DAY - HOUR),
    ]
    expect(thinned(versions, now)).toEqual([])
  })
})
