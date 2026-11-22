/* global File */
/**
 * @module apps/imports
 * @description A file brought into a project by a connected app, from where
 * it works: a design's Markdown, a script, a PDF.
 *
 * The reverse of an export (`./exports.js`), and made the same way. The app
 * is answered with a link, which its own shell sends the file to, by its
 * own permissions, from a container as well as from beside the app; the
 * file never passes through its model, which would have to write it out
 * again in tokens and could change it on the way. The link is good for one
 * file, for a few minutes, and is all it takes (`electron/src/appImports.js`).
 *
 * Where the file goes is settled as the link is made, and again as the file
 * comes: a folder the app sees, outside a repository, with nothing there by
 * the name the file takes, for a connection that writes in that project
 * still. It is then brought in as the writer's own import brings a file in
 * (`composables/useCardImport.js`), by what is in it, and never read as a
 * character card: Markdown and a Word file become documents, and anything
 * else, plain text among it, is kept as the file it is, with its text
 * readable.
 */

import { newDocumentAt, pathInProject } from '@/ai/tools/documents.js'
import { useCardImport } from '@/composables/useCardImport.js'
import { UNKNOWN_MIME, hasText, mimeOf, titleOf } from '@/files/inspect.js'
import { awaitAppImport, takeAppImport } from '@/platform/apps.js'
import { languageOf } from '@/source/language.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { quoted } from './exports.js'
import { inProject } from './projects.js'
import { stateAt, withRevision } from './revisions.js'

/** @typedef {import('@/platform/apps.js').AskingApp} AskingApp */

/** What the command an answer gives has in place of the file's path, for the app to fill in. */
export const FILE = 'FILE'

/** What an answer says of its link. */
export const IMPORT_NOTE = `Run the command with ${FILE} replaced by the path of the file on your side, quoted as your shell needs. The link takes one file, within five minutes. The command prints what the file became in the project, or why it couldn't be brought in.`

/** What a file sent by a link is told when the link has nothing waiting for it. */
const NOTHING_SENT = 'Nothing is waiting by that link. import_document gives another.'

/** Markdown, which comes in as a document under its name without the extension. */
const MARKDOWN = /\.(md|markdown)$/i

/** A Word file, which comes in as a document too. */
const WORD = /\.docx$/i

/**
 * What a file is likely to be called in the project, before it has come:
 * what the writer's own import names it (`useCardImport`), which a
 * document's title drops the extension of, and a file's keeps where it is
 * part of the name, as a script's is. A name of no type the app knows is
 * taken for text, as a file of one usually is; the file itself settles it
 * as it comes.
 *
 * @param {string} name
 * @returns {string}
 */
export function titleFor(name) {
  if (MARKDOWN.test(name)) return name.replace(/\.[^.]+$/, '').trim() || name
  if (WORD.test(name)) return titleOf(name)
  const mime = mimeOf(name)
  return titleOf(name, mime === UNKNOWN_MIME ? languageOf(name).mime : mime)
}

/**
 * A file's name, and the folder it goes in, from the path a call gives.
 *
 * @param {unknown} path
 * @returns {{folder: string, name: string}|{error: string}}
 */
function splitPath(path) {
  const segments = (typeof path === 'string' ? path : '')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
  const name = segments.pop()
  if (!name) {
    return {
      error:
        'Give the path the file should have: its folder, then its name with its extension, e.g. "Research/Notes.md".',
    }
  }
  if (name.startsWith('id:')) return { error: 'A new file has no id yet: give its path.' }
  return { folder: segments.join('/'), name }
}

/**
 * Where a file taken under a title would go: the folder and the title, as
 * create_document has them, or why it can't.
 *
 * @param {{storyId: string, chatId: string}} asking
 * @param {string} folder - The folder's path, '' for the project's top
 * @param {string} title
 * @returns {Promise<{parentId: string, title: string, path: string}|{error: string}>}
 */
async function placeFor(asking, folder, title) {
  const full = [folder, title].filter(Boolean).join('/')
  const place = await newDocumentAt(asking, full)
  if ('error' in place && place.error.endsWith('Use update_document to change it.')) {
    return {
      error: `There is already something at "${full}". Import under another name, or delete it first.`,
    }
  }
  return place
}

