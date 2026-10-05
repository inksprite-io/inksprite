import { describe, it, expect } from 'vitest'
import { foldRuns } from '../../../src/stores/migrations/turnRuns.js'

const message = (id, role, content, extra = {}) => ({
  id,
  chatId: 'chat_1',
  role,
  content,
  created: Number(id.replace(/\D/g, '')),
  version: 1,
  ...extra,
})

/** A turn of the writer's as version 11 left it: its pieces, and their assembly. */
const turn = (id, ...pieces) =>
  message(
    id,
    'user',
    pieces.map(piece => (typeof piece === 'string' ? piece : piece.content)).join('\n\n'),
    {
      segments: pieces.map(piece =>
        typeof piece === 'string' ? { type: 'text', content: piece } : piece
      ),
    }
  )

const oracle = { type: 'command', command: { name: 'oracle', input: 'Locked?', result: 'no' } }
oracle.content = '<oracle>\nLocked?\nno\n</oracle>'

const summary = (id, keep) =>
  message(id, 'assistant', 'They crossed.', {
    metadata: { command: { name: 'compact', input: '', keep, result: 'They crossed.' } },
  })

/** The chat as it reads, which is by creation time. */
const history = out => [...out].sort((a, b) => a.created - b.created)

describe('foldRuns', () => {
  it('folds a run of the writer’s turns into the one turn it is', () => {
    const { messages, folded } = foldRuns([
      turn('m1', 'I try the door.'),
      turn('m2', oracle),
      message('m3', 'assistant', 'It does not move.'),
    ])

    const out = history(messages)
    expect(out.map(each => each.id)).toEqual(['m1', 'm3'])
    expect(out[0].segments).toEqual([{ type: 'text', content: 'I try the door.' }, oracle])
    expect(folded).toBe(1)
  })

  it('sends exactly what the run was already being sent as', () => {
    const { messages } = foldRuns([turn('m1', 'I try the door.'), turn('m2', oracle)])

    expect(history(messages)[0].content).toBe('I try the door.\n\n<oracle>\nLocked?\nno\n</oracle>')
  })

  it('keeps the turns either side of somebody else speaking apart', () => {
    const { messages, folded } = foldRuns([
      turn('m1', 'I try the door.'),
      message('m2', 'assistant', 'It gives.'),
      turn('m3', 'I step through.'),
    ])

    expect(history(messages).map(each => each.id)).toEqual(['m1', 'm2', 'm3'])
    expect(folded).toBe(0)
  })

  it('leaves a run of somebody else’s alone', () => {
    // Two replies in a row are two things a model did, each with its own
    // record of how; there is nothing lossless to fold them into.
    const { messages } = foldRuns([
      message('m1', 'assistant', 'It gives.'),
      message('m2', 'assistant', 'Beyond it, dark.'),
    ])

    expect(history(messages)).toHaveLength(2)
  })

  it('never folds across the point where a summary takes over', () => {
    // m1 is what the summary stands for; m2 is kept. One message half under
    // a summary is not a thing a chat can be in.
    const { messages, folded } = foldRuns([
      turn('m1', 'I try the door.'),
      turn('m2', 'I step through.'),
      summary('m3', 1),
    ])

    expect(history(messages).map(each => each.id)).toEqual(['m1', 'm2', 'm3'])
    expect(folded).toBe(0)
  })

  it('counts a summary down for what folded among the messages it left alone', () => {
    // The summary stood for m1. It counts kept messages by position, and two
    // of them have just become one.
    const { messages } = foldRuns([
      turn('m1', 'Once upon a time.'),
      message('m2', 'assistant', 'It gives.'),
      turn('m3', 'I step through.'),
      turn('m4', 'Nothing moves.'),
      summary('m5', 3),
    ])

    const out = history(messages)
    expect(out.map(each => each.id)).toEqual(['m1', 'm2', 'm3', 'm5'])
    expect(out[3].metadata.command.keep).toBe(2)
  })

  it('leaves a summary alone when the fold was among what it stands for', () => {
    const { messages } = foldRuns([
      turn('m1', 'Once upon a time.'),
      turn('m2', 'Long ago.'),
      message('m3', 'assistant', 'It gives.'),
      summary('m4', 1),
    ])

    const out = history(messages)
    expect(out.map(each => each.id)).toEqual(['m1', 'm3', 'm4'])
    expect(out[2].metadata.command.keep).toBe(1)
  })

  it('remembers that a turn had been edited', () => {
    const { messages } = foldRuns([
      turn('m1', 'I try the door.'),
      { ...turn('m2', 'I step through.'), edited: true },
    ])

    expect(history(messages)[0].edited).toBe(true)
  })

  it('takes a message that carries no pieces as one piece', () => {
    const { messages } = foldRuns([
      turn('m1', 'I try the door.'),
      message('m2', 'user', 'I step through.'),
    ])

    expect(history(messages)[0].segments).toEqual([
      { type: 'text', content: 'I try the door.' },
      { type: 'text', content: 'I step through.' },
    ])
  })

  it('leaves a deleted message where it is', () => {
    const gone = { ...turn('m2', 'never mind'), deleted: true }
    const { messages } = foldRuns([turn('m1', 'I try the door.'), gone, turn('m3', 'And on.')])

    expect(messages).toContain(gone)
    expect(history(messages).map(each => each.id)).toEqual(['m1', 'm2'])
  })

  it('keeps the chats apart', () => {
    const { messages } = foldRuns([turn('m1', 'one'), { ...turn('m2', 'two'), chatId: 'chat_2' }])

    expect(messages).toHaveLength(2)
  })

  it('tolerates empty and missing input', () => {
    expect(foldRuns([])).toEqual({ messages: [], folded: 0 })
    expect(foldRuns(null)).toEqual({ messages: [], folded: 0 })
  })
})
