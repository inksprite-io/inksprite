/**
 * @module platform/library
 * @description In the desktop app, the folder the projects are kept in:
 * where it is, whether the app's projects are moved into it yet, and its
 * files, for `storage/library.js`.
 */

import { desktop } from './desktop.js'

/** @typedef {import('../storage/library.js').LibraryDisk} LibraryDisk */

/**
 * Where the library is, and whether the projects kept in the window have
 * been moved into it.
 *
 * @returns {Promise<import('./desktop.js').LibrarySettings>}
 */
export const librarySettings = () => desktop().library.settings()

/** Say the window's projects are in the library now, so they are not moved again. */
export const markProjectsMoved = () => desktop().library.markMoved()

/**
 * Show the library, or a file in it, in the system's file manager.
 *
 * @param {string} [path] - Below the library
 */
export const revealInLibrary = path => desktop().library.reveal(path)

/**
 * The library's files, as storage reaches them.
 *
 * @returns {LibraryDisk}
 */
export function libraryDisk() {
  const { library } = desktop()
  return {
    projects: () => library.projects(),
    walk: dir => library.walk(dir),
    list: dir => library.list(dir),
    read: paths => library.read(paths),
    readBytes: path => library.readBytes(path),
    apply: ops => library.apply(ops),
  }
}
