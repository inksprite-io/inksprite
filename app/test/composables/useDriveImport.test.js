/* global Response, AbortController */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDriveImport } from '@/composables/useDriveImport.js'
import { useDocuments, clearDocumentInstances } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { SignInLapsedError } from '@/drive/errors.js'
import { pickInBrowser, pickInPopup } from '@/drive/signIn.js'
import { clearSessions, signInFor } from '@/drive/session.js'
import { barePng, minimalDocx } from '../files/helpers.js'
import { docOf, inline, para, run } from '../drive/docsHelpers.js'
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
    docBases: { put: vi.fn(async () => undefined) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))
vi.mock('@/drive/signIn.js', () => ({
  pickInPopup: vi.fn(),
  pickInBrowser: vi.fn(),
  signInInPopup: vi.fn(),
  signInInBrowser: vi.fn(),
  refreshSession: vi.fn(),
}))

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
    clearSessions()
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
    it('writes a Doc as a text document, its pictures its own, and anything else as a file', async () => {
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

      expect(result).toMatchObject({ documents: 2 })
      expect(result.skipped).toEqual([{ name: 'Survey', reason: 'Google Forms can’t be exported' }])
      const [doc, sheet] = childrenOf(into.id)
      expect(doc).toMatchObject({ title: 'Ch. 3', type: 'text', drive: { id: 'doc' } })
      expect(doc.content).toContain('The gate.')
      expect(doc.content).not.toContain('base64')
      expect(doc.content).toContain(`![](.images/${doc.id}/image1.png)`)
      expect(Object.keys(doc.pictures)).toEqual(['image1.png'])
      expect(sheet).toMatchObject({ title: 'Mileage.csv', type: 'file', mime: 'text/csv' })
      expect(sheet.drive).toBeUndefined()
      expect(steps).toHaveBeenCalledWith('downloading', 3, 3)
      expect(steps).toHaveBeenLastCalledWith('writing', 2, 2)
    })

    it('writes a Word file as a text document, its pictures its own as a Doc’s are', async () => {
      const picture =
        '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture"/><a:graphic>' +
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
        '<pic:blipFill><a:blip r:embed="rGull"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>' +
        '</wp:inline></w:drawing></w:r></w:p>'
      const docx = minimalDocx(`<w:p><w:r><w:t>Fog at noon.</w:t></w:r></w:p>${picture}`, {
        images: { rGull: barePng() },
      })
      vi.stubGlobal(
        'fetch',
        drive({
          doc: {
            name: 'Ch. 3',
            mimeType: DOC,
            content: () =>
              new Response(
                `The gate.\n\n![][image1]\n\n[image1]: <data:image/png;base64,${PNG}>\n`
              ),
          },
          word: {
            name: 'Log.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            content: () => new Response(docx),
          },
        })
      )

      const result = await useDriveImport(STORY).importPicked(['doc', 'word'], 'tok')

      expect(result).toMatchObject({ documents: 2 })
      const log = childrenOf(rootIdFor(STORY)).find(child => child.title === 'Log')
      expect(log).toMatchObject({
        type: 'text',
        content: `Fog at noon.\n\n![](.images/${log.id}/image.png)`,
      })
      expect(Object.keys(log.pictures)).toEqual(['image.png'])
      // A copy of a Word file, linked to nothing: only a Doc can be synced.
      expect(log.drive).toBeUndefined()
    })

    it('reads a Doc through the Docs API as it was before its suggested edits, or exports it', async () => {
      const files = drive({
        read: { name: 'Ch. 3', mimeType: DOC, content: () => new Response('Not asked for.\n') },
        exported: {
          name: 'Ch. 4',
          mimeType: DOC,
          content: () => new Response('The crossing took an hour.  \n---\n\nThen the rain.\n'),
        },
      })
      // The Docs API, which has the first Doc and refuses the second, as a
      // Cloud project without it would.
      const read = docOf([
        para([
          run('The ferry left at '),
          run('seven', {}, { suggestedInsertionIds: ['suggest.a'] }),
          run('six', {}, { suggestedDeletionIds: ['suggest.a'] }),
          run('.'),
          inline('pageBreak'),
          run('It was late.'),
        ]),
        para([inline('inlineObjectElement', { inlineObjectId: 'kix.i' })]),
      ])
      const fetched = vi.fn(async (/** @type {string} */ url) => {
        if (!url.startsWith('https://docs.googleapis.com/')) return files(url)
        return url.includes('/documents/read?')
          ? new Response(JSON.stringify(read))
          : new Response('{}', { status: 403 })
      })
      vi.stubGlobal('fetch', fetched)

      const result = await useDriveImport(STORY).importPicked(['read', 'exported'], 'tok')

      expect(result).toMatchObject({ documents: 2, images: 1, suggested: ['Ch. 3'] })
      const [three, four] = childrenOf(rootIdFor(STORY))
      expect(three).toMatchObject({
        title: 'Ch. 3',
        content: 'The ferry left at six.\n\nIt was late.',
        drive: { id: 'read' },
      })
      // The export, its horizontal line mended.
      expect(four).toMatchObject({
        title: 'Ch. 4',
        content: 'The crossing took an hour.\n\n---\n\nThen the rain.',
        drive: { id: 'exported' },
      })
      expect(fetched).not.toHaveBeenCalledWith(
        expect.stringContaining('/files/read/export'),
        expect.anything()
      )
      // The Doc read keeps its text as its base; the one exported has none.
      expect(db.docBases.put).toHaveBeenCalledTimes(1)
      expect(db.docBases.put).toHaveBeenCalledWith({
        id: three.id,
        storyId: STORY,
        docId: 'read',
        tabId: read.tabs[0].tabProperties.tabId,
        revisionId: read.revisionId,
        markdown: three.content,
        at: expect.any(Number),
      })
    })

    it('brings a Doc’s pictures in as its own, in a browser from its export', async () => {
      // The export writes each picture in, in the Doc's order.
      const exported =
        `The harbour: ![][image1] at dawn.\n\nAnd ![][image2]\n\n` +
        `[image1]: <data:image/png;base64,${PNG}>\n[image2]: <data:image/png;base64,${PNG}>\n`
      const files = drive({
        doc: { name: 'Ch. 5', mimeType: DOC, content: () => new Response(exported) },
      })
      const read = docOf(
        [
          para([
            run('The harbour: '),
            inline('inlineObjectElement', { inlineObjectId: 'kix.pier' }),
            run(' at dawn.'),
          ]),
          para([run('And '), inline('inlineObjectElement', { inlineObjectId: 'kix.gull' })]),
        ],
        {
          pictures: {
            'kix.pier': { uri: 'https://pictures.example.com/pier', alt: 'The north pier' },
            'kix.gull': { uri: 'https://pictures.example.com/gull' },
          },
        }
      )
      const fetched = vi.fn(async (/** @type {string} */ url) => {
        if (url.startsWith('https://docs.googleapis.com/'))
          return new Response(JSON.stringify(read))
        if (url.startsWith('https://pictures.example.com/')) throw new TypeError('Failed to fetch')
        return files(url)
      })
      vi.stubGlobal('fetch', fetched)

      const result = await useDriveImport(STORY).importPicked(['doc'], 'tok')

      expect(result).toMatchObject({ documents: 1 })
      expect(result.images).toBeUndefined()
      const [doc] = childrenOf(rootIdFor(STORY))
      expect(doc.content).toBe(
        `The harbour: ![The north pier](.images/${doc.id}/image1.png) at dawn.\n\n` +
          `And ![](.images/${doc.id}/image2.png)`
      )
      expect(doc.pictures).toEqual({
        'image1.png': expect.objectContaining({ mime: 'image/png', docsId: 'kix.pier' }),
        'image2.png': expect.objectContaining({ mime: 'image/png', docsId: 'kix.gull' }),
      })
      expect(
        fetched.mock.calls.some(([url]) => String(url).startsWith('https://pictures.example.com/'))
      ).toBe(false)
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
    it('picks in a popup with the web client in a browser, and keeps the sign-in for syncs', async () => {
      const session = { token: 'tok', ids: ['a'], expiresAt: Date.now() + 3600_000 }
      vi.mocked(pickInPopup).mockResolvedValue(session)
      const about = vi.fn(
        async () => new Response(JSON.stringify({ user: { emailAddress: 'writer@example.com' } }))
      )
      vi.stubGlobal('fetch', about)
      const signal = new AbortController().signal

      await expect(useDriveImport(STORY).choose({ signal })).resolves.toEqual({
        ...session,
        account: 'writer@example.com',
      })
      expect(pickInPopup).toHaveBeenCalledWith('web-1', { signal })
      expect(pickInBrowser).not.toHaveBeenCalled()
      expect(about).toHaveBeenCalledWith(
        'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
        expect.objectContaining({ headers: { Authorization: 'Bearer tok' } })
      )
      // A sync of what it brings in signs in with nothing shown.
      vi.mocked(pickInPopup).mockClear()
      await expect(signInFor('writer@example.com')).resolves.toEqual({
        token: 'tok',
        account: 'writer@example.com',
      })
    })

    it('picks in the system browser with the desktop client in the desktop window', async () => {
      vi.stubGlobal('__INKSPRITE_DESKTOP__', {})
      vi.stubGlobal('fetch', vi.fn())
      vi.mocked(pickInBrowser).mockResolvedValue(null)

      await expect(useDriveImport(STORY).choose()).resolves.toBeNull()
      expect(pickInBrowser).toHaveBeenCalledWith(
        { kind: 'desktop', clientId: 'desktop-1', clientSecret: 'secret-1' },
        { signal: undefined }
      )
    })
  })
})
