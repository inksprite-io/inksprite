/**
 * @module apps/revisions
 * @description What a connected app has of a document, and what has changed
 * in it since.
 *
 * A chat's model is told on every turn which of the documents it read have
 * changed (the project block's `changed`). An app is told nothing between
 * its calls, so its calls carry it: every read and write of a document
 * answers with the document's `revision`, a short hash of its text and its
 * comments as the connection reads them, and `changes_since` answers, for a
 * revision the app holds, what the writer has done since: the text as a
 * diff, what was said on its comments, and which of the connection's own
 * suggestions were accepted or rejected. That is the second round of a
 * review, without reading the document again.
 *
 * To say what changed, what the connection last had of each document is
 * kept: its text and the state of its comments, by the native side
 * (`platform/apps.js`), on this computer, and gone with the connection. One
 * record for each document, the last, with the revisions the connection held
 * on its way there: an app holds the revision of its read while its own
 * edits move the document on, and asked with that one, it is told what has
 * changed since the last of them. A revision that is none of these can't be
 * told from, and the app is to read the document again.
 *
 * A write tells the app the revision it left. Where the document had
 * changed since the app last had it, besides the write, what is kept stays
 * as it was, and the answer says so: the app has not seen those changes,
 * and `changes_since` with the revision it held still shows them.
 */

import { documentForChat, pathInProject } from '@/ai/tools/documents.js'
import { postsOf } from '@/ai/tools/commentReads.js'
import { textHash } from '@/ai/context/reads.js'
import { peopleOf } from '@/cloud/people.js'
import { useEditor } from '@/composables/useEditor.js'
import { appRead, appReads, keepAppRead } from '@/platform/apps.js'
import { lineDiff } from '@/utils/lineDiff.js'

/** @typedef {import('@/platform/apps.js').AskingApp} AskingApp */
/** @typedef {import('@/types/models.js').CommentThread} CommentThread */

/**
 * Who is asking, and in which project.
 * @typedef {{storyId: string, chatId: string}} Asking
 */

/**
 * A comment thread as a connection last had it: enough to tell what was
 * said or settled since.
 *
 * @typedef {Object} SeenThread
 * @property {'open'|'resolved'} status
 * @property {number} posts - How many
 * @property {string} said - A hash of what they say
 * @property {true} [mine] - A suggestion of the connection's own
 * @property {string} [settled] - How a suggestion ended, once it has
 */

/**
 * What a connection has of a document.
 *
 * @typedef {Object} Seen
 * @property {string} storyId
 * @property {string} document - Its id
 * @property {string} path - As it was then
 * @property {string} revision
 * @property {string|null} text - As the connection read it; null for a file's
 *   text, which is never written to, and for one too long to keep
 * @property {Record<string, SeenThread>} threads
 * @property {string[]} [passed] - The revisions the connection held before
 *   this one, the latest last, having seen all that changed from each to the
 *   next: its own writes, a whole read, or what `changes_since` showed it
 * @property {number} at - When
 */

/** The longest text kept to tell changes from, in characters. */
export const TEXT_MOST = 1_000_000

/** How many of the revisions a connection held before the last are remembered. */
export const PASSED_MOST = 20

/** What `changes_since` says of a revision from before the connection's last call on the document. */
export const EARLIER_NOTE =
  'The revision you gave is from before your last read or write of this document. These are the changes since that one, the revision under `since`.'

/** What `changes_since` says of a revision it has no record of. */
export const UNKNOWN_NOTE = 'No record is kept of that revision. Read the document again.'

/** What an answer says where the document had changed since the connection last had it. */
export const CHANGED_SINCE_NOTE =
  'The document has changed since the revision you last had of it, apart from this call. changes_since with that revision shows how.'

/**
 * A document as a connection reads it now: what it would be kept as, and
 * its threads as they are. Null for a path with no document, and a folder.
 *
 * @param {Asking} asking
 * @param {string} path
 * @returns {Promise<{seen: Seen, threads: Record<string, CommentThread>}|null>}
 */
export async function stateAt(asking, path) {
  // What was just typed is in the editor until a pause: have it written out.
  useEditor().flush()
  const found = await documentForChat(asking.storyId, asking.chatId, path)
  if (!found || found.document.type === 'folder') return null
  const { document } = found
  const text = document.content || ''
  const all = /** @type {Record<string, CommentThread>} */ (document.comments || {})

  // The comments, and the connection's own suggestions: another's suggestion
  // is not in what this one reads, and its coming and going changes nothing.
  /** @type {Record<string, SeenThread>} */
  const threads = {}
  for (const id of Object.keys(all).sort()) {
    const thread = all[id]
    const mine = thread.suggestion?.chat === asking.chatId
    if (thread.suggestion && !mine) continue
    threads[id] = {
      status: thread.status,
      posts: thread.posts.length,
      said: textHash(JSON.stringify(thread.posts.map(post => [post.author, post.name, post.text]))),
      ...(mine ? { mine: /** @type {const} */ (true) } : {}),
      ...(thread.suggestion?.settled ? { settled: thread.suggestion.settled } : {}),
    }
  }

  return {
    seen: {
      storyId: asking.storyId,
      document: document.id,
      path: found.path,
      revision: textHash(`${text}\n${JSON.stringify(threads)}`),
      text: document.type === 'text' && text.length <= TEXT_MOST ? text : null,
      threads,
      at: Date.now(),
    },
    threads: all,
  }
}

