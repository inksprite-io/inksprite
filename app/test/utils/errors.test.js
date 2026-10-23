import { describe, it, expect } from 'vitest'
import {
  AnswerFailedError,
  CannotApplyError,
  CommandError,
  failureNotice,
} from '../../src/utils/errors.js'

describe('failureNotice', () => {
  it('says what didn’t happen, and why when the error’s words are the writer’s', () => {
    const refused = new Error('Invalid API key.')

    expect(failureNotice(refused, "The message couldn't be sent.", { why: true })).toBe(
      "The message couldn't be sent. Invalid API key."
    )
    expect(failureNotice(new CommandError('/roll needs dice to roll.'), 'No.', { why: true })).toBe(
      'No. /roll needs dice to roll.'
    )
  })

  it('keeps a store’s words, and the id in them, for the console', () => {
    const missing = new Error("Failed to update message, 'msg_9' not found")

    expect(failureNotice(missing, "The conversation couldn't be rewound.")).toBe(
      "The conversation couldn't be rewound."
    )
  })

  it('says the sentence alone when the error has no words', () => {
    expect(failureNotice(new Error(''), "The edit couldn't be made.", { why: true })).toBe(
      "The edit couldn't be made."
    )
  })

  it('says nothing of an action that couldn’t apply, or of a turn that says why itself', () => {
    const busy = new CannotApplyError("Can't start a new generation while one is in progress.")
    const failed = new AnswerFailedError(new Error('Server error'), 'msg_1')

    expect(failureNotice(busy, "The message couldn't be sent.", { why: true })).toBeNull()
    expect(failureNotice(failed, "The message couldn't be sent.", { why: true })).toBeNull()
  })
})
