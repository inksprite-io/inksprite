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
