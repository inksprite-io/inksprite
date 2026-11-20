/* global Blob */
/**
 * @module composables/useExport
 * @description A project, a folder or a document handed to the writer as it
 * would be published (`files/exportDocument.js`): one file as itself, and
 * more than one as a zip of them. In the desktop app a project or a folder
 * goes to a folder where the writer says instead, in place of one there of
 * that name, its imported files copied from the library.
 *
 * A project can also be linked to a folder it is exported to again and
 * again, a repository's docs: written in place there, each text stamped
 * with the document it came from (`files/exportStamp.js`), by the project's
 * menu or by a connected app (`apps/tools.js`).
 *
 * Design: `.llm/export_design.md`, and `.llm/mcp_server_design.md` for the
 * linked folder.
 */

import { downloadBlob } from '@/files/download.js'
import { exportEntries } from '@/files/exportDocument.js'
import { asExported, stamped } from '@/files/exportStamp.js'
import {
  canExportToFolder,
  chooseExportFolder,
  linkedExportFolder,
  lookInLinkedFolder,
  writeExportFolder,
  writeLinkedFolder,
} from '@/platform/exportFolder.js'
import { storage } from '@/storage/index.js'
import { safeName } from '@/storage/names.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { useFilesStore } from '@/stores/filesStore'
import { documentPath } from '@/utils/documentPath.js'
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
 * What an export to a project's linked folder did
 * (`platform/desktop.js`'s report), with how many files were left out for
 * want of their bytes.
 * @typedef {import('@/platform/desktop.js').LinkedExportReport & {missing: number}} LinkedExport
 */

/** What an export to a linked folder says when the project has none. */
export const NO_LINKED_FOLDER = 'No folder is linked to this project.'

/**
 * Export a project to the folder linked to it, in place: each text stamped
 * with the document it came from, only what differs written, a copy changed
 * outside inksprite put in the system's trash first, and what is no longer
 * in the project taken away.
 *
 * A text already there is the export's own when it is as an export left it,
 * whichever export that was: another branch checked out has an older one,
 * which is written over without a word.
 *
 * @param {string} storyId
 * @returns {Promise<LinkedExport>}
 * @throws {Error} When no folder is linked, or it couldn't be written
 */
export async function exportToLinkedFolder(storyId) {
  if (!(await linkedExportFolder(storyId))) throw new Error(NO_LINKED_FOLDER)
  const api = useDocuments(storyId)
  await api.init()
  const rootId = rootIdFor(storyId)
  const project = api.get(rootId)?.title?.trim() || 'Untitled'
  const files = useFilesStore()
  const made = await exportEntries(
    {
      tree: { get: api.get, childrenOf: api.childrenOf, rootId },
      content: api.currentContent,
      read: key => files.getFile(key),
      located: id => storage.filePath(id),
      // A file in a repository ends with a newline: an editor there adds
      // one, and the file would then read as changed outside.
      stamp: (document, text) =>
        stamped(
          { project, document: documentPath(api.get, document), id: document.id },
          text.endsWith('\n') ? text : `${text}\n`
        ),
    },
    rootId
  )

  const texts = made.entries.flatMap(entry => ('text' in entry ? [entry.path] : []))
  const there = await lookInLinkedFolder(storyId, texts)
  const entries = await Promise.all(
    made.entries.map(async entry => {
      if (!('text' in entry)) return entry
      const was = there[entry.path]
      return typeof was === 'string' && was !== entry.text && (await asExported(was))
        ? { ...entry, own: true }
        : entry
    })
  )
  return { ...(await writeLinkedFolder(storyId, entries)), missing: made.missing }
}

/**
 * The words for the copies an export to a linked folder replaced, which had
 * been changed outside inksprite.
 *
 * @param {number} count
 * @returns {string}
 */
const replacedCopies = count =>
  count === 1
    ? "A file had been changed outside inksprite, and was replaced. The copy that was there is in the system's trash."
    : `${count} files had been changed outside inksprite, and were replaced. The copies that were there are in the system's trash.`

/**
 * @param {string} storyId - The project exported from
 * @param {ReturnType<typeof useToast>} [toast] - Where what happened is said,
 *   for a caller past a component's setup, where a toast can't be had
 */
export function useExport(storyId, toast = useToast()) {
  const api = useDocuments(storyId)

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

  /**
   * Export the project to the folder linked to it. What went wrong is said;
   * what went as it should needs no word, but for a copy that was replaced.
   *
   * @returns {Promise<boolean>} Whether it was exported
   */
  async function exportToLinked() {
    try {
      const done = await exportToLinkedFolder(storyId)
      if (done.missing > 0) toast.warning(leftOut(done.missing))
      if (done.edited.length > 0) toast.warning(replacedCopies(done.edited.length))
      return true
    } catch (error) {
      console.error('Export to the linked folder failed:', error)
      toast.error(`The project couldn't be exported. ${error.message}`)
      return false
    }
  }

  return { exportDocument, exportToLinked }
}
