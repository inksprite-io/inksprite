import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDocumentLinks } from '@/composables/useDocumentLinks.js'
import { usePictureViewer } from '@/composables/usePictureViewer.js'

const docs = [
  { id: 'root_s', parentId: 's', type: 'folder', title: 'Novel' },
  { id: 'notes', parentId: 'root_s', type: 'folder', title: 'Notes' },
  {
    id: 'cast',
    parentId: 'notes',
    type: 'text',
    title: 'Cast list',
    pictures: { 'gate.png': { mime: 'image/png' } },
  },
  { id: 'drafts', parentId: 'root_s', type: 'folder', title: 'Drafts' },
  { id: 'one', parentId: 'drafts', type: 'text', title: 'Chapter 1' },
]

const { mockApi, openUrl, editorRequest } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    childrenOf: vi.fn(),
    open: vi.fn(),
  },
  openUrl: vi.fn(),
  editorRequest: { show: vi.fn() },
}))
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => mockApi }))
vi.mock('@/composables/useEditorRequest.js', () => ({ useEditorRequest: () => editorRequest }))
vi.mock('@/platform/open.js', () => ({ openUrl }))

describe('useDocumentLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.get.mockImplementation(id => docs.find(doc => doc.id === id) ?? null)
    mockApi.childrenOf.mockImplementation(parentId => docs.filter(doc => doc.parentId === parentId))
  })

  describe('open', () => {
    it('opens the document a link goes to, and the editor with it', () => {
      useDocumentLinks('s').open('../Notes/Cast%20list.md', 'one')
      expect(mockApi.open).toHaveBeenCalledWith('cast', { preview: true })
      expect(editorRequest.show).toHaveBeenCalled()
      expect(openUrl).not.toHaveBeenCalled()
    })

    it('opens a web address outside the app, as before', () => {
      useDocumentLinks('s').open('https://example.com', 'one')
      expect(openUrl).toHaveBeenCalledWith('https://example.com')
      expect(mockApi.open).not.toHaveBeenCalled()
    })

    it('goes nowhere when there is no such document', () => {
      useDocumentLinks('s').open('../Notes/Nobody%20here.md', 'one')
      expect(mockApi.open).not.toHaveBeenCalled()
      expect(openUrl).not.toHaveBeenCalled()
    })

    it("shows a document's own picture at its own size, from a chat as from a document", () => {
      const viewer = usePictureViewer()
      useDocumentLinks('s').open('.images/cast/gate.png')
      expect(viewer.shown.value).toMatchObject({ key: 'cast/gate.png' })
      expect(mockApi.open).not.toHaveBeenCalled()
      viewer.close()
    })

    it('opens nothing for a link to a folder', () => {
      useDocumentLinks('s').open('../Notes', 'one')
      expect(mockApi.open).not.toHaveBeenCalled()
    })
  })

  describe('addressFor', () => {
    it('links a document named by a project path or by its name alone', () => {
      const links = useDocumentLinks('s')
      expect(links.addressFor('Notes/Cast list', 'one')).toBe('../Notes/Cast%20list.md')
      expect(links.addressFor('/Notes/Cast list', 'one')).toBe('../Notes/Cast%20list.md')
      expect(links.addressFor('cast list', 'one')).toBe('../Notes/Cast%20list.md')
      expect(links.addressFor('Notes/Cast list#who', 'one')).toBe('../Notes/Cast%20list.md#who')
    })

    it('keeps a relative path that names nothing, and makes the rest web addresses', () => {
      const links = useDocumentLinks('s')
      expect(links.addressFor('../Later/Not yet.md', 'one')).toBe('../Later/Not%20yet.md')
      expect(links.addressFor('example.com', 'one')).toBe('https://example.com')
      expect(links.addressFor('mailto:a@example.com', 'one')).toBe('mailto:a@example.com')
      expect(links.addressFor('  ', 'one')).toBe('')
    })
  })

  describe('copy and paste', () => {
    it('carries a link as a path from the top, and writes it from where it is pasted', () => {
      const links = useDocumentLinks('s')
      const copied = links.copiedHref('../Notes/Cast%20list.md', 'one')
      expect(copied).toBe('/Notes/Cast%20list.md')
      // Into a document beside it, and into one in the folder it links to.
      expect(links.pastedHref(copied, 'one')).toBe('../Notes/Cast%20list.md')
      expect(links.pastedHref(copied, 'cast')).toBe('Cast%20list.md')
    })

    it('keeps a link into the document itself as its place in it', () => {
      const links = useDocumentLinks('s')
      const copied = links.copiedHref('#who', 'cast')
      expect(copied).toBe('/Notes/Cast%20list.md#who')
      expect(links.pastedHref(copied, 'cast')).toBe('#who')
      expect(links.pastedHref(copied, 'one')).toBe('../Notes/Cast%20list.md#who')
    })

    it("leaves web addresses, a document's own pictures and what names nothing as they are", () => {
      const links = useDocumentLinks('s')
      for (const href of [
        'https://example.com',
        '.images/cast/gate.png',
        '../Later/Not%20yet.md',
      ]) {
        expect(links.copiedHref(href, 'one')).toBe(href)
      }
      expect(links.pastedHref('/Nowhere/at%20all.md', 'one')).toBe('/Nowhere/at%20all.md')
      expect(links.pastedHref('mailto:a@example.com', 'one')).toBe('mailto:a@example.com')
    })
  })

  describe('onClick', () => {
    /** @param {string} href */
    const clickOn = href => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', href)
      anchor.textContent = 'a link'
      document.body.append(anchor)
      const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      anchor.addEventListener('click', clicked => useDocumentLinks('s').onClick(clicked))
      anchor.dispatchEvent(event)
      anchor.remove()
      return event
    }

    it('opens a document a rendered link goes to, rather than letting the page go there', () => {
      const event = clickOn('Notes/Cast%20list.md')
      expect(event.defaultPrevented).toBe(true)
      expect(mockApi.open).toHaveBeenCalledWith('cast', { preview: true })
    })

    it('leaves a web link to the rest of the app', () => {
      const event = clickOn('https://example.com')
      expect(event.defaultPrevented).toBe(false)
      expect(mockApi.open).not.toHaveBeenCalled()
    })
  })
})
