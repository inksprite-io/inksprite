/* global location */
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
    content: '# Cast list\n\nWho.\n\n## The crew\n\nA pilot.\n\n## The cook\n\nSoup.',
  },
  { id: 'drafts', parentId: 'root_s', type: 'folder', title: 'Drafts' },
  { id: 'one', parentId: 'drafts', type: 'text', title: 'Chapter 1' },
]

const { mockApi, openUrl, editorRequest } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    childrenOf: vi.fn(),
    open: vi.fn(),
    displayTitle: doc => doc.title,
    titlesOf: vi.fn(),
    pathOf: vi.fn(),
    isPlain: () => false,
    currentContent: vi.fn(),
  },
  openUrl: vi.fn(),
  editorRequest: { show: vi.fn(), goToHeading: vi.fn() },
}))
vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => mockApi }))
vi.mock('@/composables/useEditorRequest.js', () => ({ useEditorRequest: () => editorRequest }))
vi.mock('@/platform/open.js', () => ({ openUrl }))

describe('useDocumentLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.get.mockImplementation(id => docs.find(doc => doc.id === id) ?? null)
    mockApi.childrenOf.mockImplementation(parentId => docs.filter(doc => doc.parentId === parentId))
    const titles = id => {
      const out = []
      for (let at = mockApi.get(id); at && at.id !== 'root_s'; at = mockApi.get(at.parentId)) {
        out.unshift(at.title)
      }
      return out
    }
    mockApi.titlesOf.mockImplementation(titles)
    mockApi.pathOf.mockImplementation(id => titles(id).join('/'))
    mockApi.currentContent.mockImplementation(id => mockApi.get(id)?.content ?? '')
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

    it('goes on to the heading a link names, in the document it opens', () => {
      useDocumentLinks('s').open('../Notes/Cast%20list.md#The%20crew', 'one')
      expect(mockApi.open).toHaveBeenCalledWith('cast', { preview: true })
      expect(editorRequest.goToHeading).toHaveBeenCalledWith('cast', 'The crew')
      useDocumentLinks('s').open('#The%20cook', 'cast')
      expect(editorRequest.goToHeading).toHaveBeenLastCalledWith('cast', 'The cook')
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

  describe('suggest', () => {
    it('offers the documents a name could be, the likeliest first, and no folders', () => {
      const links = useDocumentLinks('s')
      expect(links.suggest('', 'one').map(entry => entry.title)).toEqual(['Cast list', 'Chapter 1'])
      expect(links.suggest('ch', 'cast')).toEqual([
        { key: 'one', title: 'Chapter 1', detail: 'Drafts', href: '../Drafts/Chapter%201.md' },
      ])
      // A word in the name, then anywhere in the path.
      expect(links.suggest('list', 'one').map(entry => entry.key)).toEqual(['cast'])
      expect(links.suggest('notes', 'one').map(entry => entry.key)).toEqual(['cast'])
      expect(links.suggest('nobody', 'one')).toEqual([])
    })

    it('offers the headings of the document named before a `#`, or of this one', () => {
      const links = useDocumentLinks('s')
      expect(links.suggest('Cast list#cr', 'one')).toEqual([
        {
          key: 'cast#1',
          title: 'The crew',
          detail: 'Cast list',
          href: '../Notes/Cast%20list.md#The%20crew',
          heading: true,
        },
      ])
      expect(links.suggest('#', 'cast').map(entry => entry.href)).toEqual([
        '#Cast%20list',
        '#The%20crew',
        '#The%20cook',
      ])
    })
  })

  describe('chatLink', () => {
    it('writes a link the app copied as Markdown with the path the tools take', () => {
      const links = useDocumentLinks('s')
      expect(links.chatLink('/Notes/Cast%20list.md', 'Cast list')).toBe(
        '[Cast list](</Notes/Cast list>)'
      )
      expect(links.chatLink('/Notes/Cast%20list.md#The%20crew', 'the [crew]')).toBe(
        '[the \\[crew\\]](</Notes/Cast list#The crew>)'
      )
    })

    it('gives the path alone, as the tools and the commands take it', () => {
      const links = useDocumentLinks('s')
      expect(links.chatPath('/Notes/Cast%20list.md#The%20crew')).toBe('/Notes/Cast list#The crew')
      expect(links.chatPath('/Notes')).toBeNull()
    })

    it('writes nothing for a link to no document, a folder, or the web', () => {
      const links = useDocumentLinks('s')
      expect(links.chatLink('/Nowhere.md', 'x')).toBeNull()
      expect(links.chatLink('/Notes', 'x')).toBeNull()
      expect(links.chatLink('https://example.com', 'x')).toBeNull()
    })
  })

  it('writes a link pasted with the app’s own address from where it is pasted', () => {
    const links = useDocumentLinks('s')
    expect(links.pastedHref(`${location.origin}/Notes/Cast%20list.md`, 'one')).toBe(
      '../Notes/Cast%20list.md'
    )
    expect(links.pastedHref(`${location.origin}/project/s`, 'one')).toBe(
      `${location.origin}/project/s`
    )
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
