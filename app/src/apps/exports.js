/**
 * @module apps/exports
 * @description A document or a folder handed to a connected app as files,
 * for it to put where it works: a design into a repository.
 *
 * inksprite writes nothing on the app's side, and is told no path there. It
 * makes the export ready and answers with a link, which the app's own shell
 * fetches, into wherever it runs the command: its own files, by its own
 * permissions, in a container as well as beside the app. The link is good
 * once, for a few minutes, and is all it takes, the connection's token
 * being nothing an app's model is ever shown (`electron/src/appExports.js`).
 *
 * What is exported is what the app reads: nothing hidden from models, each
 * text as it stands without comments or suggestions, and stamped with the
 * document it came from (`files/exportStamp.js`). One file goes as itself,
 * more as a tar. A repository imported into the project is left out: its
 * files are where it came from, which is likely where the export is going.
 * A picture comes with the text that shows it only where the document it
 * belongs to is one the app sees in this project.
 *
 * The command an answer gives is run by a shell we know nothing of, so
 * nothing in it is a name of the writer's making: a document's title may
 * have come from a web page or a file's name, and what quotes it for one
 * shell runs it in another. The file is saved under a plain name
 * (`plainName`), and the answer's `file` has the real one.
 */

import { documentForChat, documentsForChat } from '@/ai/tools/documents.js'
import { fileOfExport } from '@/composables/useExport.js'
import { useDocuments } from '@/composables/useDocuments.js'
import { exportEntries } from '@/files/exportDocument.js'
import { stamped } from '@/files/exportStamp.js'
import { offerAppExport } from '@/platform/apps.js'
import { isRepository, repositoryOf } from '@/source/tree.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { useFilesStore } from '@/stores/filesStore'
import { documentPath } from '@/utils/documentPath.js'
import { pictureOfKey } from '@/utils/pictures.js'

/** @typedef {import('@/platform/apps.js').AskingApp} AskingApp */

/** The most that is handed over at once: what the native side holds. */
export const EXPORT_MOST = 256 * 1024 * 1024

/** How many of an archive's files an answer names. */
const FILES_MOST = 200

/** What an answer says of its link. */
export const LINK_NOTE =
  'The link works once, and for five minutes. To change the text, change the document here and export again.'

/**
 * The link as a shell takes it whole, whichever shell: sh and its kin,
 * PowerShell and cmd.exe all read double quotes, and cmd.exe reads no other.
 * A link is made here of an address the native side checked and an id of
 * letters, digits, dashes and underscores, so it holds nothing any of them
 * expands; one that held anything else is not put in a command.
 * @param {string} link
 */
export const quoted = link => {
  if (!/^[\w:/.[\]-]+$/.test(link)) throw new Error('The link can’t be put in a command.')
  return `"${link}"`
}

/**
 * A file's name as a command can hold it, with no quoting, in any shell: its
 * letters and digits, of any script, with `.`, `_` and `-`, and one `-` for
 * each run of anything else, a space or a quote among them. Never empty, and
 * never starting with a dot or a dash, which would hide the file or be read
 * as an option. The marks that are part of a letter in many scripts are kept
 * with it.
 *
 * @param {string} name
 * @returns {string}
 */
export function plainName(name) {
  const plain = name
    .replace(/[^\p{L}\p{M}\p{N}._-]/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
  return plain || 'export'
}

/**
 * Make a document, or a folder with what is in it, ready for an app to
 * fetch, and say how.
 *
 * @param {AskingApp} app
 * @param {{storyId: string, chatId: string}} asking
 * @param {{path?: unknown}} args
 * @returns {Promise<Record<string, any>>} The link and the command that
 *   fetches it, or what went wrong, in words for the app's model
 */
export async function exportFor(app, asking, args) {
  const path = typeof args?.path === 'string' && args.path.trim() ? args.path : '/'
  const found = await documentForChat(asking.storyId, asking.chatId, path)
  if (!found) return { error: `Nothing at "${path}". list_documents shows what the project holds.` }

  const api = useDocuments(asking.storyId)
  await api.init()
  if (repositoryOf(api.get, found.document)) {
    return {
      error: `"${found.path}" is in a repository imported into the project, which is not exported: its files are where it came from.`,
    }
  }

  // The project as the app sees it, without its repositories.
  const seen = new Set(
    (await documentsForChat(asking.storyId, asking.chatId)).map(({ document }) => document.id)
  )
  const rootId = rootIdFor(asking.storyId)
  const project = api.get(rootId)?.title?.trim() || 'Untitled'
  const files = useFilesStore()
  const made = await exportEntries(
    {
      tree: {
        get: api.get,
        childrenOf: id =>
          api.childrenOf(id).filter(child => seen.has(child.id) && !isRepository(child)),
        rootId,
      },
      content: api.currentContent,
      // A picture is its document's own, kept by that document's id: read
      // only where the document is one the app sees in this project,
      // whatever document a text here names as the picture's.
      read: async key => {
        const picture = pictureOfKey(key)
        return picture && !seen.has(picture.documentId) ? null : files.getFile(key)
      },
      // A file in a repository ends with a newline: an editor there adds
      // one, and the file would then read as changed.
      stamp: (document, text) =>
        stamped(
          { project, document: documentPath(api.get, document), id: document.id },
          text.endsWith('\n') ? text : `${text}\n`
        ),
    },
    found.document.id
  )

  const paths = made.entries.flatMap(entry => ('folder' in entry ? [] : [entry.path]))
  if (paths.length === 0) {
    return {
      error:
        made.missing > 0
          ? `"${found.path}" couldn't be exported: its file is still on the sync server, and couldn't be downloaded.`
          : `"${found.path}" holds nothing to export.`,
    }
  }

  const { blob, filename } = await fileOfExport(made, found.document.type === 'folder', 'tar')
  if (blob.size > EXPORT_MOST) {
    return {
      error: `"${found.path}" is more than can be handed over at once (${Math.round(EXPORT_MOST / 1024 / 1024)} MB). Export a folder within it, or its documents one at a time.`,
    }
  }
  const { id } = await offerAppExport(app.id, {
    name: filename,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  })
  const url = `${app.address}/export/${id}`
  const left =
    made.missing > 0
      ? {
          missing: made.missing,
          missingNote:
            'That many files are left out: their bytes are still on the sync server, and could not be downloaded.',
        }
      : {}

  // One file, as itself, saved under a name that is safe in any shell.
  if (paths.length === 1 && made.entries.length === 1) {
    const plain = plainName(filename)
    const renamed =
      plain === filename
        ? ''
        : ` It saves the file as "${plain}", a name any shell takes as it is; \`file\` is what the document is called.`
    return {
      file: filename,
      url,
      command: `curl -fsS ${quoted(url)} -o ${plain}`,
      note: `${LINK_NOTE} The command writes the file into the directory it is run in: run it where the file should go, or give -o another path.${renamed}`,
      ...left,
    }
  }
  return {
    files: paths.slice(0, FILES_MOST),
    ...(paths.length > FILES_MOST ? { more: paths.length - FILES_MOST } : {}),
    url,
    command: `curl -fsS ${quoted(url)} | tar -x`,
    note: `${LINK_NOTE} It is a tar archive of the files named, by those paths: the command unpacks it into the directory it is run in, over files of the same names there.`,
    ...left,
  }
}
