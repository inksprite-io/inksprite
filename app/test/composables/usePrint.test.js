import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { isPrintKey, usePrint, usePrintKey } from '@/composables/usePrint.js'

const documents = {
  doc_1: { id: 'doc_1', type: 'text', title: 'The Thief' },
  doc_2: { id: 'doc_2', type: 'text', title: 'analysis.py', plain: true },
  doc_3: { id: 'doc_3', type: 'file', title: 'Rules' },
  folder_1: { id: 'folder_1', type: 'folder', title: 'Notes' },
}
const contents = {
  doc_1: '# The gate\n\n![The map](.images/doc_1/map.png)\n\nShe waited.',
}
const tabs = vi.hoisted(() => ({ active: 'doc_1' }))
vi.mock('@/composables/useDocuments.js', () => ({
  useDocuments: () => ({
    get: (/** @type {string} */ id) =>
      documents[/** @type {keyof typeof documents} */ (id)] ?? null,
    currentContent: (/** @type {string} */ id) =>
      contents[/** @type {keyof typeof contents} */ (id)] ?? '',
    displayTitle: (/** @type {{title: string}} */ document) => document.title,
    activeDocumentId: { value: tabs.active },
  }),
}))

vi.mock('@/composables/usePictures.js', () => ({
  usePictures: () => ({
    describe: (/** @type {string} */ src) =>
      src.includes('map')
        ? { kind: 'picture', key: 'doc_1/map.png', load: async () => null }
        : { kind: 'web', host: 'example.com' },
  }),
}))

const urls = vi.hoisted(() => ({ take: vi.fn(), give: vi.fn() }))
vi.mock('@/editor/pictures.js', () => ({
  takePictureUrl: (/** @type {string} */ key) => urls.take(key),
  givePictureUrl: (/** @type {string} */ key) => urls.give(key),
}))

const toast = { error: vi.fn() }
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

/** The desktop app's PDFs, there or not. */
const pdf = vi.hoisted(() => ({ can: false, save: vi.fn() }))
vi.mock('@/platform/printing.js', () => ({
  canSavePdf: () => pdf.can,
  savePdf: (/** @type {string} */ name) => pdf.save(name),
}))

/** What the page was when the print was asked for. */
const seen = () => ({
  printing: document.documentElement.classList.contains('printing'),
  title: document.title,
  page: document.querySelector('body > .print-page')?.innerHTML ?? null,
})

const PAGE =
  '<h1>The gate</h1><p class="figure"><img src="blob:map" alt="The map"></p><p>She waited.</p>'

beforeEach(() => {
  vi.stubGlobal('CSS', { supports: () => false })
  document.title = 'inksprite'
  urls.take.mockReset().mockResolvedValue('blob:map')
  urls.give.mockReset()
  toast.error.mockReset()
  pdf.can = false
  pdf.save.mockReset()
  tabs.active = 'doc_1'
})

