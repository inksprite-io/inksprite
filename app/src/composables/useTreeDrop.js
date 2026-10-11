/**
 * @module composables/useTreeDrop
 * @description Dropping a document on a folder's row, to put it in the folder.
 *
 * The outline's rows are sorted by vuedraggable, which only knows lists: a
 * row dropped on another lands before or after it, in the list that row is
 * in, so a folder could only be gone into through the list under it — a strip
 * a few pixels high, and none at all while the folder is shut. So while a row
 * is being dragged, this watches where the pointer is. Over the middle of a
 * folder's row, that folder is where the drop goes: the row is marked, the
 * list is told to move nothing, and the drop moves the document in. Over the
 * top or bottom of a row, the list sorts as before. A shut folder held over
 * for a moment opens, so the drag can go on into it.
 *
 * One drag happens at a time, so the state is the module's.
 */

import { ref } from 'vue'
import { useDocuments } from './useDocuments.js'

/** How much of a row, from the top and from the bottom, means before and after it. */
export const EDGE = 0.25

/** How long a shut folder is held over before it opens, in milliseconds. */
export const OPEN_AFTER = 600

/**
 * Where on a row a point is: its top or bottom edge, or its middle.
 *
 * @param {{top: number, height: number}} rect - The row's box
 * @param {number} y - The point, in the same coordinates
 * @returns {'before'|'into'|'after'}
 */
export function zoneOf(rect, y) {
  const at = rect.height > 0 ? (y - rect.top) / rect.height : 0.5
  if (at < EDGE) return 'before'
  if (at > 1 - EDGE) return 'after'
  return 'into'
}

/** The folder a drop would go into now, or null where the list decides. */
const into = ref(/** @type {string|null} */ (null))

/** What is being dragged, and in which project. */
let dragging = /** @type {{storyId: string, documentId: string}|null} */ (null)

/**
 * The folder under a point, if the point is over the middle of its row and
 * the document being dragged could go into it.
 *
 * @param {number} x
 * @param {number} y
 * @returns {string|null}
 */
const folderAt = (x, y) => {
  if (!dragging) return null
  const row = document.elementFromPoint(x, y)?.closest?.('[role="treeitem"][data-folder]')
  const folderId = row?.getAttribute('data-document-id')
  if (!row || !folderId || folderId === dragging.documentId) return null
  if (zoneOf(row.getBoundingClientRect(), y) !== 'into') return null
  return useDocuments(dragging.storyId).canDropInto(folderId, dragging.documentId) ? folderId : null
}

/**
 * Follow the pointer: a native drag reports where it is with `dragover`, and
 * the touch fallback with the pointer and touch events it is driven by.
 * Caught on the way down, before the lists' own handlers ask whether to move.
 *
 * @param {DragEvent|PointerEvent|TouchEvent} event
 */
const follow = event => {
  const point = 'touches' in event ? event.touches[0] : event
  if (point) into.value = folderAt(point.clientX, point.clientY)
}

const EVENTS = ['dragover', 'pointermove', 'touchmove']

/**
 * @returns {{
 *   into: import('vue').Ref<string|null>,
 *   start: (storyId: string, documentId: string) => void,
 *   end: () => void,
 *   allowsMove: () => boolean,
 * }}
 */
export function useTreeDrop() {
  /**
   * A row has started being dragged.
   * @param {string} storyId
   * @param {string} documentId
   */
  const start = (storyId, documentId) => {
    dragging = { storyId, documentId }
    into.value = null
    for (const name of EVENTS) document.addEventListener(name, follow, { capture: true })
  }

  /**
   * The drag is over. Over a folder's row, the document goes into it, after
   * whatever the lists did on the way.
   */
  const end = () => {
    for (const name of EVENTS) document.removeEventListener(name, follow, { capture: true })
    const folderId = into.value
    const drag = dragging
    dragging = null
    into.value = null
    if (drag && folderId) useDocuments(drag.storyId).moveInto(folderId, drag.documentId)
  }

  /** Whether the lists may sort the drag now: not while it is over a folder's row. */
  const allowsMove = () => into.value === null

  return { into, start, end, allowsMove }
}
