import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDocumentLinks } from '@/composables/useDocumentLinks.js'

const docs = [
  { id: 'root_s', parentId: 's', type: 'folder', title: 'Novel' },
  { id: 'notes', parentId: 'root_s', type: 'folder', title: 'Notes' },
  { id: 'cast', parentId: 'notes', type: 'text', title: 'Cast list' },
  { id: 'drafts', parentId: 'root_s', type: 'folder', title: 'Drafts' },
  { id: 'one', parentId: 'drafts', type: 'text', title: 'Chapter 1' },
]

const { mockApi, toast, openUrl, editorRequest } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    childrenOf: vi.fn(),
    open: vi.fn(),
  },
  toast: { warning: vi.fn(), info: vi.fn() },
  openUrl: vi.fn(),
  editorRequest: { show: vi.fn() },
}))
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => mockApi }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))
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

    it('says so when there is no such document, and goes nowhere', () => {
      useDocumentLinks('s').open('../Notes/Nobody%20here.md', 'one')
      expect(toast.warning).toHaveBeenCalledWith('There is no document at ../Notes/Nobody here.md.')
      expect(mockApi.open).not.toHaveBeenCalled()
      expect(openUrl).not.toHaveBeenCalled()
    })

    it('says a link to a folder goes to a folder', () => {
      useDocumentLinks('s').open('../Notes', 'one')
      expect(toast.info).toHaveBeenCalledWith('This link goes to a folder.')
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
