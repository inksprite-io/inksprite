import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { clearDriveSync, useDriveSync, useSyncQuestion } from '@/composables/useDriveSync.js'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { clearEditor, useEditor } from '@/composables/useEditor.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { NotGrantedError, SignInLapsedError } from '@/drive/errors.js'
import { forgetSession, signInFor } from '@/drive/session.js'
import { syncDoc } from '@/drive/sync.js'
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
vi.mock('@/drive/sync.js', () => ({ syncDoc: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

const STORY = 'story_1'
const ACCOUNT = 'writer@example.com'
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/** What the sync read the document as. */
const read = { text: '' }

/** A sync that comes back with this document, as the Doc and the document now agree. */
const comesBack = (markdown, { sent = 1, changed = true, keep = [], unsent = 0 } = {}) =>
  vi.mocked(syncDoc).mockImplementation(async linked => {
    await linked.keep(keep)
    read.text = linked.current().textContent
    return {
      doc: parseMarkdown(markdown),
      base: { revisionId: 'rev-2', tabId: 't.0', markdown, pictures: {}, held: [] },
      sent,
      changed,
      unsent,
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
    expect(toast.success).toHaveBeenCalledWith('Synced with Google Docs.', { duration: 3000 })
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

  it('says so when there was nothing to sync', async () => {
    const doc = linked()
    comesBack('The ferry left at six.', { sent: 0, changed: false })
    await useDriveSync(STORY).sync(doc.id)
    expect(toast.success).toHaveBeenCalledWith('Already in sync.', { duration: 3000 })
  })

  it('warns of the pictures added here that the Doc lacks', async () => {
    const doc = linked()
    const drive = useDriveSync(STORY)
    comesBack('The ferry left at six.', { sent: 0, changed: false, unsent: 1 })
    await drive.sync(doc.id)
    expect(toast.warning).toHaveBeenLastCalledWith(
      'Synced, but the picture added here isn’t in the Doc. Sync can’t send pictures yet.',
      { duration: 10000 }
    )
    comesBack('The ferry left at seven.', { unsent: 2 })
    await drive.sync(doc.id)
    expect(toast.warning).toHaveBeenLastCalledWith(
      'Synced, but the 2 pictures added here aren’t in the Doc. Sync can’t send pictures yet.',
      { duration: 10000 }
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('asks its questions through the dialog, one at a time, and stops on a cancel', async () => {
    const doc = linked()
    const { question } = useSyncQuestion()
    vi.mocked(syncDoc).mockImplementation(async (_linked, _token, { ask }) => {
      expect(await ask.first()).toBe('theirs')
      expect(await ask.clashes([{ base: [], mine: [], theirs: [] }])).toBeNull()
      return null
    })

    const syncing = useDriveSync(STORY).sync(doc.id)
    await vi.waitFor(() => expect(question.value?.kind).toBe('first'))
    expect(question.value.title).toBe('Ch. 3')
    question.value.answer('theirs')
    await vi.waitFor(() => expect(question.value?.kind).toBe('clashes'))
    question.value.answer(null)
    await syncing

    expect(question.value).toBeNull()
    expect(db.docBases.put).not.toHaveBeenCalled()
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

  it('does nothing when the writer cancels Google’s sign-in', async () => {
    const doc = linked()
    vi.mocked(signInFor).mockResolvedValue(null)
    await useDriveSync(STORY).sync(doc.id)
    expect(syncDoc).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('unlinks a document, its base with it', async () => {
    const doc = linked()
    useDriveSync(STORY).unlink(doc.id)
    expect(store.getDocument(doc.id).drive).toBeUndefined()
    expect(db.docBases.delete).toHaveBeenCalledWith(doc.id)
  })
})
