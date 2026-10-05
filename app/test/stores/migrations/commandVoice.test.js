import { describe, it, expect } from 'vitest'
import { commandsIntoTheirVoice } from '../../../src/stores/migrations/commandVoice.js'

const message = (id, role, content, command) => ({
  id,
  chatId: 'chat_1',
  role,
  content,
  version: 1,
  ...(command ? { metadata: { command } } : {}),
})

describe('commandsIntoTheirVoice', () => {
  it('leaves a command holding its answer rather than the block that wrapped it', () => {
    const { messages, moved } = commandsIntoTheirVoice([
      message('m1', 'user', '<oracle>\nIs the door locked?\nno\n</oracle>', {
        name: 'oracle',
        input: 'Is the door locked?',
        label: 'Is the door locked?',
        result: 'no',
      }),
    ])

    expect(messages[0].content).toBe('no')
    expect(messages[0].role).toBe('user')
    expect(moved).toBe(1)
  })

  it('moves a consultation into the assistant slot it was always in', () => {
    const { messages } = commandsIntoTheirVoice([
      message('m1', 'user', '<interpret>\nWhat is he afraid of?\nHe is waiting.\n</interpret>', {
        name: 'interpret',
        input: 'What is he afraid of?',
        result: 'He is waiting.',
      }),
    ])

    expect(messages[0]).toMatchObject({ role: 'assistant', content: 'He is waiting.' })
  })

  it('moves a summary too, under the name it was stored with', () => {
    // The record says `compact`; only the tag it renders under is `summary`.
    const { messages } = commandsIntoTheirVoice([
      message('m1', 'user', '<summary>\nThey crossed the pass.\n</summary>', {
        name: 'compact',
        input: '',
        keep: 4,
        result: 'They crossed the pass.',
      }),
    ])

    expect(messages[0]).toMatchObject({ role: 'assistant', content: 'They crossed the pass.' })
  })

  it('empties one that never answered', () => {
    // Pending when the tab closed, or failed. An assistant turn that said
    // nothing is what that was all along.
    const { messages } = commandsIntoTheirVoice([
      message('m1', 'user', '<interpret>\nWhat is he afraid of?\n</interpret>', {
        name: 'interpret',
        input: 'What is he afraid of?',
        result: '',
        error: 'the endpoint is down',
      }),
    ])

    expect(messages[0]).toMatchObject({ role: 'assistant', content: '' })
  })

  it('leaves a message that has already been moved alone', () => {
    const already = message('m1', 'assistant', 'He is waiting.', {
      name: 'interpret',
      input: 'What is he afraid of?',
      result: 'He is waiting.',
    })
    const { messages, moved } = commandsIntoTheirVoice([already])

    expect(messages[0]).toBe(already)
    expect(moved).toBe(0)
  })

  it('passes an ordinary message straight through', () => {
    const said = message('m1', 'user', 'I push open the door.')
    const { messages, moved } = commandsIntoTheirVoice([said])

    expect(messages[0]).toBe(said)
    expect(moved).toBe(0)
  })

  it('tolerates empty and missing input', () => {
    expect(commandsIntoTheirVoice([])).toEqual({ messages: [], moved: 0 })
    expect(commandsIntoTheirVoice(null)).toEqual({ messages: [], moved: 0 })
  })
})
