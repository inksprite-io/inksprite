import { describe, it, expect } from 'vitest'
import { foldTurns } from '../../../src/stores/migrations/turnSegments.js'

const message = (id, role, content, extra = {}) => ({
  id,
  chatId: 'chat_1',
  role,
  content,
  created: Number(id.replace(/\D/g, '')),
  version: 1,
  ...extra,
})

const command = (id, name, record) =>
  message(id, 'user', record.result || '', { metadata: { command: { name, ...record } } })

/** The chat as it reads, which is by creation time. */
const history = out => [...out].sort((a, b) => a.created - b.created)

describe('foldTurns', () => {
  it('folds a run of the writer’s messages into the one turn it was', () => {
    const { messages, folded } = foldTurns([
      command('m1', 'cody', { input: 'I hide.', result: 'I hide.', character: true }),
      message('m2', 'user', 'The closet smells of cedar.'),
      command('m3', 'oracle', { input: 'Locked?', label: 'Locked?', result: 'no' }),
      message('m4', 'assistant', 'The door does not move.'),
    ])

    const out = history(messages)
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('m1')
    expect(out[0].segments.map(segment => segment.type)).toEqual(['command', 'text', 'command'])
    expect(out[1].content).toBe('The door does not move.')
    expect(folded).toBe(1)
  })

  it('sends exactly what the run was already being sent as', () => {
    // The whole point: the request does not change, only where the pieces of
    // the turn are kept.
    const { messages } = foldTurns([
      command('m1', 'cody', { input: 'I hide.', result: 'I hide.', character: true }),
      message('m2', 'user', 'The closet smells of cedar.'),
      command('m3', 'oracle', { input: 'Locked?', label: 'Locked?', result: 'no' }),
    ])

    expect(history(messages)[0].content).toBe(
      '<cody>\nI hide.\n</cody>\n\nThe closet smells of cedar.\n\n<oracle>\nLocked?\nno\n</oracle>'
    )
  })

  it('calls a summary what a summary was called', () => {
    // `/compact` is an instruction; what landed in the conversation was a
    // summary, and that is the tag it was sent under.
    const { messages } = foldTurns([
      command('m1', 'compact', { input: '', keep: 4, result: 'They crossed the pass.' }),
    ])

    expect(history(messages)[0].content).toBe('<summary>\nThey crossed the pass.\n</summary>')
  })

  it('keeps the turns either side of somebody else speaking apart', () => {
    const { messages } = foldTurns([
      message('m1', 'user', 'I try the door.'),
      message('m2', 'assistant', 'It gives.'),
      message('m3', 'user', 'I step through.'),
    ])

    const out = history(messages)
    expect(out.map(each => each.id)).toEqual(['m1', 'm2', 'm3'])
    expect(out[1].segments).toBeUndefined()
  })

  it('leaves a turn that has already been folded alone', () => {
    const already = message('m1', 'user', 'I try the door.', {
      segments: [{ type: 'text', content: 'I try the door.' }],
    })
    const { messages, folded } = foldTurns([already, message('m2', 'user', 'And again.')])

    // Neither folded again, nor swept into the run beside it.
    expect(history(messages)).toHaveLength(2)
    expect(folded).toBe(0)
  })

  it('leaves a deleted message where it is', () => {
    const gone = message('m2', 'user', 'never mind', { deleted: true })
    const { messages } = foldTurns([message('m1', 'user', 'I try the door.'), gone])

    expect(messages).toContain(gone)
    expect(messages.find(each => each.id === 'm1').segments).toHaveLength(1)
  })

  it('keeps the chats apart', () => {
    const { messages } = foldTurns([
      message('m1', 'user', 'one'),
      { ...message('m2', 'user', 'two'), chatId: 'chat_2' },
    ])

    expect(messages).toHaveLength(2)
    expect(messages.every(each => each.segments.length === 1)).toBe(true)
  })

  it('tolerates empty and missing input', () => {
    expect(foldTurns([])).toEqual({ messages: [], folded: 0 })
    expect(foldTurns(null)).toEqual({ messages: [], folded: 0 })
  })
})
