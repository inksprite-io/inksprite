/* global Blob, HTMLCanvasElement, HTMLElement */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PdfView from '@/components/writer/editor/PdfView.vue'

/** What pdf.js is asked for, so a test can see the pages were drawn. */
const calls = { rendered: [], textLayers: [], cleaned: 0, closed: 0, cancelled: 0 }

/**
 * A render task with a private field, as pdf.js's has: a reactive proxy over
 * it cannot reach `#done`, so cancelling through one throws.
 */
class FakeRenderTask {
  #done = false
  promise = Promise.resolve()
  cancel() {
    if (this.#done) return
    this.#done = true
    calls.cancelled++
  }
}

/** A page of a given size: a viewport by scale, a render task, a text stream. */
const fakePage = (width, height) => ({
  getViewport: ({ scale }) => ({ width: width * scale, height: height * scale, scale }),
  render: options => {
    calls.rendered.push(options)
    return new FakeRenderTask()
  },
  streamTextContent: () => ({ stream: true }),
  cleanup: () => calls.cleaned++,
})

let pages = [fakePage(600, 800), fakePage(600, 800), fakePage(800, 600)]
let openFails = false
/** Text layers that never finish, for a view taken down mid-draw. */
let slow = false

vi.mock('@/files/pdf.js', () => ({
  openPdf: async () => {
    if (openFails) throw new Error('not a PDF')
    return {
      document: { numPages: pages.length, getPage: async number => pages[number - 1] },
      lib: {
        TextLayer: class {
          #cancelled = false
          constructor(options) {
            calls.textLayers.push(options)
          }
          render() {
            return slow ? new Promise(() => {}) : Promise.resolve()
          }
          cancel() {
            if (this.#cancelled) return
            this.#cancelled = true
            calls.cancelled++
          }
        },
      },
      close: async () => calls.closed++,
    }
  },
}))

/** A 2D context, which happy-dom's canvas does not have. */
const context = {}

const mountView = () =>
  mount(PdfView, {
    props: { blob: new Blob(['%PDF'], { type: 'application/pdf' }) },
    attachTo: document.body,
  })

/** Let the mount, the open, and the frame the sheets are watched on go by. */
const settle = async () => {
  await flushPromises()
  await new Promise(resolve => setTimeout(resolve, 30))
  await flushPromises()
}

describe('PdfView', () => {
  beforeEach(() => {
    calls.rendered = []
    calls.textLayers = []
    calls.cleaned = 0
    calls.closed = 0
    calls.cancelled = 0
    openFails = false
    slow = false
    pages = [fakePage(600, 800), fakePage(600, 800), fakePage(800, 600)]
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context)
    // happy-dom's observers never fire; without them every page is drawn.
    window.IntersectionObserver = undefined
    window.ResizeObserver = undefined
    window.requestAnimationFrame = callback => setTimeout(callback, 0)
    // A panel 632px wide: 600 for the page after the gutters.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 632
      },
    })
  })

  it('lays out one sheet per page, fit to the panel, sized from the first page', async () => {
    const wrapper = mountView()
    await settle()

    const sheets = wrapper.findAll('[data-pdf-page]')
    expect(sheets).toHaveLength(3)
    expect(sheets[0].attributes('style')).toContain('width: 600px')
    expect(sheets[0].attributes('style')).toContain('height: 800px')
    expect(sheets[0].attributes('aria-label')).toBe('Page 1')
    wrapper.unmount()
  })

  it('draws every page with a text layer over it when there is nothing to watch from', async () => {
    const wrapper = mountView()
    await settle()

    expect(calls.rendered).toHaveLength(3)
    expect(calls.rendered[0].viewport.scale).toBe(1)
    expect(calls.rendered[0].canvasContext).toBe(context)
    expect(calls.textLayers).toHaveLength(3)
    expect(calls.textLayers[0].container.className).toBe('textLayer')
    expect(calls.textLayers[0].container.style.getPropertyValue('--scale-factor')).toBe('1')
    wrapper.unmount()
  })

  it('takes a page of another shape at its own height', async () => {
    const wrapper = mountView()
    await settle()

    // The third page is landscape: 800 wide by 600, so 450 tall at 600 wide.
    expect(wrapper.findAll('[data-pdf-page]')[2].attributes('style')).toContain('height: 450px')
    wrapper.unmount()
  })

  it('cancels a draw still in flight when the view goes', async () => {
    slow = true
    const wrapper = mountView()
    await settle()

    wrapper.unmount()
    // Three pages were mid-draw, a render task and a text layer each, and
    // every one is told to stop through its own methods, not through a
    // proxy that cannot reach them.
    expect(calls.cancelled).toBe(6)
    expect(calls.closed).toBe(1)
  })

  it('lets the document go when the view does', async () => {
    const wrapper = mountView()
    await settle()

    wrapper.unmount()
    expect(calls.closed).toBe(1)
  })

  it('says so when the file cannot be opened', async () => {
    openFails = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountView()
    await settle()

    expect(wrapper.find('[data-pdf-error]').text()).toBe('This PDF could not be opened.')
    expect(wrapper.findAll('[data-pdf-page]')).toHaveLength(0)
    wrapper.unmount()
  })
})
