/**
 * @module stores/migrations/commentThreads
 * @description What each comment says moves out of the text onto its
 * document's row.
 *
 * A comment was CriticMarkup holding its id and what was said,
 * `{==passage==}{>>c7k2m1: reword this<<}`. The text keeps the passage and the
 * id now, `{==passage==}{>>c7k2m1<<}`, and what was said is the first post of
 * a thread in the row's `comments`, by that id, so that a comment can have
 * replies and say who wrote it. Every comment from before is the writer's;
 * the model could not make one. The post is dated with the document's last
 * change, which is when it was last known to stand, and the same on every
 * run, so a backup restored twice comes out the same.
 *
 * Plain documents too: their text is stored as typed, and the Comments tab
 * read comments out of it all the same.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform. Idempotent: a document with nothing in the old
 * form is left as it is.
 */

import { liftThreads } from '../../editor/comments.js'

/** @typedef {import('../../types/models.js').Document} Document */

/**
 * @param {Document[]} documents
 * @returns {{documents: Document[], moved: number}} The documents, and how
 *   many comments moved
 */
export function threadsOffText(documents) {
  let moved = 0
  const brought = documents.map(document => {
    if (document?.type !== 'text' || typeof document.content !== 'string') return document
    const { content, threads, lifted } = liftThreads(
      document.content,
      document.comments,
      document.updated || 0
    )
    if (lifted === 0) return document
    moved += lifted
    return { ...document, content, comments: threads }
  })
  return { documents: brought, moved }
}
