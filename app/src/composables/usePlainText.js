/**
 * @module composables/usePlainText
 * @description Turn a document plain, or back into a document.
 *
 * A plain document is edited as text and stored as typed. The outline's menu
 * and the tab strip's both offer the switch, and this is the one thing they
 * do with it — including offering the way back when the switch rewrote text.
 */

import { changedLines } from '../utils/lineDiff.js'
import { useDocuments } from './useDocuments.js'
import { useToast } from './useToast.js'

/**
 * @param {string} storyId
 * @returns {{ plainTextItem: (documentId: string) => import('primevue/menuitem').MenuItem|null }}
 */
export function usePlainText(storyId) {
  const api = useDocuments(storyId)
  const toast = useToast()

  /**
   * Turn the document into the other kind. Making a document plain changes
   * nothing in it. Making a plain one a document settles its text to what the
   * editor can show, and where that changed something, it is done anyway and
   * offered back: the writer sees what it came to, the lines that changed if
   * they ask, and one click puts the text they typed back.
   * @param {string} documentId
   */
  const togglePlain = documentId => {
    const plain = api.isPlain(documentId)
    const changes = plain && api.wouldSettle(documentId)
    const original = changes ? api.currentContent(documentId) : null
    api.setPlain(documentId, !plain)
    if (!changes) return

    toast.action(
      'Some of the formatting was rewritten.',
      {
        label: 'Undo',
        command: () => {
          api.setPlain(documentId, true)
          api.setContent(documentId, original)
        },
      },
      { changes: changedLines(original, api.currentContent(documentId)) }
    )
  }

  /**
   * The menu entry for it, worded for the way it would go. Only a text
   * document has a kind to switch; a folder gets none.
   * @param {string} documentId
   * @returns {import('primevue/menuitem').MenuItem|null}
   */
  const plainTextItem = documentId => {
    if (api.get(documentId)?.type !== 'text') return null
    return {
      label: api.isPlain(documentId) ? 'Edit as a document' : 'Edit as plain text',
      icon: 'pi pi-code',
      command: () => togglePlain(documentId),
    }
  }

  return { plainTextItem }
}
