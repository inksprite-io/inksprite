/* global Blob */
/**
 * @module composables/useDriveSync
 * @description A linked document synced with its Google Doc, from its menu
 * or the Sync button over it.
 *
 * The steps are `drive/sync.js`'s. This signs in for them (`drive/session.js`,
 * from the click, which in a browser is what lets Google's window open),
 * hands them the document as it stands and its base, and puts what comes
 * back in place: the Doc's new pictures made the document's own, the
 * document edited to the merge rather than replaced, so a document open
 * keeps its caret and can undo the sync in one step, the Doc's text kept as
 * a version where words of it gave way to the document's, and the Doc as it
 * now reads kept as the next sync's base.
 *
 * A text document not linked to a Doc can be synced to a new one: a Doc
 * made under its title in the writer's Drive, in the account the project
 * last synced with, linked, and the document synced into it. A Doc made so
 * is kept in `inksprite-sync`, in folders as the project has them
 * (`drive/folders.js`), moved and renamed at each sync to match.
 *
 * The Doc's suggested edits come in as suggestions, and are accepted or
 * rejected in it when they are here (`drive/suggestions.js`); the model's
 * go to the Doc as suggestions in the writer's name, as its comments do.
 *
 * Design: `.llm/google_docs_design.md`, part 3, Sync.
 */

import { reactive } from 'vue'
import { driveConfig } from '@/drive/config.js'
import {
  DriveError,
  NotGrantedError,
  PopupBlockedError,
  SignInLapsedError,
} from '@/drive/errors.js'
import { createDoc } from '@/drive/api.js'
import { folderFor, placeDoc } from '@/drive/folders.js'
import { forgetSession, signInFor } from '@/drive/session.js'
import { docLinks } from '@/drive/links.js'
import { syncDoc } from '@/drive/sync.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { measurePicture } from '@/files/pictures.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { storage } from '@/storage/index.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useFilesStore } from '@/stores/filesStore.js'
import { useVersionsStore } from '@/stores/versionsStore.js'
import { pictureKey } from '@/utils/pictures.js'
import { DOC_CLASHED } from '@/utils/versions.js'
import { useDocuments } from './useDocuments.js'
import { useEditor } from './useEditor.js'
import { useToast } from './useToast.js'

/** Documents being synced, by id. */
const syncing = reactive(new Set())

/** Forget every sync. For tests. */
export function clearDriveSync() {
  syncing.clear()
}

/**
 * @param {string} storyId
 */
