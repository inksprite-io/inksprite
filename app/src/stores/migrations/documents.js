/**
 * @module stores/migrations/documents
 * @description Fold the `parts` and `scenes` tables into a single `documents`
 * tree.
 *
 * Kept as a pure function over plain arrays for two reasons: it can be tested
 * without an IndexedDB implementation, and the same transform serves both the
 * Dexie upgrade hook and backup restore (see `utils/backup.js`), so the two
 * can never drift apart.
 *
 * IDs are preserved. A part stays `part_xxx`, a scene stays `scene_xxx`, and
 * drafts stays `drafts_storyId`. Everything that already points at those ids —
 * scene beats, persisted UI state, scene ids baked into stored chat
 * trajectories — keeps resolving without a rewrite.
 */

/**
 * @typedef {import('../../types/models.js').Part} Part
 * @typedef {import('../../types/models.js').Scene} Scene
 * @typedef {import('../../types/models.js').Document} Document
 */

/**
 * Convert parts and scenes into documents.
 *
 * Parts become folders parented to their story; scenes become text documents
 * parented to their part. A scene carries no `storyId` of its own, so it is
 * resolved through the part — which is why a scene whose part is missing has
 * to be skipped rather than guessed at.
 *
 * @param {Part[]} parts
 * @param {Scene[]} scenes
 * @returns {{documents: Document[], skipped: Array<{id: string, reason: string}>}}
 */
export function partsAndScenesToDocuments(parts, scenes) {
  /** @type {Document[]} */
  const documents = []
  /** @type {Array<{id: string, reason: string}>} */
  const skipped = []
  /** @type {Map<string, string>} */
  const storyIdByPart = new Map()

  for (const part of parts || []) {
    if (!part || !part.id) {
      skipped.push({ id: String(part && part.id), reason: 'part has no id' })
      continue
    }
    if (!part.storyId) {
      skipped.push({ id: part.id, reason: 'part has no storyId' })
      continue
    }

    storyIdByPart.set(part.id, part.storyId)
    documents.push({
      id: part.id,
      storyId: part.storyId,
      // The story is the root of its own tree, so root documents are parented
      // to it. IndexedDB does not index null, and a null parent would make
      // exactly the top-level documents invisible to a parentId query.
      parentId: part.storyId,
      order: part.order ?? 0,
      type: 'folder',
      title: part.title ?? '',
      content: '',
      summary: part.summary ?? '',
      wordCount: 0,
      version: part.version ?? 1,
      // A part deleted before v17 stays marked, for the v17 upgrade to drop.
      .../** @type {any} */ (
        /** @type {any} */ (part).deleted
          ? { deleted: true, deletedAt: /** @type {any} */ (part).deletedAt ?? null }
          : {}
      ),
      created: part.created,
      updated: part.updated,
    })
  }

  for (const scene of scenes || []) {
    if (!scene || !scene.id) {
      skipped.push({ id: String(scene && scene.id), reason: 'scene has no id' })
      continue
    }

    const storyId = storyIdByPart.get(scene.partId)
    if (!storyId) {
      // Orphans are already invisible in the app — scenes load per part, so a
      // scene whose part is gone is never read. Dropping it changes nothing a
      // user can see, and inventing a storyId would resurrect it in the wrong
      // story.
      skipped.push({ id: scene.id, reason: `no part '${scene.partId}' to resolve a story from` })
      continue
    }

    documents.push({
      id: scene.id,
      storyId,
      parentId: scene.partId,
      order: scene.order ?? 0,
      type: 'text',
      title: scene.title ?? '',
      content: scene.content ?? '',
      summary: scene.summary ?? '',
      wordCount: scene.wordCount ?? 0,
      version: scene.version ?? 1,
      // A scene deleted before v17 stays marked, for the v17 upgrade to drop.
      .../** @type {any} */ (
        /** @type {any} */ (scene).deleted
          ? { deleted: true, deletedAt: /** @type {any} */ (scene).deletedAt ?? null }
          : {}
      ),
      created: scene.created,
      updated: scene.updated,
    })
  }

  return { documents, skipped }
}
