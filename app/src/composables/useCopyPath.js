/**
 * @module composables/useCopyPath
 * @description Copy a document's path to the clipboard.
 *
 * A document's path — `Characters/Elara`, `/` for the project — is the one
 * address the AI tools take, and the way a writer names a document to the
 * assistant in chat. The outline's menu and the tab strip's both offer it,
 * and this is the one thing they do with it.
 */

import { useDocuments } from './useDocuments.js'
import { useToast } from './useToast.js'

/**
 * @param {string} storyId
 * @returns {{ copyPath: (documentId: string) => Promise<void> }}
 */
export function useCopyPath(storyId) {
  const api = useDocuments(storyId)
  const toast = useToast()

  /**
   * Put the document's path on the clipboard, and say so in a word: it was
   * asked for from a menu that closes, and a clipboard shows nothing.
   * @param {string} documentId
   */
  const copyPath = async documentId => {
    const path = api.pathOf(documentId)
    if (!path) return
    try {
      await navigator.clipboard.writeText(path)
      toast.success('Copied', { duration: 2000 })
    } catch (error) {
      console.error('Failed to copy path:', error)
      toast.error('Could not copy the path. The browser did not allow it here.')
    }
  }

  return { copyPath }
}
