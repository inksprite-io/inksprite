import { describe, it, expect } from 'vitest'
import { markCharacters } from '../../../src/stores/migrations/characterSigil.js'

const message = (id, command) => ({
  id,
  chatId: 'chat_1',
  role: 'user',
  content: '',
  version: 1,
  ...(command ? { metadata: { command } } : {}),
})

describe('markCharacters', () => {
  it('marks a name no command answered to', () => {
    const { messages, marked } = markCharacters([
      message('m1', { name: 'cody', input: 'I hide.', result: 'I hide.' }),
    ])

    expect(messages[0].metadata.command.character).toBe(true)
    expect(marked).toBe(1)
  })

  it('leaves the commands alone, however they were spelled', () => {
    const { messages, marked } = markCharacters([
      message('m1', { name: 'oracle', result: 'no' }),
      message('m2', { name: 'Compact', result: 'They crossed.' }),
    ])

    expect(messages.every(m => m.metadata.command.character === undefined)).toBe(true)
    expect(marked).toBe(0)
  })

  it('keeps what a record already says about itself', () => {
    // Including the record of a character called Oracle, which is exactly the
    // case that cannot be worked out from the name.
    const already = message('m1', { name: 'oracle', character: true, result: '"I see all."' })
    const { messages, marked } = markCharacters([already])

    expect(messages[0]).toBe(already)
    expect(marked).toBe(0)
  })

  it('passes an ordinary message straight through', () => {
    const said = message('m1')
    const { messages, marked } = markCharacters([said])

    expect(messages[0]).toBe(said)
    expect(marked).toBe(0)
  })

  it('tolerates empty and missing input', () => {
    expect(markCharacters([])).toEqual({ messages: [], marked: 0 })
    expect(markCharacters(null)).toEqual({ messages: [], marked: 0 })
  })
})
