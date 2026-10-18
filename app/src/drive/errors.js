/**
 * @module drive/errors
 * @description What stops an import from Drive, or a sync with a Doc, said
 * for the writer.
 */

/**
 * Something about Google's side that stops an import or a sync.
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

/**
 * Drive does not give the account this file: it was never picked with it,
 * or the access was taken back.
 */
export class NotGrantedError extends DriveError {
  constructor() {
    super('Drive didn’t give inksprite this file')
    this.name = 'NotGrantedError'
  }
}

/**
 * A write was refused because the revision it was made against is too old
 * for Google to merge it in: read the Doc again and write against that.
 */
export class StaleRevisionError extends DriveError {
  constructor() {
    super('The Doc changed too much while Sync was writing to it.')
    this.name = 'StaleRevisionError'
  }
}
