/* global Blob */
/**
 * @module composables/useDriveSync
 * @description A linked document synced with its Google Doc, from its menu
 * or the Sync button over it.
 *
 * The steps are `drive/sync.js`'s. This signs in for them (`drive/session.js`,
 * from the click, which in a browser is what lets Google's window open),
 * hands them the document as it stands and its base, asks the writer what
 * they ask, and puts what comes back in place: the Doc's new pictures made
 * the document's own, the document edited to the merge rather than replaced,
 * so a document open keeps its caret and can undo the sync in one step, and
 * the Doc as it now reads kept as the next sync's base. One question is
 * asked at a time, app-wide, by `DriveSyncDialog.vue`.
 *
 * Design: `.llm/google_docs_design.md`, part 3, Sync.
 */

import { reactive, shallowRef } from 'vue'
import { driveConfig } from '@/drive/config.js'
import {
  DriveError,
  NotGrantedError,
  PopupBlockedError,
  SignInLapsedError,
} from '@/drive/errors.js'
import { forgetSession, signInFor } from '@/drive/session.js'
import { syncDoc } from '@/drive/sync.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { measurePicture } from '@/files/pictures.js'
import { storage } from '@/storage/index.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useFilesStore } from '@/stores/filesStore.js'
import { pictureKey } from '@/utils/pictures.js'
import { useDocuments } from './useDocuments.js'
import { useEditor } from './useEditor.js'
import { useToast } from './useToast.js'

/**
 * @typedef {import('@/drive/merge.js').Clash} Clash
 * @typedef {import('@/drive/sync.js').Side} Side
 * @typedef {import('@/drive/sync.js').Synced} Synced
 */

/**
 * What a sync is waiting for the writer to say: which side's text a first
 * sync takes, or which side's words each clash keeps. Answered with null
 * to cancel the sync.
 *
 * @typedef {{kind: 'first', title: string, answer: (side: Side|null) => void}
 *   |{kind: 'clashes', title: string, clashes: Clash[], answer: (sides: Side[]|null) => void}} Question
 */

/** Documents being synced, by id. */
const syncing = reactive(new Set())

/** @type {import('vue').ShallowRef<Question|null>} The question being asked, if one is. */
const question = shallowRef(null)

/** Questions waiting their turn behind it, a sync's from another document. */
/** @type {Array<() => void>} */
const queue = []

/**
 * Ask the writer, once the question before has been answered.
 *
 * @template T
 * @param {(answer: (value: T) => void) => Question} make
 * @returns {Promise<T>}
 */
function ask(make) {
  return new Promise(resolve => {
    const show = () => {
      question.value = make(value => {
        question.value = null
        queue.shift()?.()
        resolve(value)
      })
    }
    if (question.value) queue.push(show)
    else show()
  })
}

/** Forget every sync and question. For tests. */
export function clearDriveSync() {
  syncing.clear()
  question.value = null
  queue.length = 0
}

/**
 * The question a sync is waiting on, for the dialog that asks it.
 *
 * @returns {{question: import('vue').ShallowRef<Question|null>}}
 */
export const useSyncQuestion = () => ({ question })

/**
 * @param {string} storyId
 */
