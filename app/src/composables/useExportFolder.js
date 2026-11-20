/**
 * @module composables/useExportFolder
 * @description The folder a project is linked to, in the desktop app: where
 * it is exported again and again, a repository's docs, written in place and
 * stamped (`composables/useExport.js`). The native side keeps it by the
 * project's id, on this computer alone (`platform/exportFolder.js`); this is
 * what Settings › Project and the project's menu show of it.
 *
 * One state for the app: a project's folder is the same wherever it is read,
 * and asked for the first time it is.
 */

import { reactive } from 'vue'
import { inPreview } from '@/config/preview.js'
import {
  canLinkExportFolder,
  linkExportFolder,
  linkedExportFolder,
  unlinkExportFolder,
} from '@/platform/exportFolder.js'

/**
 * Each project's folder as last heard: null for none, and no entry for one
 * not asked about yet.
 * @type {Map<string, string|null>}
 */
const folders = reactive(new Map())

/** @type {Set<string>} The projects being asked about */
const asking = new Set()

/**
 * Whether a project can be linked to a folder here: in the desktop app,
 * while the feature is in preview.
 *
 * @returns {boolean}
 */
export const exportFolderOffered = () => inPreview('mcp-server') && canLinkExportFolder()

/**
 * Hear a project's folder from the native side.
 * @param {string} storyId
 */
async function load(storyId) {
  if (!exportFolderOffered() || asking.has(storyId)) return
  asking.add(storyId)
  try {
    folders.set(storyId, await linkedExportFolder(storyId))
  } catch (error) {
    console.error('Failed to read the project’s export folder:', error)
  } finally {
    asking.delete(storyId)
  }
}

/**
 * The folder a project is linked to, as far as is known: asked for the first
 * time this is, and read again by whatever shows it once it is heard.
 *
 * @param {string} storyId
 * @returns {string|null}
 */
export function exportFolderOf(storyId) {
  if (!folders.has(storyId)) load(storyId)
  return folders.get(storyId) ?? null
}

/**
 * What a folder is called: the last of its path.
 *
 * @param {string} folder
 * @returns {string}
 */
export const folderName = folder => folder.split(/[\\/]/).filter(Boolean).at(-1) || folder

/** How many of a folder's last parts are shown of it. */
const SHOWN_PARTS = 3

/**
 * A folder's path as it is shown where there is little room: its end, which
 * is what tells it from another, after an ellipsis for the rest.
 *
 * @param {string} folder
 * @returns {string}
 */
export function shortFolder(folder) {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  const parts = folder.split(/[\\/]/).filter(Boolean)
  if (parts.length <= SHOWN_PARTS) return folder
  return `…${separator}${parts.slice(-SHOWN_PARTS).join(separator)}`
}

/**
 * Ask the writer for the folder a project is exported to from now on.
 *
 * @param {string} storyId
 * @returns {Promise<string|null>} The folder, or null when they cancelled
 */
export async function chooseExportFolderFor(storyId) {
  const folder = await linkExportFolder(storyId)
  if (folder) folders.set(storyId, folder)
  return folder
}

/**
 * Stop exporting a project to its folder. What is there stays.
 *
 * @param {string} storyId
 * @returns {Promise<void>}
 */
export async function removeExportFolderOf(storyId) {
  await unlinkExportFolder(storyId)
  folders.set(storyId, null)
}

/** Forget what was heard, for a test. */
export function clearExportFolders() {
  folders.clear()
  asking.clear()
}
