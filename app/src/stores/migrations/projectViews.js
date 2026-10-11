/**
 * @module stores/migrations/projectViews
 * @description Where the writer left a project comes off its story.
 *
 * The editor's tabs and the panels showing were kept on the story row, so a
 * project reopened as it was left. They belong to this copy of the app, not
 * to the project: in the desktop app's library the story is a file, and a
 * library synced to a second machine would have each machine's tabs written
 * over the other's. They move to `projectViews`, a row a project, kept with
 * the app's settings.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/** The story's fields that are where the writer left it. */
export const VIEW_FIELDS = ['lastDocumentId', 'openDocumentIds', 'previewDocumentId', 'layout']

/**
 * Take where the writer left each project off its story, as a view of its
 * own under the story's id. The view's `updated` is the story's, which tabs
 * and panels moved with every change, so the project last worked in is still
 * the last.
 *
 * Idempotent: a story with none of the fields is left as it is and has no
 * view made for it.
 *
 * @param {any[]} stories - `stories` rows
 * @returns {{stories: any[], views: any[], moved: number}}
 */
export function viewsOffStories(stories) {
  /** @type {any[]} */
  const views = []

  const out = (stories || []).map(story => {
    if (!story || !VIEW_FIELDS.some(field => field in story)) return story

    const rest = { ...story }
    /** @type {Record<string, any>} */
    const view = { id: story.id, version: 1, updated: story.updated ?? 0 }
    for (const field of VIEW_FIELDS) {
      if (!(field in rest)) continue
      view[field] = rest[field]
      delete rest[field]
    }
    views.push(view)
    return rest
  })

  return { stories: out, views, moved: views.length }
}
