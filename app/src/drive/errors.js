/**
 * @module drive/errors
 * @description What stops an import from Drive, said for the writer.
 */

/**
 * Something about Google's side that stops an import.
 */
export class DriveError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'DriveError'
  }
}

/**
 * Drive stopped taking the token. True of every file in a batch at once, so
 * it stops the batch rather than skipping a file.
 */
export class SignInLapsedError extends DriveError {
  constructor() {
    super('Your Google sign-in ran out. Choose the files again.')
    this.name = 'SignInLapsedError'
  }
}

/**
 * The browser would not open Google's window: it was not opened straight
 * from a click.
 */
export class PopupBlockedError extends DriveError {
  constructor() {
    super('The browser blocked Google’s window.')
    this.name = 'PopupBlockedError'
  }
}
