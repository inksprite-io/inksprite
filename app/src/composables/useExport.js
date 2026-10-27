/* global Blob */
/**
 * @module composables/useExport
 * @description A project, a folder or a document handed to the writer as it
 * would be published (`files/exportDocument.js`): one file as itself, and
 * more than one as a zip of them. In the desktop app a project or a folder
 * goes to a folder where the writer says instead, in place of one there of
 * that name, its imported files copied from the library.
 *
 * Design: `.llm/export_design.md`.
 */

import { downloadBlob } from '@/files/download.js'
import { exportEntries } from '@/files/exportDocument.js'
import {
  canExportToFolder,
  chooseExportFolder,
  writeExportFolder,
} from '@/platform/exportFolder.js'
import { storage } from '@/storage/index.js'
import { safeName } from '@/storage/names.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { useFilesStore } from '@/stores/filesStore'
import { zipWriter } from '@/utils/zipWriter.js'
import { useDocuments } from './useDocuments.js'
import { useToast } from './useToast.js'

/** @typedef {import('@/files/exportDocument.js').Export} Export */

/**
 * An export as the file to hand out: the one file it is, or a zip of
 * everything in it, named for what was exported.
 *
 * @param {Export} made
 * @param {boolean} directory - Whether what was exported is a folder, whose
 *   name is the zip's
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function fileOfExport(made, directory) {
  const [only] = made.entries
  if (made.entries.length === 1 && !('folder' in only)) {
    if ('blob' in only) return { blob: only.blob, filename: made.name }
    if ('text' in only) {
      const type = made.name.endsWith('.md') ? 'text/markdown' : 'text/plain'
      return { blob: new Blob([only.text], { type }), filename: made.name }
    }
  }
  const zip = zipWriter('This is more than a zip file can hold yet: 4 GB, or 65,535 files.')
  for (const entry of made.entries) {
    if ('folder' in entry) zip.addFolder(entry.path)
    else if ('text' in entry) zip.addText(entry.path, entry.text)
    else if ('blob' in entry) await zip.addBlob(entry.path, entry.blob)
  }
  const stem = directory ? made.name : made.name.replace(/\.[^.]*$/, '')
  return { blob: zip.end(), filename: `${stem}.zip` }
}

/**
 * The words for the files an export left out, whose bytes are still on the
 * sync server and couldn't be downloaded.
 *
 * @param {number} count
 * @returns {string}
 */
const leftOut = count =>
  count === 1
    ? "A file couldn't be downloaded from the sync server, so the export leaves it out."
    : `${count} files couldn't be downloaded from the sync server, so the export leaves them out.`

/**
 * @param {string} storyId - The project exported from
 */
export function useExport(storyId) {
  const api = useDocuments(storyId)
  const toast = useToast()

  /**
   * Hand the writer a project, a folder or a document as it would be
   * published. What went wrong is said, and nothing is handed out; a folder
   * not chosen is nothing to say.
   *
   * @param {string} documentId - The project's root, a folder, or a document
   * @returns {Promise<boolean>} Whether it was handed out
   */
  async function exportDocument(documentId) {
    const document = api.get(documentId)
    if (!document) return false
    const directory = document.type === 'folder'
    const what = documentId === rootIdFor(storyId) ? 'project' : directory ? 'folder' : 'document'
    try {
      const toFolder = directory && canExportToFolder()
      const target = toFolder ? await chooseExportFolder(safeName(document.title)) : null
      if (toFolder && !target) return false

      const files = useFilesStore()
      const made = await exportEntries(
        {
          tree: { get: api.get, childrenOf: api.childrenOf, rootId: rootIdFor(storyId) },
          content: api.currentContent,
          read: key => files.getFile(key),
          // Copied where they are, rather than read and sent over.
          ...(target ? { located: id => storage.filePath(id) } : {}),
        },
        documentId
      )
      // A file alone whose bytes couldn't be had leaves nothing to hand out.
      if (made.entries.length === 0) {
        throw new Error("Its file couldn't be downloaded from the sync server.")
      }
      if (target) {
        await writeExportFolder(target, made.entries)
      } else {
        const { blob, filename } = await fileOfExport(made, directory)
        downloadBlob(blob, filename)
      }
      if (made.missing > 0) toast.warning(leftOut(made.missing))
      return true
    } catch (error) {
      console.error('Export failed:', error)
      toast.error(`The ${what} couldn't be exported. ${error.message}`)
      return false
    }
  }

  return { exportDocument }
}