/**
 * Keep what a connection now has of a document, in place of what it had.
 * The revisions it held before are kept with it where it has seen all that
 * changed since them; where it hasn't, they are let go, and asking with one
 * says to read the document again.
 *
 * @param {AskingApp} app
 * @param {Seen} seen
 * @param {Seen|null} [had] - What it had
 * @param {boolean} [sawAll] - Whether it has seen everything that changed
 *   from what it had to this
 * @returns {Promise<void>}
 */
export async function keep(app, seen, had = null, sawAll = false) {
  const passed = !had
    ? []
    : had.revision === seen.revision
      ? (had.passed ?? [])
      : sawAll
        ? [...(had.passed ?? []), had.revision]
            .filter(revision => revision !== seen.revision)
            .slice(-PASSED_MOST)
        : []
  try {
    await keepAppRead(app.id, seen.document, { ...seen, ...(passed.length ? { passed } : {}) })
  } catch (error) {
    // Not kept: `changes_since` will say to read again.
    console.error('What a connected app read could not be kept:', error)
  }
}

/**
 * What a connection last had of a document, or null.
 *
 * @param {AskingApp} app
 * @param {string} documentId
 * @returns {Promise<Seen|null>}
 */
export async function kept(app, documentId) {
  const record = /** @type {any} */ (await appRead(app.id, documentId).catch(() => null))
  return record && typeof record.revision === 'string' && record.threads ? record : null
}

/**
 * Run a call that reads or writes one document, and put the document's
 * revision in its answer. What the connection has of it is kept as it is
 * now, unless the document had changed since the connection last had it
 * for some other reason than this call: then the answer says so, with the
 * revision it had, and what is kept stays, for `changes_since` to show what
 * it has not seen. A call that sends the whole text leaves nothing unseen.
 *
 * @param {AskingApp} app
 * @param {Asking} asking
 * @param {string} path - Where the document is as the call is made; nowhere
 *   yet for one the call makes
 * @param {() => Promise<any>} run
 * @param {(answer: any) => boolean} [sendsAll] - Whether an answer sends the
 *   document's whole text
 * @returns {Promise<any>}
 */
export async function withRevision(app, asking, path, run, sendsAll = () => false) {
  const before = path ? await stateAt(asking, path) : null
  const had = before ? await kept(app, before.seen.document) : null
  const answer = await run()
  if (!answer || typeof answer !== 'object' || 'error' in answer) return answer

  const now = await stateAt(asking, answer.document?.path ?? answer.path ?? path)
  if (!now) return answer
  const current = sendsAll(answer) || !before || !had || had.revision === before.seen.revision
  // Seen whole, or the call's own change to what it had: nothing it missed.
  if (current) await keep(app, now.seen, had, true)
  return {
    ...answer,
    revision: now.seen.revision,
    ...(current
      ? {}
      : {
          changedSince: { revision: /** @type {Seen} */ (had).revision, note: CHANGED_SINCE_NOTE },
        }),
  }
}

/**
 * Whether a document is still at a revision a connection holds: a read can
 * then say so, and send nothing.
 *
 * @param {AskingApp} app
 * @param {Asking} asking
 * @param {string} path
 * @param {unknown} revision
 * @returns {Promise<{path: string, revision: string, unchanged: string}|null>}
 */
export async function unchangedAt(app, asking, path, revision) {
  if (typeof revision !== 'string' || !revision) return null
  const now = await stateAt(asking, path)
  if (!now || now.seen.revision !== revision) return null
  await keep(app, now.seen, await kept(app, now.seen.document))
  return { path: now.seen.path, revision, unchanged: 'Unchanged since that revision.' }
}

/**
 * What was said on a document's comments since a connection last had it:
 * a comment made, with all that was said on it; one answered, with what
 * was said since; one resolved or reopened.
 *
 * @param {Seen} had
 * @param {Record<string, CommentThread>} threads - As they are
 * @param {string} storyId
 */
function commentsSince(had, threads, storyId) {
  const people = peopleOf(storyId)
  /** @type {Array<Record<string, any>>} */
  const changed = []
  for (const [id, thread] of Object.entries(threads)) {
    if (thread.suggestion) continue
    const before = had.threads[id]
    const said = (/** @type {number} */ from) =>
      postsOf({ ...thread, posts: thread.posts.slice(from) }, null, people)
    if (!before) {
      changed.push({
        id,
        new: true,
        passage: thread.quote,
        ...(thread.status === 'resolved' ? { resolved: true } : {}),
        posts: said(0),
      })
      continue
    }
    const more = thread.posts.length > before.posts
    const settled = thread.status !== before.status
    if (!more && !settled) continue
    changed.push({
      id,
      passage: thread.quote,
      ...(settled ? (thread.status === 'resolved' ? { resolved: true } : { reopened: true }) : {}),
      ...(more ? { posts: said(before.posts) } : {}),
    })
  }
  return changed
}

