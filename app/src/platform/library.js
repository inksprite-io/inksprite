/**
 * @module platform/library
 * @description In the desktop app, the folder the projects are kept in:
 * whether they are kept in it, where it is, and its files, for
 * `storage/library.js`.
 */

import { desktop } from './desktop.js'

/** @typedef {import('../storage/library.js').LibraryDisk} LibraryDisk */

/**
 * Whether the projects are kept in a library, where it is, and whether the
 * projects kept in the window have been moved into it.
 *
 * @returns {Promise<import('./desktop.js').LibrarySettings>}
 */
export const librarySettings = () => desktop().library.settings()

/**
 * Keep the projects in the library from now on. Until the window's projects
 * are moved into it, the app opens on them, and moves them in.
 *
 * @returns {Promise<string>} Where it is
 */
export const enableLibrary = () => desktop().library.enable()

/**
 * Keep the projects in the app again, once they have been copied back into
 * it. The folder's files stay where they are.
 *
 * @returns {Promise<void>}
 */
export const disableLibrary = () => desktop().library.disable()

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