/**
 * Wait for a file from an app, and say how to send it.
 *
 * @param {AskingApp} app
 * @param {{storyId: string, chatId: string}} asking
 * @param {{path?: unknown}} args
 * @returns {Promise<Record<string, any>>} The link and the command that sends
 *   the file, or what is wrong, in words for the app's model
 */
export async function importFor(app, asking, args) {
  const split = splitPath(args?.path)
  if ('error' in split) return split
  const place = await placeFor(asking, split.folder, titleFor(split.name))
  if ('error' in place) return place

  const { id } = await awaitAppImport(app.id, {
    storyId: asking.storyId,
    parentId: place.parentId,
    name: split.name,
  })
  const url = `${app.address}/import/${id}`
  return { url, command: `curl -sS -T ${FILE} ${quoted(url)}`, note: IMPORT_NOTE }
}

/**
 * What a link was for, as the page that made it said, or null for anything
 * else.
 *
 * @param {unknown} about
 * @returns {{storyId: string, parentId: string, name: string}|null}
 */
function aboutOf(about) {
  const { storyId, parentId, name } = /** @type {Record<string, unknown>} */ (about ?? {})
  return typeof storyId === 'string' &&
    typeof parentId === 'string' &&
    typeof name === 'string' &&
    storyId &&
    parentId &&
    name
    ? { storyId, parentId, name }
    : null
}

/**
 * Take a file an app sent by a link, in the window that has its project, and
 * bring it in where the link said, saying what it became. Asked by the
 * door, never by the app (`electron/src/appServer.js`), as the file comes.
 *
 * @param {AskingApp} app - The connection as it is now
 * @param {{id?: unknown, about?: unknown}} params - The link's id, and what
 *   it was for, which says which project to take it in
 * @param {AbortSignal} signal
 * @returns {Promise<{answer: Record<string, any>}|{pass: 'elsewhere'|'behind'}>}
 */
export async function receivedFor(app, params, signal) {
  const asked = aboutOf(params?.about)
  const id = typeof params?.id === 'string' ? params.id : ''
  if (!asked || !id) return { answer: { error: NOTHING_SENT } }

  const ran = await inProject(asked.storyId, async () => {
    const taken = await takeAppImport(app.id, id)
    const about = aboutOf(taken?.about)
    if (!taken || !about || about.storyId !== asked.storyId) return { error: NOTHING_SENT }

    // The connection as it is now: one that only reads, or no longer has
    // the project, brings nothing in.
    if (app.readOnly) return { error: 'This connection only reads: nothing was brought in.' }
    if (!app.projects.includes(about.storyId)) {
      return { error: 'That project is no longer open to this connection: nothing was brought in.' }
    }
    if (signal.aborted) return { error: 'The upload was given up on: nothing was brought in.' }

    /** @type {{storyId: string, chatId: string, postsAs: string, signal: AbortSignal}} */
    const asking = { storyId: about.storyId, chatId: `app:${app.id}`, postsAs: app.name, signal }
    const folder =
      about.parentId === rootIdFor(about.storyId) ? '' : await pathInProject(asking, about.parentId)
    if (folder === '' && about.parentId !== rootIdFor(about.storyId)) {
      return {
        error:
          'The folder the file was to go in is gone. import_document gives another link, for where it should go now.',
      }
    }

    const bytes = /** @type {BlobPart} */ (taken.bytes)
    const file = new File([bytes], about.name, { type: mimeOf(about.name) })
    const importer = useCardImport(about.storyId)
    /** @type {Awaited<ReturnType<typeof importer.inspect>>} */
    let found
    try {
      found = await importer.inspect(file, { cards: false })
    } catch (error) {
      return {
        error: `"${about.name}" couldn't be read: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    const place = await placeFor(asking, folder, found.title)
    if ('error' in place) return place

    const written = await importer.write(found, { parentId: place.parentId })
    const path = (await pathInProject(asking, written.folderId)) || place.path
    const kind =
      found.shape === 'file'
        ? {
            type: 'file',
            mime: found.mime,
            // A picture has none to read; a PDF that has none is a scan.
            ...(found.text || !hasText(found.mime || '')
              ? {}
              : { note: 'No text could be read out of it.' }),
          }
        : { type: 'text' }
    const answer = { success: true, document: { path, ...kind } }
    return withRevision(app, { before: null, after: await stateAt(asking, path) }, answer, true)
  })
  return 'pass' in ran ? ran : { answer: ran.value }
}