/**
 * Which of a connection's suggestions, waiting when it last had the
 * document, the writer has settled since, and how.
 *
 * @param {Seen} had
 * @param {Record<string, CommentThread>} threads - As they are
 */
function suggestionsSince(had, threads) {
  /** @type {Array<{id: string, outcome: string, from: string, to: string}>} */
  const settled = []
  for (const [id, before] of Object.entries(had.threads)) {
    const suggestion = threads[id]?.suggestion
    if (!before.mine || before.settled || !suggestion?.settled) continue
    settled.push({
      id,
      outcome: suggestion.settled,
      from: threads[id].quote,
      to: suggestion.text,
    })
  }
  return settled
}

/**
 * The documents under a folder that a connection has read and that have
 * changed since, each with the revision it had of it, and those that are
 * gone.
 *
 * @param {AskingApp} app
 * @param {Asking} asking
 * @param {string} folder - Its path; `/` for the project
 */
async function changedUnder(app, asking, folder) {
  const within = folder === '/' ? '' : `${folder}/`
  const records = /** @type {any[]} */ (await appReads(app.id).catch(() => []))
  /** @type {Array<{path: string, revision: string}>} */
  const changed = []
  /** @type {string[]} */
  const gone = []
  for (const record of records) {
    if (record?.storyId !== asking.storyId || typeof record.document !== 'string') continue
    const path = await pathInProject(asking, record.document)
    const now = path ? await stateAt(asking, path) : null
    if (!now) {
      if (String(record.path).startsWith(within)) gone.push(String(record.path))
    } else if (now.seen.path.startsWith(within) && now.seen.revision !== record.revision) {
      changed.push({ path: now.seen.path, revision: record.revision })
    }
  }
  const by = (/** @type {string} */ a, /** @type {string} */ b) => a.localeCompare(b)
  return {
    changed: changed.sort((a, b) => by(a.path, b.path)),
    ...(gone.length ? { gone: gone.sort(by) } : {}),
    note:
      changed.length > 0
        ? 'Each has changed since the revision given, which is the one you had: changes_since with its path and that revision shows how.'
        : 'Nothing you have read here has changed.',
  }
}

/**
 * What has changed since a revision a connection holds: in a document, its
 * text as a diff, what was said on its comments, and how the connection's
 * suggestions were settled; under a folder, which of the documents the
 * connection has read have changed.
 *
 * @param {AskingApp} app
 * @param {Asking} asking
 * @param {{path?: string, revision?: string}} args
 * @returns {Promise<Record<string, any>>}
 */
export async function changesSince(app, asking, args) {
  const path = typeof args?.path === 'string' && args.path.trim() ? args.path : '/'
  const found = await documentForChat(asking.storyId, asking.chatId, path)
  if (!found) return { error: `Nothing at "${path}". list_documents shows what the project holds.` }
  if (found.document.type === 'folder') return changedUnder(app, asking, found.path)

  const now = await stateAt(asking, path)
  if (!now) return { error: `Nothing at "${path}". list_documents shows what the project holds.` }
  if (typeof args.revision !== 'string' || !args.revision) {
    return {
      error:
        'Give the revision you hold of it as "revision": every read and write of a document answers with one.',
    }
  }
  const { seen, threads } = now
  const had = await kept(app, seen.document)
  if (args.revision === seen.revision) {
    await keep(app, seen, had)
    return {
      path: seen.path,
      revision: seen.revision,
      unchanged: 'Nothing has changed since that revision.',
    }
  }

  // The revision it last had, or one it held on its way there: its own
  // writes have moved the document on since, and it has seen what they did.
  const earlier = Boolean(had && had.revision !== args.revision)
  if (!had || (earlier && !had.passed?.includes(args.revision))) {
    return { path: seen.path, revision: seen.revision, unknown: UNKNOWN_NOTE }
  }
  if (had.revision === seen.revision) {
    return {
      path: seen.path,
      revision: seen.revision,
      unchanged: 'Nothing has changed since you last read or wrote it.',
    }
  }
  if (had.text === null || seen.text === null) {
    return { path: seen.path, revision: seen.revision, unknown: UNKNOWN_NOTE }
  }

  const diff = lineDiff(had.text, seen.text)
  const comments = commentsSince(had, threads, asking.storyId)
  const suggestions = suggestionsSince(had, threads)
  await keep(app, seen, had, true)
  return {
    path: seen.path,
    revision: seen.revision,
    since: had.revision,
    ...(earlier ? { earlier: EARLIER_NOTE } : {}),
    ...(had.path !== seen.path ? { movedFrom: had.path } : {}),
    ...(suggestions.length ? { suggestions } : {}),
    ...(diff === null
      ? { note: 'The text changed too much to show line by line. Read it again.' }
      : diff
        ? { content: diff }
        : { text: 'The text is as it was.' }),
    ...(comments.length ? { comments } : {}),
  }
}
