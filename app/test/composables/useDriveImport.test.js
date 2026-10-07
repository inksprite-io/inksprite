/* global Response, AbortController */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDriveImport } from '@/composables/useDriveImport.js'
import { useDocuments, clearDocumentInstances } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { SignInLapsedError } from '@/drive/errors.js'
import { pickInBrowser, pickInPopup } from '@/drive/signIn.js'

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
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))
vi.mock('@/drive/signIn.js', () => ({ pickInPopup: vi.fn(), pickInBrowser: vi.fn() }))

const STORY = 'story_1'
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const DOC = 'application/vnd.google-apps.document'

/**
 * Drive, standing in: each file id is described by its name and type, and
 * answers a download or an export with what is given for it.
 *
 * @param {Record<string, {name: string, mimeType: string, content: () => Response}>} files
 */
const drive = files =>
  vi.fn(async (/** @type {string} */ url) => {
    const id = Object.keys(files).find(key => url.includes(`/files/${key}`))
    if (!id) return new Response('{}', { status: 404 })
    const { name, mimeType, content } = files[id]
    return url.includes('fields=')
      ? new Response(JSON.stringify({ id, name, mimeType }))
      : content()
  })

describe('useDriveImport', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    api = useDocuments(STORY)
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'web-1')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_ID', 'desktop-1')
    vi.stubEnv('VITE_GOOGLE_DESKTOP_CLIENT_SECRET', 'secret-1')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  const childrenOf = id => api.childrenOf(id).map(child => store.getDocument(child.id))

  describe('importPicked', () => {
    it('writes a Doc as a text document, without its pictures, and anything else as a file', async () => {
      vi.stubGlobal(
        'fetch',
        drive({
          doc: {
            name: 'Ch. 3',
            mimeType: DOC,
            content: () =>
              new Response(
                `# Ch. 3\n\nThe gate.\n\n![][image1]\n\n[image1]: <data:image/png;base64,${PNG}>\n`
              ),
          },
          sheet: {
            name: 'Mileage',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            content: () => new Response('day,miles\n1,12\n'),
          },
          form: {
            name: 'Survey',
            mimeType: 'application/vnd.google-apps.form',
            content: () => new Response(''),
          },
        })
      )
      const into = api.createFolder(rootIdFor(STORY), 'Drafts')
      const steps = vi.fn()

      const result = await useDriveImport(STORY).importPicked(['doc', 'sheet', 'form'], 'tok', {
        parentId: into.id,
        onStep: steps,
      })

      expect(result).toMatchObject({ documents: 2, images: 1 })
      expect(result.skipped).toEqual([{ name: 'Survey', reason: 'Google Forms can’t be exported' }])
      const [doc, sheet] = childrenOf(into.id)
      expect(doc).toMatchObject({ title: 'Ch. 3', type: 'text' })
      expect(doc.content).toContain('The gate.')
      expect(doc.content).not.toContain('base64')
      expect(doc.content).not.toContain('image1')
      expect(sheet).toMatchObject({ title: 'Mileage', type: 'file', mime: 'text/csv' })
      expect(steps).toHaveBeenCalledWith('downloading', 3, 3)
      expect(steps).toHaveBeenLastCalledWith('writing', 2, 2)
    })

    it('skips a file Drive refuses and goes on, saying which', async () => {
      vi.stubGlobal(
        'fetch',
        drive({
          big: {
            name: 'Omnibus',
            mimeType: DOC,
            content: () =>
              new Response(
                JSON.stringify({ error: { errors: [{ reason: 'exportSizeLimitExceeded' }] } }),
                { status: 403 }
              ),
          },
          small: { name: 'Notes', mimeType: DOC, content: () => new Response('# Notes\n') },
        })
      )

      const result = await useDriveImport(STORY).importPicked(['big', 'gone', 'small'], 'tok')

      expect(result.documents).toBe(1)
      expect(result.skipped).toEqual([
        { name: 'Omnibus', reason: 'Over Drive’s 10 MB export limit' },
        // Never described, so named by its id.
        { name: 'gone', reason: 'Drive didn’t give inksprite this file' },
      ])
      expect(api.childrenOf(rootIdFor(STORY)).map(child => child.title)).toEqual(['Notes'])
    })

    it('stops before writing anything when the sign-in has run out', async () => {
      vi.stubGlobal(
        'fetch',
        drive({
          one: { name: 'One', mimeType: DOC, content: () => new Response('# One\n') },
          two: { name: 'Two', mimeType: DOC, content: () => new Response('{}', { status: 401 }) },
        })
      )

      await expect(
        useDriveImport(STORY).importPicked(['one', 'two'], 'tok')
      ).rejects.toBeInstanceOf(SignInLapsedError)
      expect(api.childrenOf(rootIdFor(STORY))).toEqual([])
    })

    it('stops by its signal', async () => {
      const controller = new AbortController()
      vi.stubGlobal(
        'fetch',
        drive({
          one: {
            name: 'One',
            mimeType: DOC,
            content: () => {
              controller.abort()
              return new Response('# One\n')
            },
          },
          two: { name: 'Two', mimeType: DOC, content: () => new Response('# Two\n') },
        })
      )

      await expect(
        useDriveImport(STORY).importPicked(['one', 'two'], 'tok', { signal: controller.signal })
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(api.childrenOf(rootIdFor(STORY))).toEqual([])
    })
  })

  describe('choose', () => {
    it('picks in a popup with the web client in a browser', async () => {
      vi.mocked(pickInPopup).mockResolvedValue({ token: 'tok', ids: ['a'] })
      const signal = new AbortController().signal

      await expect(useDriveImport(STORY).choose({ signal })).resolves.toEqual({
        token: 'tok',
        ids: ['a'],
      })
      expect(pickInPopup).toHaveBeenCalledWith('web-1', { signal })
      expect(pickInBrowser).not.toHaveBeenCalled()
    })

    it('picks in the system browser with the desktop client in the desktop window', async () => {
      vi.stubGlobal('__TAURI_INTERNALS__', {})
      vi.mocked(pickInBrowser).mockResolvedValue(null)

      await expect(useDriveImport(STORY).choose()).resolves.toBeNull()
      expect(pickInBrowser).toHaveBeenCalledWith(
        { kind: 'desktop', clientId: 'desktop-1', clientSecret: 'secret-1' },
        { signal: undefined }
      )
    })
  })
})
