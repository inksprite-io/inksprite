/**
 * @module composables/useNewDocument
 * @description New document, from the editor: the plus in its strip, and the
 * button it shows with nothing open. The same as the outline's own New
 * document, from the other side: a text document at the top of the project,
 * opened in the editor, a step Command-Z in the outline takes back
 * (`useTreeHistory`), and named in the outline where the outline is on
 * screen to name it in.
 *
 * With the outline out of sight (the sidebar hidden or on another list, the
 * search in the outline's place, a phone's writing view) the document opens
 * unnamed and the caret goes in it. A rename asked of an outline that is not
 * showing would open its field unseen, or wait to open it whenever the
 * outline was next looked at.
 */

import { useDocuments } from './useDocuments.js'
import { useTreeHistory } from './useTreeHistory.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/**
 * Whether the outline is on screen, for a new document to be named in.
 * @returns {boolean}
 */
const outlineShowing = () =>
  (document.querySelector('[data-document-tree]')?.getClientRects().length ?? 0) > 0

/**
 * @param {string} storyId
 * @returns {() => import('@/types/models.js').Document} Make the document, and
 *   show it
 */
export function useNewDocument(storyId) {
  const api = useDocuments(storyId)
  const history = useTreeHistory(storyId)

  return () => {
    const created = api.createTextDocument(rootIdFor(storyId), '')
    history.created(created.id)
    api.open(created.id)
    if (outlineShowing()) api.requestRename(created.id)
    return created
  }
}
