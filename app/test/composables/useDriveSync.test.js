import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { clearDriveSync, useDriveSync } from '@/composables/useDriveSync.js'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { clearEditor, useEditor } from '@/composables/useEditor.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useVersionsStore } from '@/stores/versionsStore.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { DriveError, NotGrantedError, SignInLapsedError } from '@/drive/errors.js'
import { createDoc } from '@/drive/api.js'
import { folderFor, placeDoc } from '@/drive/folders.js'
import { forgetSession, signInFor } from '@/drive/session.js'
import { checkSendable, syncDoc } from '@/drive/sync.js'
import { parseMarkdown } from '@/editor/markdown.js'
import db from '@/stores/db'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    files: { put: vi.fn(async () => undefined), get: vi.fn(async () => undefined) },
    stories: { toArray: vi.fn(async () => []) },
    docBases: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))
vi.mock('@/drive/session.js', () => ({ signInFor: vi.fn(), forgetSession: vi.fn() }))
vi.mock('@/drive/sync.js', () => ({
  syncDoc: vi.fn(),
  checkSendable: vi.fn(),
  SUGGESTIONS_WAITING: 'This document has suggestions waiting. Accept or reject them, then sync.',
}))
vi.mock('@/drive/api.js', () => ({ createDoc: vi.fn() }))
vi.mock('@/drive/folders.js', () => ({ folderFor: vi.fn(), placeDoc: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

const STORY = 'story_1'
const ACCOUNT = 'writer@example.com'
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/** What the sync read the document as. */
const read = { text: '' }

/** A sync that comes back with this document, as the Doc and the document now agree. */
const comesBack = (
  markdown,
  { sent = 1, changed = true, keep = [], unsent = 0, commentsSent = 0, lost = null } = {}
) =>
  vi.mocked(syncDoc).mockImplementation(async linked => {
    await linked.keep(keep)
    read.text = linked.current().textContent
    return {
      doc: parseMarkdown(markdown),
      base: { revisionId: 'rev-2', tabId: 't.0', markdown, pictures: {}, held: [] },
      threads: {},
      comments: { came: 0, tooLong: 0, sent: commentsSent, changed: 0 },
      suggestions: { came: 0, settled: 0, changed: 0 },
      sent,
      changed,
      unsent,
      lost,
    }
  })

describe('useDriveSync', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    clearDriveSync()
    clearEditor()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'web-1')
    store = useDocumentsStore()
    store.ensureRoot(STORY, 'Novel')
    vi.mocked(signInFor).mockResolvedValue({ token: 'tok', account: ACCOUNT })
    vi.mocked(folderFor).mockResolvedValue('folder-act')
    vi.mocked(placeDoc).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  /** A text document linked to a Doc. */
  const linked = (content = 'The ferry left at six.', drive = { id: 'doc-1', account: ACCOUNT }) =>
    store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'Ch. 3',
      content,
      drive,
    })

  it('offers itself only on a linked text document, in a build with a Google client', () => {
    const doc = linked()
    const other = store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'Notes',
    })
    const drive = useDriveSync(STORY)
    expect(drive.canSync(doc.id)).toBe(true)
    expect(drive.canSync(other.id)).toBe(false)
    expect(drive.docAddress(doc.id)).toBe('https://docs.google.com/document/d/doc-1/edit')

    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    expect(drive.canSync(doc.id)).toBe(false)
  })

  it('signs in from the click, then puts the merge in place and keeps the base', async () => {
    const doc = linked()
    comesBack('The ferry left at seven.', {
      keep: [{ name: 'image.png', docsId: 'kix.pier', mime: 'image/png', bytes: PNG }],
    })
    const drive = useDriveSync(STORY)

    const syncing = drive.sync(doc.id)
    // Within the click, before anything is awaited: Google's window opens from it.
    expect(signInFor).toHaveBeenCalledWith(ACCOUNT)
    expect(drive.isSyncing(doc.id)).toBe(true)
    await syncing
    expect(drive.isSyncing(doc.id)).toBe(false)

    const [given, token] = vi.mocked(syncDoc).mock.calls[0]
    expect(token).toBe('tok')
    expect(given).toMatchObject({ documentId: doc.id, link: doc.drive, base: null, pictures: {} })
    expect(read.text).toBe('The ferry left at six.')

    const row = store.getDocument(doc.id)
    expect(row.content).toBe('The ferry left at seven.')
    expect(row.pictures).toEqual({ 'image.png': { mime: 'image/png', docsId: 'kix.pier' } })
    expect(db.files.put).toHaveBeenCalledWith(
      expect.objectContaining({ id: `${doc.id}/image.png`, storyId: STORY })
    )
    expect(db.docBases.put).toHaveBeenCalledWith({
      id: doc.id,
      storyId: STORY,
      docId: 'doc-1',
      revisionId: 'rev-2',
      tabId: 't.0',
      markdown: 'The ferry left at seven.',
      at: expect.any(Number),
    })
    expect(row.drive).toEqual({
      id: 'doc-1',
      account: ACCOUNT,
      tabId: 't.0',
      syncedAt: expect.any(Number),
    })
    // The Sync button's spinner says when it is done.
    expect(toast.success).not.toHaveBeenCalled()
    // A Doc the writer imported stays where they keep it.
    expect(placeDoc).not.toHaveBeenCalled()
  })

  it('edits a document open in the editor rather than replacing it', async () => {
    const doc = linked('The ferry left at six.\n\nIt rained.')
    const editor = useEditor()
    editor.open(doc.id, doc.content)
    comesBack('The ferry left at seven.\n\nIt rained.')

    await useDriveSync(STORY).sync(doc.id)

    expect(editor.markdown(doc.id)).toBe('The ferry left at seven.\n\nIt rained.')
    expect(store.getDocument(doc.id).content).toBe('The ferry left at seven.\n\nIt rained.')
  })

  it('says nothing of a sync done, whatever it brought or left behind', async () => {
    const doc = linked()
    const drive = useDriveSync(STORY)
    comesBack('The ferry left at six.', { sent: 0, changed: false })
    await drive.sync(doc.id)
    comesBack('The ferry left at six.', { sent: 0, changed: false, commentsSent: 1 })
    await drive.sync(doc.id)
    comesBack('The ferry left at seven.', { unsent: 2 })
    await drive.sync(doc.id)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps the Doc’s text as a version when words of it gave way to the document’s', async () => {
    const doc = linked('The ferry left at seven.')
    const versions = useVersionsStore()
    const keepNamed = vi.spyOn(versions, 'keepNamed').mockResolvedValue(null)
    comesBack('The ferry left at seven.', { sent: 1, changed: false })
    await useDriveSync(STORY).sync(doc.id)
    expect(keepNamed).not.toHaveBeenCalled()

    comesBack('The ferry left at seven.', {
      sent: 1,
      changed: false,
      lost: 'The ferry left at eight.',
    })
    await useDriveSync(STORY).sync(doc.id)
    expect(keepNamed).toHaveBeenCalledWith(
      expect.objectContaining({ id: doc.id, content: 'The ferry left at eight.' }),
      'The Google Doc’s text, which clashed with this one'
    )
    expect(store.getDocument(doc.id).content).toBe('The ferry left at seven.')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('says why it stopped, and lets a sign-in go that ran out', async () => {
    const doc = linked()
    const drive = useDriveSync(STORY)
    vi.mocked(syncDoc).mockRejectedValueOnce(new NotGrantedError())
    await drive.sync(doc.id)
    expect(toast.error).toHaveBeenLastCalledWith(
      `This Google account can’t open the Doc. It was linked from ${ACCOUNT}.`,
      { duration: 10000 }
    )

    vi.mocked(syncDoc).mockRejectedValueOnce(new SignInLapsedError())
    await drive.sync(doc.id)
    expect(forgetSession).toHaveBeenCalledWith(ACCOUNT)
    expect(toast.error).toHaveBeenLastCalledWith('Your Google sign-in ran out. Sync again.', {
      duration: 10000,
    })
    expect(store.getDocument(doc.id).content).toBe('The ferry left at six.')
  })

  it('syncs a document with the model’s suggestions waiting, which go as suggestions', async () => {
    const doc = linked('The ferry left at {--six--}{>>sabcd1<<}{++seven++}{>>sabcd1<<}.')
    await useDriveSync(STORY).sync(doc.id)
    expect(syncDoc).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('syncs a document whose suggestions are its Doc’s, saying nothing of them', async () => {
    const content = 'The ferry left at {--six--}{>>sabcd1<<}{++seven++}{>>sabcd1<<}.'
    const doc = linked(content)
    store.updateDocument(doc.id, {
      comments: {
        sabcd1: {
          status: 'open',
          quote: 'six',
          posts: [],
          suggestion: { text: 'seven', created: 1, author: 'person', name: 'Ana Marsh' },
          google: { doc: 'doc-1', id: 'suggest.a', status: 'open' },
        },
      },
    })
    vi.mocked(syncDoc).mockImplementation(async linked => ({
      doc: linked.current(),
      base: { revisionId: 'rev-2', tabId: 't.0', markdown: content, pictures: {}, held: [] },
      threads: linked.threads(),
      comments: { came: 0, tooLong: 0, sent: 0, changed: 0 },
      suggestions: { came: 2, settled: 0, changed: 2 },
      sent: 0,
      changed: false,
      unsent: 0,
    }))
    await useDriveSync(STORY).sync(doc.id)
    expect(syncDoc).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does nothing when the writer cancels Google’s sign-in', async () => {
    const doc = linked()
    vi.mocked(signInFor).mockResolvedValue(null)
    await useDriveSync(STORY).sync(doc.id)
    expect(syncDoc).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  describe('to a new Doc', () => {
    /** A text document linked to no Doc, in a folder. */
    const unlinked = () => {
      const act = store.createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'Act One',
      })
      return store.createDocument({
        storyId: STORY,
        parentId: act.id,
        type: 'text',
        title: 'Ch. 4',
        content: 'The ferry left at six.',
      })
    }

    it('makes a Doc, in the account the project last synced with, and syncs into it', async () => {
      linked('Earlier.', { id: 'doc-0', account: 'old@example.com', syncedAt: 1 })
      linked('Later.', { id: 'doc-1', account: ACCOUNT, syncedAt: 2 })
      const doc = unlinked()
      vi.mocked(createDoc).mockResolvedValue('doc-new')
      comesBack('The ferry left at six.')
      const drive = useDriveSync(STORY)
      expect(drive.canSyncToNew(doc.id)).toBe(true)
      expect(drive.canSync(doc.id)).toBe(false)

      const syncing = drive.syncToNew(doc.id)
      expect(signInFor).toHaveBeenCalledWith(ACCOUNT)
      await syncing

      // Made in its folder: inksprite-sync, the project, its folders.
      const place = {
        project: { id: STORY, title: 'Novel' },
        folders: [{ id: doc.parentId, title: 'Act One' }],
        title: 'Ch. 4',
      }
      expect(folderFor).toHaveBeenCalledWith(place, 'tok')
      expect(createDoc).toHaveBeenCalledWith('Ch. 4', 'tok', { parent: 'folder-act' })
      expect(vi.mocked(syncDoc).mock.calls[0][0].link).toEqual({
        id: 'doc-new',
        account: ACCOUNT,
        made: true,
      })
      expect(store.getDocument(doc.id).drive).toEqual({
        id: 'doc-new',
        account: ACCOUNT,
        made: true,
        tabId: 't.0',
        syncedAt: expect.any(Number),
      })
      expect(placeDoc).toHaveBeenCalledWith('doc-new', place, 'tok')
      expect(drive.canSyncToNew(doc.id)).toBe(false)
      expect(toast.success).toHaveBeenCalledWith('Synced with a new Google Doc in your Drive.', {
        duration: 3000,
      })
    })

    it('says what a new Doc could not take, before signing in or making one', async () => {
      const doc = unlinked()
      vi.mocked(checkSendable).mockImplementationOnce(() => {
        throw new DriveError('Sync can’t add or remove footnotes in Google Docs yet.')
      })
      await useDriveSync(STORY).syncToNew(doc.id)
      expect(toast.error).toHaveBeenCalledWith(
        'Sync can’t add or remove footnotes in Google Docs yet.',
        { duration: 10000 }
      )
      expect(signInFor).not.toHaveBeenCalled()
      expect(createDoc).not.toHaveBeenCalled()
      expect(store.getDocument(doc.id).drive).toBeUndefined()
    })

    it('keeps the link when the Doc was made and the sync then failed', async () => {
      const doc = unlinked()
      vi.mocked(createDoc).mockResolvedValue('doc-new')
      vi.mocked(syncDoc).mockRejectedValueOnce(new DriveError('Couldn’t reach Drive'))
      await useDriveSync(STORY).syncToNew(doc.id)
      expect(store.getDocument(doc.id).drive).toEqual({
        id: 'doc-new',
        account: ACCOUNT,
        made: true,
      })
      expect(toast.error).toHaveBeenCalledWith('Couldn’t reach Drive', { duration: 10000 })
    })

    it('keeps a Doc it made where its document is, moved here since, at each sync', async () => {
      const doc = linked('The ferry left at six.', { id: 'doc-1', account: ACCOUNT, made: true })
      comesBack('The ferry left at six.', { sent: 0, changed: false })
      store.updateDocument(doc.id, { title: 'Ch. 9' })
      await useDriveSync(STORY).sync(doc.id)
      expect(placeDoc).toHaveBeenCalledWith(
        'doc-1',
        { project: { id: STORY, title: 'Novel' }, folders: [], title: 'Ch. 9' },
        'tok'
      )

      // Drive not answering leaves the sync done; the next one tries again.
      vi.mocked(placeDoc).mockRejectedValueOnce(new Error('offline'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await useDriveSync(STORY).sync(doc.id)
      expect(db.docBases.put).toHaveBeenCalledTimes(2)
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  it('unlinks a document, its base with it, and its threads from the Doc’s', async () => {
    const doc = linked('The {==ferry==}{>>cfer01<<} left.')
    store.updateDocument(doc.id, {
      comments: {
        cfer01: {
          status: 'open',
          quote: 'ferry',
          posts: [
            { author: 'writer', text: 'Which?', created: 1, google: { id: 'p1', text: 'Which?' } },
          ],
          google: { doc: 'doc-1', id: 'g1', status: 'open' },
        },
      },
    })
    useDriveSync(STORY).unlink(doc.id)
    expect(store.getDocument(doc.id).drive).toBeUndefined()
    expect(db.docBases.delete).toHaveBeenCalledWith(doc.id)
    expect(store.getDocument(doc.id).comments.cfer01).toEqual({
      status: 'open',
      quote: 'ferry',
      posts: [{ author: 'writer', text: 'Which?', created: 1 }],
    })
  })

  it('puts the Doc’s comments on the row with the text', async () => {
    const doc = linked()
    const threads = {
      cana01: {
        status: 'open',
        quote: 'six',
        posts: [{ author: 'person', name: 'Ana Marsh', text: 'Or seven?', created: 2 }],
        google: { doc: 'doc-1', id: 'g1', status: 'open' },
      },
    }
    vi.mocked(syncDoc).mockImplementation(async () => ({
      doc: parseMarkdown('The ferry left at {==six==}{>>cana01<<}.'),
      base: {
        revisionId: 'rev-2',
        tabId: 't.0',
        markdown: 'The ferry left at six.',
        pictures: {},
        held: [],
      },
      threads,
      comments: { came: 1, tooLong: 0, sent: 0, changed: 1 },
      suggestions: { came: 0, settled: 0, changed: 0 },
      sent: 0,
      changed: true,
    }))
    await useDriveSync(STORY).sync(doc.id)
    const row = store.getDocument(doc.id)
    expect(row.content).toBe('The ferry left at {==six==}{>>cana01<<}.')
    expect(row.comments.cana01.posts[0].name).toBe('Ana Marsh')
  })
})
