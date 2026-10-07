/**
 * @module composables/useFileView
 * @description Whether a file is showing as the file, or as its text.
 *
 * A file's tab opens on the file: the picture, the PDF in the browser's
 * viewer, or a line saying there is no preview of this kind. Its text — what
 * was read out of it at import, and what the model reads — is a switch away,
 * in the same field a plain document is edited in, and editable there: the
 * extraction is the writer's to correct or cut down. The switch is remembered
 * for the session, per document, the way the outline's summaries are.
 */

import { reactive } from 'vue'
import { sessionStorage } from '../utils/sessionStorage.js'
import { useDocuments } from './useDocuments.js'
import { isSourceFile } from '@/source/tree.js'

/** Which documents are showing as text, shared by every panel and menu. */
const asText = reactive(new Set())

/** The session key a document's choice is kept under. */
const keyFor = (/** @type {string} */ documentId) => `file-view:${documentId}:text`

/**
 * @param {string} storyId
 */
export function useFileView(storyId) {
  const api = useDocuments(storyId)

  /**
   * Whether this document's tab shows its text rather than the file.
   * @param {string} documentId
   * @returns {boolean}
   */
  const showsText = documentId => {
    if (asText.has(documentId)) return true
    if (!sessionStorage.get(keyFor(documentId), false)) return false
    asText.add(documentId)
    return true
  }

  /**
   * Show the file's text, or the file again.
   * @param {string} documentId
   * @param {boolean} text
   */
  const setShowsText = (documentId, text) => {
    if (text) asText.add(documentId)
    else asText.delete(documentId)
    sessionStorage.set(keyFor(documentId), text)
  }

  /**
   * The menu entry for the switch, worded for the way it would go. Only a
   * file has a file to show; anything else gets none.
   * @param {string} documentId
   * @returns {import('primevue/menuitem').MenuItem|null}
   */
  const fileViewItem = documentId => {
    const document = api.get(documentId)
    if (document?.type !== 'file') return null
    // A source file is shown as its text already, and is not for editing.
    if (isSourceFile(api.get, document)) return null
    const text = showsText(documentId)
    return {
      label: text ? 'Show the file' : 'Show as text',
      icon: text ? 'pi pi-file' : 'pi pi-align-left',
      command: () => setShowsText(documentId, !text),
    }
  }

  return { showsText, setShowsText, fileViewItem }
}

/** For tests: forget every choice. */
export function clearFileViews() {
  asText.clear()
}
