/**
 * @module composables/usePlainText
 * @description Turn a document plain, or back into a document.
 *
 * A plain document is edited as text and stored as typed. The outline's menu
 * and the tab strip's both offer the switch, and this is the one thing they
 * do with it.
 */

import { useDocuments } from './useDocuments.js'

/** What the switch is called, on the outline's menu and the tab strip's. */
export const PLAIN_TEXT_LABEL = 'Edit in plain text editor'

/**
 * @param {string} storyId
 * @returns {{ plainTextItem: (documentId: string) => import('primevue/menuitem').MenuItem|null }}
 */
export function usePlainText(storyId) {
  const api = useDocuments(storyId)

  /**
   * The menu entry for it: one switch, ticked while the document is plain,
   * rather than two entries worded for the way each would go. Only a text
   * document has a kind to switch; a folder gets none.
   * @param {string} documentId
   * @returns {import('primevue/menuitem').MenuItem|null}
   */
  const plainTextItem = documentId => {
    if (api.get(documentId)?.type !== 'text') return null
    return {
      label: PLAIN_TEXT_LABEL,
      icon: api.isPlain(documentId) ? 'pi pi-check' : 'pi pi-code',
      command: () => api.setPlain(documentId, !api.isPlain(documentId)),
    }
  }

  return { plainTextItem }
}
