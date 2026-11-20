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

/**
 * Whether a project can be linked to a folder it is exported to again and
 * again: in the desktop app, one new enough to.
 *
 * @returns {boolean}
 */
export const canLinkExportFolder = () =>
  canExportToFolder() && Boolean(desktop().exportFolder?.apply)

/**
 * @returns {Required<import('./desktop.js').DesktopExportFolder>}
 * @throws {Error} Outside the desktop app, or in one too old to
 */
function links() {
  if (!canLinkExportFolder())
    throw new Error('A project is linked to a folder only in the desktop app.')
  return /** @type {any} */ (desktop().exportFolder)
}

/**
 * The folder a project is exported to again and again, or null.
 *
 * @param {string} storyId
 * @returns {Promise<string|null>}
 */
export const linkedExportFolder = async storyId =>
  canLinkExportFolder() ? links().linked(storyId) : null

/**
 * Ask the writer for the folder a project is exported to from now on.
 *
 * @param {string} storyId
 * @returns {Promise<string|null>} The folder, or null when they cancelled
 */
export const linkExportFolder = storyId => links().link(storyId)

/**
 * Stop exporting a project to its folder. What is there stays.
 *
 * @param {string} storyId
 * @returns {Promise<void>}
 */
export const unlinkExportFolder = storyId => links().unlink(storyId)

/**
 * The text of each of these files as it is in a project's folder now: null
 * for one that isn't there.
 *
 * @param {string} storyId
 * @param {string[]} paths - As the export has them, its own folder first
 * @returns {Promise<Record<string, string|null>>}
 */
export const lookInLinkedFolder = (storyId, paths) => links().look(storyId, paths)

/**
 * Write an export into a project's folder, in place: only what differs, a
 * copy changed outside going to the system's trash first, and what is no
 * longer in the export going there too.
 *
 * @param {string} storyId
 * @param {Array<ExportEntry|{path: string, text: string, own?: boolean}>} entries
 * @returns {Promise<import('./desktop.js').LinkedExportReport>}
 */
export async function writeLinkedFolder(storyId, entries) {
  const sent = await Promise.all(
    entries.map(async entry =>
      'blob' in entry
        ? { path: entry.path, bytes: new Uint8Array(await entry.blob.arrayBuffer()) }
        : entry
    )
  )
  return links().apply(storyId, sent)
}
