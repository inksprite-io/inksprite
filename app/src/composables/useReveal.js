/**
 * @module composables/useReveal
 * @description Show a document where it is kept, in the desktop app: a
 * project's folder or a folder opened in the system's file manager, and any
 * other document's file shown in the folder it is in. The outline's menus
 * offer it, the project's and each document's.
 */

import { isDesktop } from '@/platform/desktop.js'
import { revealInLibrary } from '@/platform/library.js'
import { storage } from '@/storage/index.js'
import { useToast } from './useToast.js'

/** What showing it is called where the app runs: Finder on a Mac, Explorer on Windows. */
const platform = typeof navigator === 'undefined' ? '' : navigator.userAgent
const LABEL = /Mac/.test(platform)
  ? 'Show in Finder'
  : /Windows/.test(platform)
    ? 'Show in Explorer'
    : 'Show in folder'

/**
 * @returns {{ revealItem: (documentId: string) => {label: string, icon: string, command: () => void}|null }}
 */
export function useReveal() {
  const toast = useToast()

  /**
   * Show the document in the file manager. One not written to the disk yet
   * has nowhere to be shown, and nothing happens.
   * @param {string} documentId
   */
  const reveal = async documentId => {
    try {
      const path = await storage.documentPath(documentId)
      if (path) await revealInLibrary(path)
    } catch (error) {
      console.error('Failed to show the document in its folder:', error)
      toast.error(`The folder couldn't be shown. ${/** @type {Error} */ (error).message}`)
    }
  }

  /**
   * The menu item that shows a document there: only in the desktop app,
   * where the projects are files.
   * @param {string} documentId
   */
  const revealItem = documentId =>
    isDesktop()
      ? { label: LABEL, icon: 'pi pi-folder-open', command: () => reveal(documentId) }
      : null

  return { revealItem }
}
