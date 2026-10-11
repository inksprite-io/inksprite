import { describe, it, expect } from 'vitest'
import { changedSinceRead, readInView, readsInView, textHash } from '@/ai/context/reads.js'

/**
 * An assistant turn that read these documents, each `[callId, id, path, text, args]`.
 * Marked as keeping its document calls unless told otherwise.
 */
const turn = (id, reads, { kept = true, mark = 'documentCallsKept' } = {}) => ({
  id,
  role: 'assistant',
  content: 'Read.',
  metadata: {
    ...(kept ? { [mark]: true } : {}),
    apiTrajectory: reads.flatMap(([callId, doc, path, text, args = {}]) => [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: { name: 'read_document', arguments: JSON.stringify({ path, ...args }) },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: callId,
        content: '{}',
        _document: doc,
        _path: path,
        _hash: textHash(text),
      },
    ]),
  },
})

const summary = id => ({
  id,
  role: 'assistant',
  content: '',
  metadata: { command: { name: 'compact', input: '', result: 'Summary.', keep: 0 } },
})

const opening = { id: 'o', role: 'user', content: 'opening' }

describe('textHash', () => {
  it('tells two texts apart, and the same text the same', () => {
    expect(textHash('A knight.')).toBe(textHash('A knight.'))
    expect(textHash('A knight.')).not.toBe(textHash('A knight!'))
    expect(textHash('')).toBe(textHash(''))
  })
})

describe('readsInView', () => {
  it('finds the reads of marked turns, with what each asked for', () => {
    const reads = readsInView([
      turn('m1', [['c1', 'd1', 'Notes/Elara', 'A knight.', { section: 'past' }]]),
    ])

    expect(reads).toEqual([
      {
        id: 'd1',
        path: 'Notes/Elara',
        hash: textHash('A knight.'),
        args: { path: 'Notes/Elara', section: 'past' },
      },
    ])
  })

  it('finds the reads of a turn that keeps every call', () => {
    const found = readsInView([
      turn('m1', [['c1', 'd1', 'Notes/Elara', 'x']], { mark: 'callsKept' }),
    ])

    expect(found.map(one => one.id)).toEqual(['d1'])
  })

  it('leaves out a turn from before document calls stayed', () => {
    expect(readsInView([turn('m1', [['c1', 'd1', 'Notes/Elara', 'x']], { kept: false })])).toEqual(
      []
    )
  })

  it('leaves out what a summary stands in for', () => {
    const chat = [opening, turn('m1', [['c1', 'd1', 'Notes/Elara', 'x']]), summary('s')]

    expect(readsInView(chat)).toEqual([])
  })
})

describe('readInView', () => {
  const chat = [turn('m1', [['c1', 'd1', 'Notes/Elara', 'A knight.', { section: 'Past' }]])]

  it('is the same part of the same text', () => {
    expect(readInView(chat, 'd1', { section: 'past' }, textHash('A knight.'))).toBe(true)
  })

  it('is not another part, another text, or another document', () => {
    expect(readInView(chat, 'd1', {}, textHash('A knight.'))).toBe(false)
    expect(readInView(chat, 'd1', { section: 'past' }, textHash('A queen.'))).toBe(false)
    expect(readInView(chat, 'd2', { section: 'past' }, textHash('A knight.'))).toBe(false)
  })
})

describe('changedSinceRead', () => {
  const locateFrom = docs => id => docs[id] || null

  it('says what was edited, moved, or is gone, by the path it was read at', () => {
    const chat = [
      turn('m1', [
        ['c1', 'same', 'Notes/Same', 'Still.'],
        ['c2', 'edited', 'Notes/Edited', 'Before.'],
        ['c3', 'moved', 'Notes/Moved', 'Here.'],
        ['c4', 'both', 'Notes/Both', 'Before.'],
        ['c5', 'gone', 'Notes/Gone', 'Bye.'],
      ]),
    ]
    const locate = locateFrom({
      same: { path: 'Notes/Same', text: 'Still.' },
      edited: { path: 'Notes/Edited', text: 'After.' },
      moved: { path: 'Old/Moved', text: 'Here.' },
      both: { path: 'Old/Both', text: 'After.' },
    })

    expect(changedSinceRead(chat, locate)).toEqual([
      { path: 'Notes/Edited', since: 'edited' },
      { path: 'Notes/Moved', since: 'moved to Old/Moved' },
      { path: 'Notes/Both', since: 'moved to Old/Both and edited' },
      { path: 'Notes/Gone', since: 'deleted or hidden' },
    ])
  })

  it('goes by the latest read of each document', () => {
    const chat = [
      turn('m1', [['c1', 'd1', 'Notes/Elara', 'Before.']]),
      turn('m2', [['c2', 'd1', 'Notes/Elara', 'After.']]),
    ]

    expect(
      changedSinceRead(chat, locateFrom({ d1: { path: 'Notes/Elara', text: 'After.' } }))
    ).toEqual([])
  })

  it('says nothing of a read a summary stands in for', () => {
    const chat = [opening, turn('m1', [['c1', 'd1', 'Notes/Elara', 'Before.']]), summary('s')]

    expect(changedSinceRead(chat, () => null)).toEqual([])
  })
})
