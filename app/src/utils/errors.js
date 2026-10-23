/**
 * @module utils/errors
 * @description Custom error classes for the application, and what the writer
 * is told of them
 */

/**
 * Error thrown when an AI provider is not configured
 * This error signals that the user needs to set up an AI provider
 * before they can use AI features
 */
export class ProviderNotConfiguredError extends Error {
  /**
   * @param {string} message - Error message
   */
  constructor(message = 'AI provider not configured') {
    super(message)
    this.name = 'ProviderNotConfiguredError'
  }
}

/**
 * Error thrown when a slash command cannot run.
 *
 * Its own class because nothing has been written when it is thrown — commands
 * run before any message is recorded, precisely so a typo leaves nothing
 * behind. The caller can put the text back in the box knowing the chat is
 * unchanged, which it cannot assume of a failure any later than this.
 */
export class CommandError extends Error {
  /**
   * @param {string} message - Error message
   */
  constructor(message) {
    super(message)
    this.name = 'CommandError'
  }
}

/**
 * Error thrown when an action can't apply as things stand: a reply asked for
 * while one is being written, a message that has gone, a change decided
 * already.
 *
 * Its own class because there is nothing to tell the writer. The control
 * that asked is disabled where it can be, and a press that gets through does
 * nothing, so the caller lets it go without a word.
 */
export class CannotApplyError extends Error {
  /**
   * @param {string} message - What couldn't apply, for the console
   */
  constructor(message) {
    super(message)
    this.name = 'CannotApplyError'
  }
}

/**
 * Error thrown when a turn fails after its answer was made: the provider
 * refused, the connection dropped, a round could not be built.
 *
 * Its own class because the reason is already on the answer by then, kept
 * with the chat (`metadata.error`) and shown where the reply would have been,
 * so the caller has nothing left to report.
 */
export class AnswerFailedError extends Error {
  /**
   * @param {Error} cause - What went wrong
   * @param {string} messageId - The answer it is recorded on
   */
  constructor(cause, messageId) {
    super(cause.message, { cause })
    this.name = 'AnswerFailedError'
    this.messageId = messageId
  }
}

/**
 * Error thrown when a summary stops short because its request failed.
 *
 * What it had written is kept as the summary by then, to be asked for again,
 * finished by hand or deleted; this is only the news, for the caller to pass
 * on.
 */
export class SummaryCutShortError extends Error {
  /**
   * @param {string} reason - Why its request failed
   */
  constructor(reason) {
    super(`The summary was cut short. ${reason}`)
    this.name = 'SummaryCutShortError'
  }
}

/**
 * What to tell the writer of an action that failed: what didn't happen, then
 * why, when the error's words are theirs to read. Null when there is nothing
 * to tell: the action couldn't apply, or the turn says why already.
 *
 * @param {Error} error
 * @param {string} said - What didn't happen, as a sentence
 * @param {{why?: boolean}} [options] - Whether the error's own words follow.
 *   From the AI layer (the provider, the network, a command) they are the
 *   writer's; from a store, with an id in them, they are the console's.
 * @returns {string|null}
 */
export function failureNotice(error, said, { why = false } = {}) {
  if (error?.name === 'CannotApplyError' || error?.name === 'AnswerFailedError') return null
  const reason = why ? error?.message?.trim() : ''
  return reason ? `${said} ${reason}` : said
}
