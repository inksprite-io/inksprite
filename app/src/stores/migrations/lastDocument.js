/**
 * @module stores/migrations/lastDocument
 * @description Rename `Story.lastSceneId` to `lastDocumentId`.
 *
 * A story remembers where the writer left off. That was a scene id when scenes
 * existed; it is a document id now, and a field named for a type the app no
 * longer has is a trap for whoever reads this next.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/** @typedef {import('../../types/models.js').Story} Story */

/**
 * Move `lastSceneId` onto `lastDocumentId`.
 *
 * Idempotent: a story that already has `lastDocumentId` keeps it, so a retried
 * upgrade or a re-imported backup cannot clobber a newer value with an older
 * one.
 *
 * @param {Array<Story & {lastSceneId?: string|null}>} stories
 * @returns {{stories: Story[], renamed: number}}
 */
export function lastSceneToLastDocument(stories) {
  let renamed = 0

  const out = (stories || []).map(story => {
    if (!story || !('lastSceneId' in story)) return story

    const { lastSceneId, ...rest } = story
    renamed++
    return {
      ...rest,
      lastDocumentId: story.lastDocumentId ?? lastSceneId ?? null,
    }
  })

  return { stories: out, renamed }
}
