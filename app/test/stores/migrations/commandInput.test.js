import { describe, it, expect } from 'vitest'
import { commandArgsToInput } from '../../../src/stores/migrations/commandInput.js'

const message = (id, command) => ({
  id,
  chatId: 'chat_1',
  role: 'user',
  content: '',
  version: 1,
  ...(command ? { metadata: { command } } : {}),
})

describe('commandArgsToInput', () => {
  it('reads the question out of the first argument', () => {
    const { messages, converted } = commandArgsToInput([
      message('m1', {
        name: 'oracle',
        args: ['Is the door locked?', 'likely'],
        label: 'Is the door locked?',
        result: 'no',
      }),
    ])

    expect(messages[0].metadata.command).toEqual({
      name: 'oracle',
      input: 'Is the door locked?',
      param: 'likely',
      label: 'Is the door locked?',
      result: 'no',
    })
    expect(converted).toBe(1)
  })

  it('leaves out a parameter that was never given', () => {
    // The command resolves its own default when it runs, so a record that says
    // nothing about the likelihood still asks under the same odds.
    const { messages } = commandArgsToInput([
      message('m1', {
        name: 'director',
        args: ['Wrap this scene up'],
        result: 'Wrap this scene up',
      }),
    ])

    expect(messages[0].metadata.command).toEqual({
      name: 'director',
      input: 'Wrap this scene up',
      result: 'Wrap this scene up',
    })
  })

  it('keeps everything else about the record', () => {
    const { messages } = commandArgsToInput([
      message('m1', { name: 'compact', args: ['', '8'], keep: 8, detail: 'keeping the last 8' }),
    ])

    expect(messages[0].metadata.command).toMatchObject({
      input: '',
      param: '8',
      keep: 8,
      detail: 'keeping the last 8',
    })
  })

  it('leaves a command that has already been rewritten alone', () => {
    const already = { name: 'oracle', input: 'Is it?', param: 'likely', result: 'yes' }
    const { messages, converted } = commandArgsToInput([message('m1', already)])

    expect(messages[0].metadata.command).toEqual(already)
    expect(converted).toBe(0)
  })

  it('passes an ordinary message straight through', () => {
    const said = message('m1')
    const { messages, converted } = commandArgsToInput([said])

    expect(messages[0]).toBe(said)
    expect(converted).toBe(0)
  })

  it('tolerates empty and missing input', () => {
    expect(commandArgsToInput([])).toEqual({ messages: [], converted: 0 })
    expect(commandArgsToInput(null)).toEqual({ messages: [], converted: 0 })
  })
})
