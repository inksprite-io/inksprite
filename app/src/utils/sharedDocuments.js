/**
 * @module utils/sharedDocuments
 * @description Which documents of a project its owner shares with only some
 * of them, as the owner sees and changes it: each document shared, seen only
 * on the way to something shared (a folder, or the project itself), or
 * hidden. The outline marks the first two, and **Share…** ticks the first and
 * half-ticks the second. Sharing a document, or no longer, goes for
 * everything in it, and never changes the folders above: a folder shared
 * with one thing in it held back is still shared, and what is made in it
 * later is shared too. A document that holds others isn't a folder, and
 * what is under it can't be seen without it, so sharing what it holds
 * shares it too.
 *
 * Each document keeps its own answer on its row, `unshared` where it is not
 * shared; the engine hides those from the others but for the folders on the
 * way to something shared (`cloud/tree.js`).
 *
 * Design: `.llm/sync_design.md`, "Only some documents".
 */

import { hiddenDocuments } from '@/cloud/tree.js'

/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {import('primevue/treenode').TreeNode} TreeNode */

/**
 * What the people a document is shared with see of it.
 * @typedef {'shared'|'partly'|'hidden'} Sharing
 */

/**
 * The project's documents as a tree, from its root, in the outline's order.
 *
 * @param {Document} root
 * @param {(parentId: string) => Document[]} childrenOf - In the outline's order,
 *   none in the trash
 * @param {(document: Document) => string} titleOf
 * @returns {TreeNode[]}
 */
export function shareTree(root, childrenOf, titleOf) {
  /** @param {Document} document @returns {TreeNode} */
  const nodeOf = document => {
    const children = childrenOf(document.id).map(nodeOf)
    return {
      key: document.id,
      label: titleOf(document),
      ...(children.length > 0 ? { children } : { leaf: true }),
    }
  }
  return [nodeOf(root)]
}

/**
 * What the others see of each of a project's documents.
 *
 * @param {Document[]} documents - The project's
 * @param {string} storyId
 * @returns {Map<string, Sharing>}
 */
export function sharingOf(documents, storyId) {
  const hidden = hiddenDocuments(documents, storyId)
  return new Map(
    documents.map(document => [
      document.id,
      hidden.has(document.id) ? 'hidden' : document.unshared ? 'partly' : 'shared',
    ])
  )
}

/**
 * What changes when a document is shared, or stops being: it and everything
 * in it, each with whether it is shared now; and, shared, the documents it
 * is in up to its folder, without what else they hold.
 *
 * @param {string} id
 * @param {boolean} shared
 * @param {(parentId: string) => Document[]} childrenOf
 * @param {(id: string) => Document|undefined} documentOf
 * @returns {Map<string, boolean>}
 */
export function sharedWith(id, shared, childrenOf, documentOf) {
  /** @type {Map<string, boolean>} */
  const changes = new Map()
  /** @param {string} at */
  const visit = at => {
    if (changes.has(at)) return
    changes.set(at, shared)
    for (const child of childrenOf(at)) visit(child.id)
  }
  visit(id)
  if (shared) {
    for (
      let at = documentOf(documentOf(id)?.parentId ?? '');
      at && at.type !== 'folder' && !changes.has(at.id);
      at = documentOf(at.parentId)
    ) {
      changes.set(at.id, true)
    }
  }
  return changes
}
