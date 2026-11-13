import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_KEEP,
  KEPT_OPENING,
  applyCompaction,
  compactionCover,
  firstSummarizable,
  isCompacting,
  isCompaction,
  parseKeep,
} from '@/ai/compaction.js'
import { askCompact, buildCompactPrompt, unwrapSummary } from '@/ai/skills/compact/index.js'

/** A message that is a finished summary. */
const summary = (id, content = 'They crossed the pass.') => ({
  id,
  role: 'assistant',
  content,
  metadata: { command: { name: 'compact', input: '', result: content, keep: 4 } },
})

/** Any ordinary turn. */
const turn = (id, role = 'user') => ({ id, role, content: id })

const ids = (/** @type {any[]} */ messages) => messages.map(m => m.id)

describe('parseKeep', () => {
  it('keeps no tail by default', () => {
    expect(parseKeep()).toBe(DEFAULT_KEEP)
    expect(parseKeep('')).toBe(DEFAULT_KEEP)
    expect(DEFAULT_KEEP).toBe(0)
  })

  it('takes the number the writer typed, zero included', () => {
    expect(parseKeep('6')).toBe(6)
    expect(parseKeep('0')).toBe(0)
  })

  it('refuses what is not a count, a pair of them included', () => {
    expect(parseKeep('lots')).toBeNull()
    expect(parseKeep('-2')).toBeNull()
    expect(parseKeep('2.5')).toBeNull()
    expect(parseKeep('1, 3')).toBeNull()
  })
})

describe('isCompacting', () => {
  const asked = (command = {}) => ({
    id: 'm1',
    role: 'assistant',
    content: '',
    streamingStartTime: 10,
    metadata: { command: { name: 'compact', input: '', keep: 4, result: '', ...command } },
  })

  it('knows a summary that has been asked for and not answered', () => {
    expect(isCompacting(asked({ pending: true }))).toBe(true)
    // Partway through: what has arrived so far is on the record already.
    expect(isCompacting(asked({ pending: true, result: 'They crossed' }))).toBe(true)
  })

  it('is not one that finished, or failed', () => {
    // Its record says which, whatever its clock says: a summary that failed
    // halfway never finished streaming either.
    expect(isCompacting(summary('m1'))).toBe(false)
    expect(isCompacting(asked({ error: 'Request failed' }))).toBe(false)
  })

  it('is not anything else being written', () => {
    const reply = { id: 'm1', role: 'assistant', content: 'The door', streamingStartTime: 10 }
    const oracle = { name: 'oracle', input: 'Is it locked?', pending: true }

    expect(isCompacting(reply)).toBe(false)
    expect(isCompacting({ ...reply, metadata: { command: oracle } })).toBe(false)
    expect(isCompacting(null)).toBe(false)
  })
})

describe('isCompaction', () => {
  it('knows a finished summary', () => {
    expect(isCompaction(summary('m1'))).toBe(true)
  })

  it('is not any other message', () => {
    expect(isCompaction(turn('m1'))).toBe(false)
    expect(
      isCompaction({ id: 'm1', content: 'yes', metadata: { command: { name: 'oracle' } } })
    ).toBe(false)
    expect(isCompaction(null)).toBe(false)
  })

  it('is not a summary that has nothing to stand in with', () => {
    // Pending, or failed. Dropping forty turns in favour of an empty block
    // would lose the conversation to a request that did not come back.
    const asked = { name: 'compact', input: '', keep: 4, result: '' }

    expect(isCompaction({ id: 'm1', content: '', metadata: { command: asked } })).toBe(false)
    expect(
      isCompaction({
        id: 'm1',
        content: '',
        metadata: { command: { ...asked, error: 'the endpoint is down' } },
      })
    ).toBe(false)
  })
})

