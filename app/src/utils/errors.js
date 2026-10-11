/**
 * @module utils/errors
 * @description Custom error classes for the application
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
    super(`Compacted summary was cut short: ${reason}`)
    this.name = 'SummaryCutShortError'
  }
}