export function useDriveSync(storyId) {
  const api = useDocuments(storyId)
  const editor = useEditor()
  const store = useDocumentsStore()
  const toast = useToast()

  /**
   * The Doc a document is linked to, if it is a text document and this
   * build can reach Google.
   *
   * @param {string|null|undefined} documentId
   * @returns {import('@/types/models.js').DriveLink|undefined}
   */
  const linkOf = documentId => {
    const row = documentId ? api.get(documentId) : null
    return row?.type === 'text' && driveConfig() ? row.drive : undefined
  }

  /**
   * Whether a document can be synced: it is linked, and this build has a
   * Google client.
   *
   * @param {string|null|undefined} documentId
   */
  const canSync = documentId => !!linkOf(documentId)

  /**
   * @param {string|null|undefined} documentId
   */
  const isSyncing = documentId => !!documentId && syncing.has(documentId)

  /**
   * The document as it stands: the editor's, when it is open.
   *
   * @param {string} documentId
   */
  const current = documentId =>
    editor.stateOf(documentId)?.doc ?? parseMarkdown(api.currentContent(documentId))

  /**
   * Sync a linked document with its Doc. Call it straight from the click,
   * with nothing awaited first: in a browser that opens Google's window,
   * when no sign-in is held.
   *
   * @param {string} documentId
   * @returns {Promise<void>} When it is done, or failed and said why
   */
  const sync = documentId => {
    const link = linkOf(documentId)
    if (!link || syncing.has(documentId)) return Promise.resolve()
    syncing.add(documentId)
    return run(documentId, link, signInFor(link.account)).finally(() => syncing.delete(documentId))
  }

  /**
   * @param {string} documentId
   * @param {import('@/types/models.js').DriveLink} link
   * @param {Promise<import('@/drive/session.js').Signed|null>} signing
   */
  async function run(documentId, link, signing) {
    let account = link.account || null
    try {
      const signed = await signing
      if (!signed) return
      account = signed.account ?? account
      const title = api.displayTitle(api.get(documentId))
      const synced = await syncDoc(
        {
          documentId,
          link,
          base: await storage.readBase(storyId, documentId),
          pictures: api.get(documentId)?.pictures ?? {},
          current: () => current(documentId),
          keep: pictures => keepPictures(documentId, pictures),
        },
        signed.token,
        {
          ask: {
            first: () => ask(answer => ({ kind: 'first', title, answer })),
            clashes: clashes => ask(answer => ({ kind: 'clashes', title, clashes, answer })),
          },
        }
      )
      // Put in place at once: the document was read last just now.
      if (!synced || !api.get(documentId)) return
      if (synced.changed) api.editContent(documentId, serializeMarkdown(synced.doc))
      const { revisionId, tabId, markdown, pictures, held } = synced.base
      await storage.writeBase({
        id: documentId,
        storyId,
        docId: link.id,
        revisionId,
        tabId,
        markdown,
        ...(Object.keys(pictures).length > 0 && { pictures }),
        ...(held.length > 0 && { held }),
        at: Date.now(),
      })
      store.updateDocument(documentId, {
        drive: {
          ...(api.get(documentId)?.drive ?? link),
          ...(tabId && { tabId }),
          ...(account && { account }),
          syncedAt: Date.now(),
        },
      })
      if (synced.unsent > 0) toast.warning(picturesLeft(synced.unsent), { duration: 10000 })
      else {
        toast.success(
          synced.sent > 0 || synced.changed ? 'Synced with Google Docs.' : 'Already in sync.',
          { duration: 3000 }
        )
      }
    } catch (error) {
      if (error instanceof SignInLapsedError) forgetSession(account)
      toast.error(failure(error, account), { duration: 10000 })
    }
  }

  /**
   * Make the Doc's new pictures the document's own: their bytes kept, and
   * each named on its row with the Doc's id for it.
   *
   * @param {string} documentId
   * @param {import('@/drive/sync.js').NewPicture[]} pictures
   */
  async function keepPictures(documentId, pictures) {
    if (pictures.length === 0 || !api.get(documentId)) return
    /** @type {Record<string, import('@/types/models.js').PictureInfo>} */
    const known = {}
    for (const picture of pictures) {
      const blob = new Blob([/** @type {BlobPart} */ (picture.bytes)], { type: picture.mime })
      await useFilesStore().putFile(pictureKey(documentId, picture.name), storyId, blob)
      known[picture.name] = {
        mime: picture.mime,
        ...(await measurePicture(blob)),
        docsId: picture.docsId,
      }
    }
    store.updateDocument(documentId, {
      pictures: { ...(api.get(documentId)?.pictures ?? {}), ...known },
    })
  }

  /**
   * Where the Doc a document is linked to opens in Google Docs.
   *
   * @param {string} documentId
   * @returns {string|null}
   */
  const docAddress = documentId => {
    const link = linkOf(documentId)
    return link ? `https://docs.google.com/document/d/${encodeURIComponent(link.id)}/edit` : null
  }

  /**
   * Take a document's link to its Doc away, and the base with it. The Doc is
   * left as it is.
   *
   * @param {string} documentId
   */
  const unlink = documentId => {
    if (!api.get(documentId)?.drive) return
    store.updateDocument(documentId, { drive: undefined })
    storage
      .removeBase(storyId, documentId)
      .catch(error => console.warn('Couldn’t forget a document’s base', error))
  }

  return { canSync, isSyncing, sync, docAddress, unlink }
}

/**
 * A sync done but for the pictures added here, said for the writer.
 *
 * @param {number} count
 * @returns {string}
 */
const picturesLeft = count =>
  count === 1
    ? 'Synced, but the picture added here isn’t in the Doc. Sync can’t send pictures yet.'
    : `Synced, but the ${count} pictures added here aren’t in the Doc. Sync can’t send pictures yet.`

/**
 * Why a sync stopped, said for the writer.
 *
 * @param {unknown} error
 * @param {string|null} account - The account the Doc was linked from, if known
 * @returns {string}
 */
function failure(error, account) {
  if (error instanceof NotGrantedError) {
    return account
      ? `This Google account can’t open the Doc. It was linked from ${account}.`
      : 'This Google account can’t open the Doc.'
  }
  if (error instanceof SignInLapsedError) return 'Your Google sign-in ran out. Sync again.'
  if (error instanceof PopupBlockedError) return 'The browser blocked Google’s window. Sync again.'
  if (error instanceof DriveError) return error.message
  console.error('Sync with Google Docs failed', error)
  return `Sync failed: ${error instanceof Error ? error.message : String(error)}`
}
