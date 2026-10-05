import { describe, it, expect } from 'vitest'
import {
  carriedLoads,
  droppedFrom,
  droppedSkills,
  loadedSkills,
  loadsIn,
} from '@/ai/skills/loads.js'

/** An assistant turn whose calls to use_skill got these results. */
const turn = (id, calls) => ({
  id,
  role: 'assistant',
  content: 'Noted.',
  metadata: {
    usage: { requests: 1 },
    apiTrajectory: calls.flatMap(({ callId, args, result, extra = {} }) => [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: { name: 'use_skill', arguments: JSON.stringify(args) },
          },
        ],
      },
      { role: 'tool', tool_call_id: callId, content: JSON.stringify(result), ...extra },
    ]),
  },
})

const load = (callId, name, extra) => ({
  callId,
  args: { name },
  result: { name, instructions: `Follow ${name}.` },
  extra,
})

/** The writer's turn, loading `name` by its command. */
const typed = (id, name, extra = {}) => ({
  id,
  role: 'user',
  content: `<${name}>\nFollow ${name}.\n</${name}>\n\nAnd go on.`,
  segments: [
    {
      type: 'command',
      command: { name, input: '', prompt: true, load: true, result: `Follow ${name}.`, ...extra },
    },
    { type: 'text', content: 'And go on.' },
  ],
})

const summary = id => ({
  id,
  role: 'assistant',
  content: '',
  metadata: { command: { name: 'compact', input: '', result: 'Summary.', keep: 0 } },
})

describe('loadsIn', () => {
  it('finds the model’s loads on its turn', () => {
    const loads = loadsIn(turn('m1', [load('L1', 'house-style')]))

    expect(loads).toHaveLength(1)
    expect(loads[0]).toMatchObject({ name: 'house-style', by: 'model', dropped: false })
    expect(loads[0].call.id).toBe('L1')
  })

  it('finds the writer’s loads in their turn', () => {
    expect(loadsIn(typed('m1', 'tighten'))).toMatchObject([
      { name: 'tighten', by: 'writer', index: 0, dropped: false },
    ])
  })

  it('does not count a file read, a skill already loaded, or one that failed', () => {
    const loads = loadsIn(
      turn('m1', [
        { callId: 'F', args: { name: 'a', file: 'x.md' }, result: { name: 'a', content: 'x' } },
        { callId: 'A', args: { name: 'b' }, result: { name: 'b', loaded: 'Already loaded.' } },
        { callId: 'E', args: { name: 'c' }, result: { error: 'No such skill.' } },
      ])
    )

    expect(loads).toEqual([])
  })

  it('does not count a saved prompt that is not a load', () => {
    const message = typed('m1', 'tighten')
    delete message.segments[0].command.load

    expect(loadsIn(message)).toEqual([])
  })
})

describe('loadedSkills', () => {
  it('names each live load once, in the order they were first loaded', () => {
    const chat = [
      turn('m1', [load('L1', 'house-style')]),
      typed('m2', 'tighten'),
      turn('m3', [load('L2', 'house-style')]),
    ]

    expect(loadedSkills(chat)).toEqual(['house-style', 'tighten'])
  })

  it('keeps what was dropped until a summary stands in for it', () => {
    const chat = [
      { id: 'o', role: 'user', content: 'opening' },
      turn('m1', [load('L1', 'house-style', { _dropped: true })]),
      typed('m2', 'tighten', { dropped: true }),
    ]

    expect(loadedSkills(chat)).toEqual(['house-style', 'tighten'])
    expect(loadedSkills([...chat, summary('s')])).toEqual([])
  })

  it('keeps what a summary carries, and a dropped skill loaded again', () => {
    const chat = [
      { id: 'o', role: 'user', content: 'opening' },
      turn('m1', [load('L1', 'a'), load('L2', 'b', { _dropped: true })]),
      summary('s'),
      turn('m2', [load('L3', 'b')]),
    ]

    expect(loadedSkills(chat)).toEqual(['a', 'b'])
  })
})

describe('droppedSkills', () => {
  it('names what is dropped and still read, which goes at the next summary', () => {
    const chat = [
      { id: 'o', role: 'user', content: 'opening' },
      turn('m1', [load('L1', 'a'), load('L2', 'b', { _dropped: true })]),
      typed('m2', 'tighten', { dropped: true }),
    ]

    expect(droppedSkills(chat)).toEqual(['b', 'tighten'])
  })

  it('leaves out one loaded again since, and one a summary has already let go', () => {
    const chat = [
      { id: 'o', role: 'user', content: 'opening' },
      turn('m1', [load('L1', 'a', { _dropped: true })]),
      summary('s'),
      typed('m2', 'tighten', { dropped: true }),
      typed('m3', 'tighten'),
    ]

    expect(droppedSkills(chat)).toEqual([])
  })
})

describe('carriedLoads', () => {
  it('is nothing for a chat with no summary', () => {
    expect(
      carriedLoads([{ id: 'o', role: 'user', content: 'hi' }, turn('m1', [load('L1', 'a')])])
    ).toEqual([])
  })

  it('carries what the summary stands in for, the latest of each', () => {
    const chat = [
      { id: 'o', role: 'user', content: 'opening' },
      turn('m1', [load('L1', 'a')]),
      turn('m2', [load('L2', 'b'), load('L3', 'a')]),
      summary('s'),
    ]

    expect(carriedLoads(chat).map(one => one.call.id)).toEqual(['L2', 'L3'])
  })

  it('leaves what is loaded again below it, and what was dropped', () => {
    const chat = [
      { id: 'o', role: 'user', content: 'opening' },
      turn('m1', [load('L1', 'a'), load('L2', 'b', { _dropped: true })]),
      typed('m2', 'c'),
      summary('s'),
      turn('m3', [load('L3', 'a')]),
    ]

    expect(carriedLoads(chat).map(one => one.name)).toEqual(['c'])
  })

  it('does not carry the opening, which is read where it is', () => {
    const chat = [turn('o', [load('L1', 'a')]), summary('s')]

    expect(carriedLoads(chat)).toEqual([])
  })
})

describe('droppedFrom', () => {
  it('marks the model’s loads of the skill, and nothing else', () => {
    const message = turn('m1', [
      load('L1', 'a'),
      { callId: 'F', args: { name: 'a', file: 'x.md' }, result: { name: 'a', content: 'x' } },
      load('L2', 'b'),
    ])

    const patch = droppedFrom(message, 'a')

    const dropped = patch.metadata.apiTrajectory
      .filter(item => item.role === 'tool' && item._dropped)
      .map(item => item.tool_call_id)
    expect(dropped).toEqual(['L1'])
    // The rest of the message's metadata is kept, since it is written whole.
    expect(patch.metadata.usage).toEqual({ requests: 1 })
  })

  it('marks the writer’s line, leaving their other words', () => {
    const patch = droppedFrom(typed('m1', 'tighten'), 'tighten')

    expect(patch.segments[0].command.dropped).toBe(true)
    expect(patch.segments[1]).toEqual({ type: 'text', content: 'And go on.' })
  })

  it('is nothing for a message without the skill, or one already dropped', () => {
    expect(droppedFrom(turn('m1', [load('L1', 'b')]), 'a')).toBeNull()
    expect(droppedFrom(typed('m1', 'tighten', { dropped: true }), 'tighten')).toBeNull()
    expect(droppedFrom({ id: 'x', role: 'assistant', content: 'hi' }, 'a')).toBeNull()
  })
})