export function useDriveSync(storyId) {
  const api = useDocuments(storyId)
  /** @type {import('@/utils/documentLinks.js').LinkTree} */
  const tree = { get: api.get, childrenOf: api.childrenOf, rootId: rootIdFor(storyId) }
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
   * Whether a document can be synced to a new Doc: it is a text document
   * linked to none, and this build has a Google client.
   *
   * @param {string|null|undefined} documentId
   */
  const canSyncToNew = documentId => {
    const row = documentId ? api.get(documentId) : null
    return row?.type === 'text' && !row.drive && !!driveConfig()
  }

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
   * Make a Doc of a document not linked to one, and sync the document into
   * it. Call it straight from the click, with nothing awaited first: in a
   * browser that opens Google's window, when no sign-in is held. What the
   * Doc can't take yet stays here, as in any sync.
   *
   * @param {string} documentId
   * @returns {Promise<void>} When it is done, or failed and said why
   */
  const syncToNew = documentId => {
    if (!canSyncToNew(documentId) || syncing.has(documentId)) {
      return Promise.resolve()
    }
    syncing.add(documentId)
    const account = lastAccount()
    return make(documentId, account, signInFor(account)).finally(() => syncing.delete(documentId))
  }

  /**
   * The account the project last synced a document with, which a new Doc
   * goes in: none, when it has synced none, and then whoever signs in.
   *
   * @returns {string|undefined}
   */
  function lastAccount() {
    let latest
    for (const row of store.documents.values()) {
      const drive = row.storyId === storyId ? row.drive : undefined
      if (drive?.account && (drive.syncedAt ?? 0) >= (latest?.syncedAt ?? 0)) latest = drive
    }
    return latest?.account
  }

  /**
   * Where a document is in its project: the project, the folders it is in,
   * its title.
   *
   * @param {string} documentId
   * @returns {import('@/drive/folders.js').Place}
   */
  function placeOf(documentId) {
    const row = api.get(documentId)
    /** @type {Array<{id: string, title: string}>} */
    const folders = []
    let parent = row?.parentId ? api.get(row.parentId) : null
    while (parent && parent.id !== api.root.value?.id) {
      folders.unshift({ id: parent.id, title: api.displayTitle(parent) })
      parent = parent.parentId ? api.get(parent.parentId) : null
    }
    return {
      project: { id: storyId, title: api.displayTitle(api.root.value) },
      folders,
      title: api.displayTitle(row),
    }
  }

  /**
   * @param {string} documentId
   * @param {string|undefined} account
   * @param {Promise<import('@/drive/session.js').Signed|null>} signing
   */
  async function make(documentId, account, signing) {
    /** @type {import('@/drive/session.js').Signed|null} */
    let signed = null
    /** @type {import('@/types/models.js').DriveLink} */
    let link
    try {
      signed = await signing
      if (!signed || !api.get(documentId)) return
      const place = placeOf(documentId)
      const parent = await folderFor(place, signed.token)
      const id = await createDoc(place.title, signed.token, { parent })
      link = { id, ...(signed.account && { account: signed.account }), made: true }
      // Linked at once: should the sync fail, the next one goes on with it.
      store.updateDocument(documentId, { drive: link })
    } catch (error) {
      if (error instanceof SignInLapsedError) forgetSession(signed?.account ?? account)
      toast.error(failure(error, null), { duration: 10000 })
      return
    }
    await run(documentId, link, Promise.resolve(signed), { made: true })
  }

  /**
   * @param {string} documentId
   * @param {import('@/types/models.js').DriveLink} link
   * @param {Promise<import('@/drive/session.js').Signed|null>} signing
   * @param {{made?: boolean}} [options] - Whether the Doc was made for it just now
   */
  async function run(documentId, link, signing, { made = false } = {}) {
    let account = link.account || null
    try {
      const signed = await signing
      if (!signed) return
      account = signed.account ?? account
      const synced = await syncDoc(
        {
          documentId,
          link,
          base: await storage.readBase(storyId, documentId),
          pictures: api.get(documentId)?.pictures ?? {},
          current: () => current(documentId),
          threads: () => api.threadsOf(documentId) ?? {},
          keep: pictures => keepPictures(documentId, pictures),
          links: docLinks(tree, documentId),
        },
        signed.token
      )
      // Put in place at once: the document was read last just now.
      const row = api.get(documentId)
      if (!row) return
      // The threads first, so the comments' marks coming in have them.
      api.setThreads(documentId, synced.threads)
      if (synced.changed) {
        api.fromOutside(documentId, 'drive', () =>
          api.editContent(documentId, serializeMarkdown(synced.doc))
        )
      }
      // The Doc's words that gave way to the document's, there to look back at.
      if (synced.lost) {
        await useVersionsStore().keepNamed({ ...row, content: synced.lost }, DOC_CLASHED)
      }
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
      // A Doc of inksprite's kept where its document is; tried again at the
      // next sync, should Drive not answer.
      if (api.get(documentId)?.drive?.made) {
        await placeDoc(link.id, placeOf(documentId), signed.token).catch(error =>
          console.warn('Couldn’t put the Doc where its document is', error)
        )
      }
      // The Doc made for it is out of sight, in the writer's Drive.
      if (made) toast.success('Synced with a new Google Doc in your Drive.', { duration: 3000 })
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
    const threads = api.threadsOf(documentId)
    if (threads) api.setThreads(documentId, withoutLinks(threads))
    storage
      .removeBase(storyId, documentId)
      .catch(error => console.warn('Couldn’t forget a document’s base', error))
  }

  return { canSync, canSyncToNew, isSyncing, sync, syncToNew, docAddress, unlink }
}

/**
 * Threads with their links to a Doc taken off, the posts' too.
 *
 * @param {Record<string, import('@/types/models.js').CommentThread>} threads
 */
const withoutLinks = threads =>
  Object.fromEntries(
    Object.entries(threads).map(([id, { google: _google, ...thread }]) => [
      id,
      { ...thread, posts: thread.posts.map(({ google: _post, ...post }) => post) },
    ])
  )

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
  return `The Doc couldn’t be synced. ${error instanceof Error ? error.message : String(error)}`
}
