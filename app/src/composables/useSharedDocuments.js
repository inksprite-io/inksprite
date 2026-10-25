/**
 * A project its owner shares with only some of its documents, as the owner
 * sees and changes it (`utils/sharedDocuments.js`): what the others see of
 * each document, which the outline marks once the project is shared with
 * someone, and a document shared, or no longer, with everything in it, from
 * its menu or **Share…**. Only in the preview `selective-sharing`.
 *
 * Design: `.llm/sync_design.md`, "Only some documents".
 */

import { computed } from 'vue'
import { sharing } from '@/cloud/people.js'
import { inPreview } from '@/config/preview.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { sharedWith, sharingOf } from '@/utils/sharedDocuments.js'

/** @typedef {import('@/utils/sharedDocuments.js').Sharing} Sharing */

/**
 * Each project's documents as the others see them, worked out once for all
 * its rows, by the store they read.
 * @type {WeakMap<object, Map<string, import('vue').ComputedRef<Map<string, Sharing>|null>>>}
 */
const sharingByStore = new WeakMap()

/**
 * @param {string} storyId
 */
export function useSharedDocuments(storyId) {
  const store = useDocumentsStore()

  let byStory = sharingByStore.get(store)
  if (!byStory) sharingByStore.set(store, (byStory = new Map()))
  let seen = byStory.get(storyId)
  if (!seen) {
    seen = computed(() =>
      inPreview('selective-sharing') && sharing.value.selective.includes(storyId)
        ? sharingOf(
            [...store.documents.values()].filter(row => row.storyId === storyId),
            storyId
          )
        : null
    )
    byStory.set(storyId, seen)
  }
  const known = seen

  /** Whether the project is shared with only some documents, and with someone. */
  const active = computed(
    () => known.value !== null && (sharing.value.projects[storyId]?.members.length ?? 0) > 1
  )

  /**
   * What the others see of a document, in a project shared so.
   * @param {string} id
   * @returns {Sharing|null}
   */
  const sharingOfDocument = id => known.value?.get(id) ?? null

  /**
   * What a document's row shows: shared, seen only on the way, or nothing.
   * @param {string} id
   * @returns {'shared'|'partly'|null}
   */
  const markOf = id => {
    const seenAs = active.value ? sharingOfDocument(id) : null
    return seenAs === 'hidden' ? null : seenAs
  }

  /**
   * Share a document and everything in it, or stop; shared, with the
   * documents it is in up to its folder.
   * @param {string} id
   * @param {boolean} shared
   */
  function setShared(id, shared) {
    store.setShared(
      sharedWith(
        id,
        shared,
        parentId => store.getChildrenOrdered(parentId),
        at => store.getDocument(at) ?? undefined
      )
    )
  }

  return { active, sharingOf: sharingOfDocument, markOf, setShared }
}