afterEach(() => {
  window.dispatchEvent(new window.Event('afterprint'))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('usePrint', () => {
  it('prints only a text laid out', () => {
    const { printable } = usePrint('story_1')
    expect(printable('doc_1')).toBe(documents.doc_1)
    expect(printable('doc_2')).toBeNull()
    expect(printable('doc_3')).toBeNull()
    expect(printable('folder_1')).toBeNull()
    expect(printable('nothing')).toBeNull()
  })

  it('puts the page in the app’s for the print dialog, and takes it away after', async () => {
    /** @type {ReturnType<typeof seen>|null} */
    let during = null
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      during = seen()
    })
    await usePrint('story_1').printDocument('doc_1')

    expect(print).toHaveBeenCalledOnce()
    expect(during).toEqual({ printing: true, title: 'The Thief', page: PAGE })
    expect(urls.take).toHaveBeenCalledWith('doc_1/map.png')
    // Still there until the print is done with it.
    expect(seen().page).toBe(PAGE)

    window.dispatchEvent(new window.Event('afterprint'))
    expect(seen()).toEqual({ printing: false, title: 'inksprite', page: null })
    expect(urls.give).toHaveBeenCalledWith('doc_1/map.png')
  })

  it('does nothing for a document that doesn’t print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await usePrint('story_1').printDocument('doc_2')
    await usePrint('story_1').exportPdf('folder_1')
    expect(print).not.toHaveBeenCalled()
    expect(seen().page).toBeNull()
  })

  it('opens the print dialog for a PDF in a browser', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await usePrint('story_1').exportPdf('doc_1')
    expect(print).toHaveBeenCalledOnce()
  })

  it('saves a PDF in the desktop app without the dialog, and puts the app back', async () => {
    pdf.can = true
    /** @type {ReturnType<typeof seen>|null} */
    let during = null
    pdf.save.mockImplementation(async () => {
      during = seen()
      return true
    })
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await usePrint('story_1').exportPdf('doc_1')

    expect(print).not.toHaveBeenCalled()
    expect(pdf.save).toHaveBeenCalledWith('The Thief')
    expect(during).toEqual({ printing: true, title: 'The Thief', page: PAGE })
    expect(seen()).toEqual({ printing: false, title: 'inksprite', page: null })
    expect(urls.give).toHaveBeenCalledWith('doc_1/map.png')
  })

  it('says why a PDF wasn’t saved', async () => {
    pdf.can = true
    pdf.save.mockRejectedValue(new Error('The disk is full.'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await usePrint('story_1').exportPdf('doc_1')
    expect(toast.error).toHaveBeenCalledWith(
      "The document couldn't be saved as a PDF. The disk is full."
    )
    expect(seen()).toEqual({ printing: false, title: 'inksprite', page: null })
  })

  it('prints the page of the print begun last', async () => {
    let shownFirst = /** @type {(url: string) => void} */ (() => {})
    urls.take
      .mockImplementationOnce(() => new Promise(resolve => (shownFirst = resolve)))
      .mockResolvedValueOnce('blob:map')
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { printDocument } = usePrint('story_1')
    const first = printDocument('doc_1')
    await printDocument('doc_1')
    shownFirst('blob:old')
    await first
    expect(print).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('.print-page')).toHaveLength(1)
    expect(urls.give).toHaveBeenCalledTimes(1)
  })
})

describe('isPrintKey', () => {
  const key = (/** @type {KeyboardEventInit} */ init) => new window.KeyboardEvent('keydown', init)

  it('is Command-P on a Mac and Control-P elsewhere, without Shift or Option', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    expect(isPrintKey(key({ key: 'p', metaKey: true }))).toBe(true)
    expect(isPrintKey(key({ key: 'p', ctrlKey: true }))).toBe(false)
    expect(isPrintKey(key({ key: 'p', metaKey: true, shiftKey: true }))).toBe(false)
    expect(isPrintKey(key({ key: 'π', metaKey: true, altKey: true }))).toBe(false)

    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    expect(isPrintKey(key({ key: 'p', ctrlKey: true }))).toBe(true)
    expect(isPrintKey(key({ key: 'p', metaKey: true }))).toBe(false)
  })
})

describe('usePrintKey', () => {
  /** @param {() => string} storyId */
  const mountWith = storyId =>
    mount(
      defineComponent({
        setup() {
          usePrintKey(storyId)
          return () => h('div')
        },
      })
    )

  /** Press Control-P, as off a Mac. */
  const press = () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    const event = new window.KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  it('prints the document open, rather than the app', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const wrapper = mountWith(() => 'story_1')
    expect(press().defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce())
    wrapper.unmount()
  })

  it('takes the key and does nothing when the document open doesn’t print', async () => {
    tabs.active = 'doc_3'
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const wrapper = mountWith(() => 'story_1')
    expect(press().defaultPrevented).toBe(true)
    await new Promise(resolve => setTimeout(resolve))
    expect(print).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
