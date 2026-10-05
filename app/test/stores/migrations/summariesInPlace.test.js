import { describe, it, expect } from 'vitest'
import { summariesIntoPlace } from '@/stores/migrations/summariesInPlace.js'
import { applyCompaction } from '@/ai/compaction.js'

/** An ordinary message, written at `created`. */
const said = (id, created, extra = {}) => ({
  id,
  chatId: 'chat_1',
  role: 'user',
  content: id,
  created,
  ...extra,
})

/** A summary as schema 14 stored it: where it was asked for, counting what it kept. */
const summary = (id, created, keep, extra = {}) =>
  said(id, created, {
    role: 'assistant',
    content: 'They crossed.',
    metadata: { command: { name: 'compact', input: '', keep, result: 'They crossed.' } },
    ...extra,
  })

/** A chat's rows after the migration, in the order they would now be read. */
const after = rows => {
  const { messages: changed } = summariesIntoPlace(rows)
  const byId = new Map(changed.map(row => [row.id, row]))
  return rows.map(row => byId.get(row.id) || row).sort((a, b) => a.created - b.created)
}
const ids = rows => rows.map(row => row.id)

describe('summariesIntoPlace', () => {
  it('moves a summary above the turns it kept', () => {
    const rows = [said('a', 10), said('b', 20), said('c', 30), said('d', 40), summary('s', 50, 2)]

    expect(ids(after(rows))).toEqual(['a', 'b', 's', 'c', 'd'])
  })

  it('gives it a time between its neighbours, and changes no other row', () => {
    const rows = [said('a', 10), said('b', 20), said('c', 30), said('d', 40), summary('s', 50, 2)]

    const { messages: changed, moved } = summariesIntoPlace(rows)

    expect(moved).toBe(1)
    expect(changed.map(row => row.id)).toEqual(['s'])
    expect(changed[0].created).toBeGreaterThan(20)
    expect(changed[0].created).toBeLessThan(30)
    // Everything else about it is as it was.
    expect(changed[0].metadata).toEqual(rows[4].metadata)
  })

  it('is read afterwards as it was read before: the summary, then what it kept', () => {
    const rows = [said('a', 10), said('b', 20), said('c', 30), said('d', 40), summary('s', 50, 2)]

    // The opening comes back, which is the change every chat gets; the rest is
    // what schema 14 sent.
    expect(ids(applyCompaction(after(rows)))).toEqual(['a', 's', 'c', 'd'])
  })

  it('leaves what came after the summary after it', () => {
    const rows = [
      said('a', 10),
      said('b', 20),
      said('c', 30),
      summary('s', 40, 1),
      said('d', 50),
      said('e', 60),
    ]

    expect(ids(after(rows))).toEqual(['a', 'b', 's', 'c', 'd', 'e'])
  })

  it('leaves alone a summary that kept nothing: it is where it is read already', () => {
    const rows = [said('a', 10), said('b', 20), summary('s', 30, 0), said('c', 40)]

    expect(summariesIntoPlace(rows)).toEqual({ messages: [], moved: 0 })
  })

  it('puts one that stood for nothing under the opening, where it still stands for nothing', () => {
    // It kept more than there was. Left at the end it would now stand for the
    // whole chat, which it never did.
    const rows = [said('a', 10), said('b', 20), said('c', 30), summary('s', 40, 8)]

    const placed = after(rows)

    expect(ids(placed)).toEqual(['a', 's', 'b', 'c'])
    expect(ids(applyCompaction(placed))).toEqual(['a', 's', 'b', 'c'])
  })

  it('leaves a summary that failed, or is still being written, where it is', () => {
    const failed = summary('s', 50, 2)
    failed.metadata.command.result = ''
    const rows = [said('a', 10), said('b', 20), said('c', 30), said('d', 40), failed]

    expect(summariesIntoPlace(rows).moved).toBe(0)
  })

  it('moves every summary of a chat compacted more than once', () => {
    const rows = [
      said('a', 10),
      said('b', 20),
      said('c', 30),
      summary('s1', 40, 1),
      said('d', 50),
      said('e', 60),
      summary('s2', 70, 1),
    ]

    const placed = after(rows)

    expect(ids(placed)).toEqual(['a', 'b', 's1', 'c', 'd', 's2', 'e'])
  })

  it('keeps two summaries in the order they were written when they land together', () => {
    const rows = [
      said('a', 10),
      said('b', 20),
      said('c', 30),
      summary('s1', 40, 1),
      summary('s2', 50, 2),
    ]

    const placed = after(rows)

    expect(ids(placed)).toEqual(['a', 'b', 's1', 's2', 'c'])
    expect(new Set(placed.map(row => row.created)).size).toBe(placed.length)
  })

  it('does not count deleted messages among the turns a summary kept', () => {
    const rows = [
      said('a', 10),
      said('b', 20),
      said('c', 30),
      said('gone', 35, { deleted: true }),
      said('d', 40),
      summary('s', 50, 2),
    ]

    const placed = after(rows).filter(row => !row.deleted)

    expect(ids(placed)).toEqual(['a', 'b', 's', 'c', 'd'])
  })

  it('keeps each chat to itself', () => {
    const rows = [
      said('a', 10),
      said('b', 20),
      said('c', 30),
      summary('s', 40, 1),
      said('x', 15, { chatId: 'chat_2' }),
      said('y', 25, { chatId: 'chat_2' }),
    ]

    const { messages: changed } = summariesIntoPlace(rows)

    expect(changed.map(row => row.id)).toEqual(['s'])
    expect(changed[0].created).toBeGreaterThan(20)
    expect(changed[0].created).toBeLessThan(30)
  })

  it('does nothing to a database with no summaries in it', () => {
    expect(summariesIntoPlace([said('a', 10), said('b', 20)])).toEqual({ messages: [], moved: 0 })
    expect(summariesIntoPlace([])).toEqual({ messages: [], moved: 0 })
  })
})
