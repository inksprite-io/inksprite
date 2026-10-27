/**
 * @module platform/exportFolder
 * @description In the desktop app, a project or a folder exported to a
 * folder the writer chooses, rather than downloaded as a zip: a repository's
 * docs, written straight into the checkout. See
 * `app/electron/src/exporting.js`.
 */

import { desktop, isDesktop } from './desktop.js'

/** @typedef {import('@/files/exportDocument.js').ExportEntry} ExportEntry */

/**
 * Whether an export can be written to a folder here: in the desktop app, one
 * new enough to.
 *
 * @returns {boolean}
 */
export const canExportToFolder = () => isDesktop() && Boolean(desktop().exportFolder)

/**
 * Ask the writer where to put an export.
 *
 * @param {string} name - The folder's name to start with
 * @returns {Promise<string|null>} Where, or null when they cancelled
 * @throws {Error} Outside the desktop app, or in one too old to
 */
export function chooseExportFolder(name) {
  const exportFolder = canExportToFolder() ? desktop().exportFolder : null
  if (!exportFolder) throw new Error('Exports go to a folder only in the desktop app.')
  return exportFolder.choose(name)
}

/**
 * Write an export where the writer chose, in place of what is there, which
 * goes to the system's trash.
 *
 * @param {string} target - As `chooseExportFolder` gave it
 * @param {ExportEntry[]} entries
 * @returns {Promise<void>}
 * @throws {Error} Outside the desktop app, in one too old to, or when it
 *   couldn't be written
 */
export async function writeExportFolder(target, entries) {
  const exportFolder = canExportToFolder() ? desktop().exportFolder : null
  if (!exportFolder) throw new Error('Exports go to a folder only in the desktop app.')
  const sent = await Promise.all(
    entries.map(async entry =>
      'blob' in entry
        ? { path: entry.path, bytes: new Uint8Array(await entry.blob.arrayBuffer()) }
        : entry
    )
  )
  return exportFolder.write(target, sent)
}