describe('compactionCover', () => {
  it('covers nothing in a conversation nobody has compacted', () => {
    expect(compactionCover([turn('a'), turn('b')]).size).toBe(0)
    expect(compactionCover([]).size).toBe(0)
  })

  it('covers what is above the summary, and nothing at or below it', () => {
    // The summary sits where it is read: above the turns that were kept.
    const history = [turn('a'), turn('b'), turn('c'), summary('s'), turn('d'), turn('e')]

    expect([...compactionCover(history)]).toEqual([1, 2])
  })

  it('never covers how the conversation opened', () => {
    // A greeting sets voice and format by example. A summary of it says what
    // happened in it, which is the one thing about it that did not matter.
    expect(KEPT_OPENING).toBe(1)
    expect(compactionCover([turn('a'), turn('b'), summary('s')]).has(0)).toBe(false)
  })

  it('leaves standing as much of the top as the summary says it kept', () => {
    // A roleplay chat's opening is two messages. The summary says so, so what
    // it stands for is read off the conversation alone.
    const kept = { ...summary('s'), metadata: { ...summary('s').metadata, opening: 2 } }
    const history = [turn('a'), turn('b'), turn('c'), turn('d'), kept, turn('e')]

    expect([...compactionCover(history)]).toEqual([2, 3])
    expect(ids(applyCompaction(history))).toEqual(['a', 'b', 's', 'e'])
  })

  it('goes by the newest summary’s opening, whatever one before it kept', () => {
    const two = { ...summary('s1'), metadata: { ...summary('s1').metadata, opening: 2 } }
    const history = [turn('a'), turn('b'), turn('c'), two, turn('d'), summary('s2')]

    expect([...compactionCover(history)]).toEqual([1, 2, 3, 4])
  })

  it('covers the summaries before the newest, which it was written from', () => {
    const history = [
      turn('a'),
      turn('b'),
      summary('s1'),
      turn('c'),
      turn('d'),
      summary('s2'),
      turn('e'),
    ]

    // b went to s1, and s1, c and d to s2: one account of the past, not two.
    expect([...compactionCover(history)]).toEqual([1, 2, 3, 4])
  })

  it('goes by the newest summary that has anything to say', () => {
    const failed = {
      id: 's2',
      role: 'assistant',
      content: '',
      metadata: { command: { name: 'compact', input: '', result: '', error: 'down' } },
    }
    const history = [turn('a'), turn('b'), summary('s1'), turn('c'), failed, turn('d')]

    expect([...compactionCover(history)]).toEqual([1])
  })

  it('covers a failed summary like anything else, once a newer one stands above it', () => {
    const failed = {
      id: 'sx',
      role: 'assistant',
      content: '',
      metadata: { command: { name: 'compact', input: '', result: '' } },
    }
    const history = [turn('a'), failed, turn('b'), summary('s'), turn('c')]

    expect([...compactionCover(history)]).toEqual([1, 2])
  })

  it('covers nothing when the summary is all there is above it', () => {
    expect(compactionCover([turn('a'), summary('s'), turn('b')]).size).toBe(0)
    expect(compactionCover([summary('s'), turn('a')]).size).toBe(0)
  })
})

describe('applyCompaction', () => {
  it('reads the opening, the summary, and what comes after it', () => {
    const history = [turn('a'), turn('b'), turn('c'), summary('s'), turn('d'), turn('e')]

    expect(ids(applyCompaction(history))).toEqual(['a', 's', 'd', 'e'])
  })

  it('leaves a conversation nobody compacted exactly as it was', () => {
    const history = [turn('a'), turn('b')]
    expect(applyCompaction(history)).toBe(history)
  })

  it('reads only the newest summary of a game compacted more than once', () => {
    // Each summary is written over the last, so the last is in it already.
    const history = [
      turn('a'),
      turn('b'),
      summary('s1'),
      turn('c'),
      turn('d'),
      summary('s2'),
      turn('e'),
    ]

    expect(ids(applyCompaction(history))).toEqual(['a', 's2', 'e'])
  })

  it('reads nothing differently when an older summary is deleted', () => {
    // s1 is gone. It was not being read, and what it stood for is still above
    // s2 and still unread.
    const history = [turn('a'), turn('b'), turn('c'), turn('d'), summary('s2'), turn('e')]

    expect(ids(applyCompaction(history))).toEqual(['a', 's2', 'e'])
  })

  it('goes back to the summary before a deleted one, and the turns it stood for', () => {
    // s2 is gone: a compaction taken back. s1 is the newest again, and c and d,
    // which only s2 stood for, are read as they were.
    const history = [turn('a'), turn('b'), summary('s1'), turn('c'), turn('d'), turn('e')]

    expect(ids(applyCompaction(history))).toEqual(['a', 's1', 'c', 'd', 'e'])
  })
})

