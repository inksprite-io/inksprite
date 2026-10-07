/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import FileView from '@/components/writer/editor/FileView.vue'
import { minimalEpub } from '../files/helpers.js'

const documents = new Map()
vi.mock('@/composables/useDocuments', () => ({
  useDocuments: () => ({
    get: id => documents.get(id) || null,
    displayTitle: document => document?.title || 'Untitled',
  }),
}))

const getFile = vi.fn()
vi.mock('@/stores/filesStore', () => ({ useFilesStore: () => ({ getFile }) }))

const downloadBlob = vi.fn()
vi.mock('@/files/download.js', () => ({
  downloadBlob: (...args) => downloadBlob(...args),
  filenameFor: document => `${document.title}.bin`,
}))

// CodeMirror is CodeView's business, tested on its own.
vi.mock('@/components/writer/editor/CodeView.vue', () => ({
  __esModule: true,
  default: {
    props: ['content', 'filename'],
    template: '<pre data-code-stub :data-filename="filename">{{ content }}</pre>',
  },
}))

// The pages are pdf.js's business, tested on their own.
const PdfView = { props: ['blob'], template: '<div data-pdf-stub :data-type="blob.type" />' }

const mountView = documentId =>
  mount(FileView, {
    props: { storyId: 'story_1', documentId },
    global: { plugins: [PrimeVue], stubs: { PdfView } },
  })

describe('FileView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    documents.clear()
    documents.set('img', {
      id: 'img',
      type: 'file',
      title: 'Holiday',
      mime: 'image/png',
      size: 2048,
    })
    documents.set('pdf', { id: 'pdf', type: 'file', title: 'Paper', mime: 'application/pdf' })
    documents.set('docx', {
      id: 'docx',
      type: 'file',
      title: 'Novel',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 3 * 1024 * 1024,
    })
    documents.set('epub', {
      id: 'epub',
      type: 'file',
      title: 'Tides',
      mime: 'application/epub+zip',
    })
    URL.createObjectURL = vi.fn(() => 'blob:the-file')
    URL.revokeObjectURL = vi.fn()
    getFile.mockImplementation(async id => new Blob(['bytes'], { type: documents.get(id)?.mime }))
  })

  it('shows a picture, fit to the panel, and at its own size on a click', async () => {
    const wrapper = mountView('img')
    await flushPromises()

    const image = wrapper.find('[data-file-image]')
    expect(image.attributes('src')).toBe('blob:the-file')
    expect(image.attributes('alt')).toBe('Holiday')
    expect(image.classes()).toContain('object-contain')

    await image.trigger('click')
    expect(wrapper.find('[data-file-image]').classes()).toContain('max-w-none')
  })

  it('hands a PDF to the page renderer, with no object URL made for it', async () => {
    const wrapper = mountView('pdf')
    await flushPromises()

    const pages = wrapper.find('[data-pdf-stub]')
    expect(pages.exists()).toBe(true)
    expect(pages.attributes('data-type')).toBe('application/pdf')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('shows an epub as its chapters, read out of the file', async () => {
    const epub = minimalEpub(['<p>The <em>tide</em> came in.</p>'], {
      toc: [{ title: 'One', page: 0 }],
    })
    getFile.mockResolvedValue(new Blob([epub], { type: 'application/epub+zip' }))
    const wrapper = mountView('epub')
    await flushPromises()

    const book = wrapper.find('[data-file-epub]')
    expect(book.find('h1').text()).toBe('One')
    expect(book.find('em').text()).toBe('tide')
  })

  it('says why an epub that cannot be read is not shown', async () => {
    const wrapper = mountView('epub')
    await flushPromises()

    const none = wrapper.find('[data-file-none]')
    expect(none.text()).toContain('No preview available')
    expect(none.text()).toContain('not a zip file')
  })

  it('says there is no preview of anything else, and offers the file', async () => {
    const wrapper = mountView('docx')
    await flushPromises()

    const none = wrapper.find('[data-file-none]')
    expect(none.text()).toContain('No preview available')
    expect(none.text()).toContain('wordprocessingml.document · 3.0 MB')
    expect(URL.createObjectURL).not.toHaveBeenCalled()

    await none.find('button').trigger('click')
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Novel.bin')
  })

  it('says when the bytes are gone, with nothing to download', async () => {
    getFile.mockResolvedValue(null)
    const wrapper = mountView('img')
    await flushPromises()

    const none = wrapper.find('[data-file-none]')
    expect(none.text()).toContain('No preview available')
    expect(none.text()).toContain('not in this project any more')
    expect(none.find('button').exists()).toBe(false)
  })

  it('lets the object URL go when the view does', async () => {
    const wrapper = mountView('img')
    await flushPromises()

    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:the-file')
  })

  describe('a file of text', () => {
    it("shows a repository's file, which keeps no bytes, as code", async () => {
      documents.set('src', {
        id: 'src',
        type: 'file',
        title: 'index.ts',
        mime: 'text/x-typescript',
        content: 'export {}\n',
      })
      getFile.mockResolvedValue(null)

      const wrapper = mountView('src')
      await flushPromises()

      const code = wrapper.find('[data-code-stub]')
      expect(code.text()).toBe('export {}')
      expect(code.attributes('data-filename')).toBe('index.ts')
      expect(wrapper.find('[data-file-none]').exists()).toBe(false)
    })

    it('shows a JSON file imported on its own as code, and a web page still as no preview', async () => {
      documents.set('json', {
        id: 'json',
        type: 'file',
        title: 'data',
        mime: 'application/json',
        content: '{"a": 1}',
      })
      documents.set('html', { id: 'html', type: 'file', title: 'Page', mime: 'text/html' })

      const json = mountView('json')
      await flushPromises()
      expect(json.find('[data-code-stub]').exists()).toBe(true)

      const html = mountView('html')
      await flushPromises()
      expect(html.find('[data-code-stub]').exists()).toBe(false)
      expect(html.find('[data-file-none]').exists()).toBe(true)
    })

    it('still shows a picture as a picture', async () => {
      const wrapper = mountView('img')
      await flushPromises()
      expect(wrapper.find('[data-file-image]').exists()).toBe(true)
      expect(wrapper.find('[data-code-stub]').exists()).toBe(false)
    })
  })
})
