import { describe, it, expect, vi } from 'vitest'
import {
  fillArgument,
  offeredToModel,
  writerCalls,
  waitingOn,
  runOnItsOwn,
} from '@/ai/skills/runner.js'
import { parseSkill } from '@/ai/skills/format.js'

/** A skill as its file would have it. */
const skill = (front, body = 'Do it well.') => {
  const read = parseSkill(`---\n${front}\n---\n\n${body}\n`)
  if ('errors' in read) throw new Error(read.errors.join(' | '))
  return read.skill
}

describe('fillArgument', () => {
  it('puts what was typed where $ARGUMENTS is, as Claude Code’s files write it', () => {
    expect(fillArgument('Tighten $ARGUMENTS by a third.', null, 'the fight')).toBe(
      'Tighten the fight by a third.'
    )
  })

  it('puts it where the skill’s own name for it is, too', () => {
    expect(fillArgument('Notes on $scene, then on $ARGUMENTS.', 'scene', 'the chase')).toBe(
      'Notes on the chase, then on the chase.'
    )
  })

  it('does not take a longer word for the argument’s name', () => {
    expect(fillArgument('$scene and $scenes', 'scene', 'X')).toBe('X and $scenes')
  })

  it('adds it at the end when the instructions have nowhere for it', () => {
    expect(fillArgument('Tighten it.', null, 'the fight')).toBe(
      'Tighten it.\n\nARGUMENTS: the fight'
    )
  })

  it('adds nothing when nothing was typed', () => {
    expect(fillArgument('Tighten it.', null, '  ')).toBe('Tighten it.')
    expect(fillArgument('Tighten $ARGUMENTS.', null, '')).toBe('Tighten .')
  })

  it('takes what was typed as it is, dollar signs and all', () => {
    expect(fillArgument('Say: $ARGUMENTS', null, 'it costs $& and $1')).toBe(
      'Say: it costs $& and $1'
    )
  })
})

describe('what a skill of the writer’s can do yet', () => {
  it('offers the model one that runs on its own and answers back, or answers as the reply', () => {
    expect(offeredToModel(skill('name: a\ndescription: A.\ncontext: fork'))).toBe(true)
    // The turn hands its reply over to it, and ends on what it writes.
    expect(
      offeredToModel(
        skill('name: a\ndescription: A.\ncontext: fork\nmetadata:\n  inksprite-output: reply')
      )
    ).toBe(true)
  })

  it('does not offer the model one that joins the conversation, or answers with an edit', () => {
    expect(offeredToModel(skill('name: a\ndescription: A.'))).toBe(false)
    expect(
      offeredToModel(
        skill('name: a\ndescription: A.\ncontext: fork\nmetadata:\n  inksprite-output: edit')
      )
    ).toBe(false)
  })

  it('lets the writer ask one that runs on its own, and use one that does not as a saved prompt', () => {
    expect(writerCalls(skill('name: a\ndescription: A.\ncontext: fork'))).toBe('ask')
    expect(writerCalls(skill('name: a\ndescription: A.'))).toBe('prompt')
    expect(writerCalls(skill('name: a\ndescription: A.\nuser-invocable: false'))).toBeNull()
  })

  it('says in a line what a kind that is not offered yet is waiting on', () => {
    expect(
      waitingOn(
        skill('name: a\ndescription: A.\ncontext: fork\nmetadata:\n  inksprite-output: edit')
      )
    ).toMatch(/nowhere to put it/)
  })

  it('says nothing about one that works now', () => {
    expect(waitingOn(skill('name: a\ndescription: A.\ncontext: fork'))).toBe('')
    // The model loads it with use_skill.
    expect(waitingOn(skill('name: style\ndescription: A.'))).toBe('')
    expect(
      waitingOn(
        skill('name: a\ndescription: A.\ncontext: fork\nmetadata:\n  inksprite-output: reply')
      )
    ).toBe('')
    expect(waitingOn(skill('name: a\ndescription: A.\ndisable-model-invocation: true'))).toBe('')
  })
})

describe('runOnItsOwn', () => {
  const critique = skill(
    [
      'name: critique',
      'description: Notes on a scene.',
      'context: fork',
      'arguments: scene',
      'allowed-tools: read_document',
      'metadata:',
      '  inksprite-speakers: writer editor',
    ].join('\n'),
    'Give notes on $scene.'
  )

  it('asks its instructions, filled in, over the conversation, with its tools and speakers', async () => {
    const consult = vi.fn().mockResolvedValue('Cut the first page.')

    expect(await runOnItsOwn(critique, 'the chase', { consult })).toEqual({
      answer: 'Cut the first page.',
    })
    expect(consult).toHaveBeenCalledWith('Give notes on the chase.', ['read_document'], {
      roles: { user: 'writer', assistant: 'editor' },
    })
  })

  it('runs under a profile’s rewording of it, when there is one', async () => {
    const consult = vi.fn().mockResolvedValue('Fine.')
    await runOnItsOwn(critique, 'the chase', {
      consult,
      promptFor: name => (name === 'critique' ? 'Be brief about $scene.' : ''),
    })

    expect(consult.mock.calls[0][0]).toBe('Be brief about the chase.')
  })

  it('asks for its argument rather than running without one', async () => {
    const consult = vi.fn()

    expect((await runOnItsOwn(critique, '  ', { consult })).error).toMatch(/Give it its scene/)
    expect(consult).not.toHaveBeenCalled()
  })

  it('says so when there is no model to run it, or it says nothing', async () => {
    expect((await runOnItsOwn(critique, 'x')).error).toMatch(/can’t run/)
    expect((await runOnItsOwn(critique, 'x', { consult: async () => '' })).error).toMatch(
      /nothing to say/
    )
  })
})