describe('firstSummarizable', () => {
  it('starts below the opening and the turn after it, with nothing compacted', () => {
    expect(firstSummarizable([turn('a'), turn('b'), turn('c')])).toBe(KEPT_OPENING + 1)
  })

  it('leaves a turn between the newest summary and the next one', () => {
    const history = [turn('a'), turn('b'), summary('s1'), turn('c'), summary('s2'), turn('d')]
    expect(firstSummarizable(history)).toBe(6)
    expect(firstSummarizable([...history, turn('e')])).toBe(6)
  })

  it('starts below a longer opening, for a chat that keeps one', () => {
    expect(firstSummarizable([turn('a'), turn('b'), turn('c'), turn('d')], 2)).toBe(3)
  })

  it('is past the end when a summary has nothing to fold in', () => {
    expect(firstSummarizable([turn('a')])).toBe(2)
    expect(firstSummarizable([turn('a'), turn('b'), summary('s1')])).toBe(4)
  })
})

describe('buildCompactPrompt', () => {
  it('says nothing extra when the writer asked for nothing in particular', () => {
    expect(buildCompactPrompt()).toBe(buildCompactPrompt(''))
    expect(buildCompactPrompt()).not.toContain('What this one is for')
  })

  it('puts the writer’s instructions in the prompt, not in the material', () => {
    // A note about how to read the transcript that arrives inside the
    // transcript reads as something a character said.
    const prompt = buildCompactPrompt('  favour the mystery  ')

    expect(prompt).toContain('## What this one is for')
    expect(prompt).toContain('favour the mystery')
  })
})

describe('unwrapSummary', () => {
  it('takes off a summary tag the model put around the whole of it', () => {
    expect(unwrapSummary('<summary>\n## So far\n\nThey ran.\n</summary>\n')).toBe(
      '## So far\n\nThey ran.'
    )
  })

  it('leaves a summary that only mentions the tag', () => {
    const said = 'The <summary> tag is how a summary is sent.\n\nThey ran.'
    expect(unwrapSummary(said)).toBe(said)
    expect(unwrapSummary('They ran.')).toBe('They ran.')
  })

  it('is what Compact answers with', async () => {
    const consult = async () => '<summary>They ran.</summary>'

    expect(await askCompact('', { consult })).toEqual({ answer: 'They ran.' })
  })
})

describe('askCompact', () => {
  it('asks in the thread where it can, with the wording as the last word', async () => {
    const inThread = vi.fn(async () => 'They ran.')
    const consult = vi.fn()

    expect(await askCompact('keep the heist', { inThread, consult }, { past: 4 })).toEqual({
      answer: 'They ran.',
    })

    // Not a transcript under a prompt of its own: the chat's model, with all
    // the conversation holds.
    expect(consult).not.toHaveBeenCalled()
    const [instruction, options] = inThread.mock.calls[0]
    expect(instruction).toMatch(/^\[The user has asked for a summary/)
    expect(instruction).toContain('Summarize this chat')
    expect(instruction).toContain('keep the heist')
    expect(options).toMatchObject({ past: 4 })
  })

  it('asks under the profile’s wording, where it has one', async () => {
    const inThread = vi.fn(async () => 'They ran.')

    await askCompact('', { inThread, promptFor: () => 'Summarize this roleplay.' })

    expect(inThread.mock.calls[0][0]).toContain('Summarize this roleplay.')
    expect(inThread.mock.calls[0][0]).not.toContain('Summarize this chat')
  })

  it('hands a transcript to a context that cannot ask in the thread', async () => {
    const consult = vi.fn(async () => 'They ran.')

    await askCompact('', { consult })

    expect(consult.mock.calls[0][0]).toMatch(/^Summarize this chat/)
  })

  it('says so when there is no conversation to ask about', async () => {
    expect(await askCompact('', {})).toEqual({
      error: 'There is no conversation here to compact.',
    })
  })
})
