/* global Blob, KeyboardEvent, MouseEvent */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import PictureViewer from '@/components/writer/editor/PictureViewer.vue'
import { usePictureViewer } from '@/composables/usePictureViewer.js'

URL.createObjectURL = vi.fn(() => 'blob:viewed')
URL.revokeObjectURL = vi.fn()

const mountViewer = () =>
  mount(PictureViewer, { global: { plugins: [PrimeVue] }, attachTo: document.body })

/** What the viewer draws, which it puts at the end of the page. */
const shownIn = () => document.querySelector('[data-picture-viewer]')

describe('PictureViewer', () => {
  beforeEach(() => {
    usePictureViewer().close()
  })

  it('shows nothing until a picture is asked for', () => {
    const wrapper = mountViewer()
    expect(shownIn()).toBe(null)
    wrapper.unmount()
  })

  it('shows the picture asked for, fit to the window until clicked', async () => {
    const wrapper = mountViewer()
    usePictureViewer().show({
      key: 'ch1/gate.png',
      load: async () => new Blob(['png'], { type: 'image/png' }),
      alt: 'The north gate',
    })
    await flushPromises()

    const image = /** @type {HTMLImageElement} */ (
      document.querySelector('[data-picture-viewer-image]')
    )
    expect(image.getAttribute('src')).toBe('blob:viewed')
    expect(image.alt).toBe('The north gate')
    expect(image.className).toContain('max-h-full')
    // The last click of the double click that opened it, pressed before it was there.
    image.click()
    await flushPromises()
    expect(image.className).toContain('max-h-full')
    image.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    image.click()
    await flushPromises()
    expect(image.className).toContain('max-w-none')
    wrapper.unmount()
  })

  it('says so when the picture has no bytes', async () => {
    const wrapper = mountViewer()
    usePictureViewer().show({ key: 'ch1/none.png', load: async () => null })
    await flushPromises()
    expect(document.querySelector('[data-picture-viewer-missing]')?.textContent?.trim()).toBe(
      'Missing picture'
    )
    wrapper.unmount()
  })

  it('goes on Escape, and on its close button', async () => {
    const wrapper = mountViewer()
    const viewer = usePictureViewer()
    viewer.show({ key: 'ch1/gate.png', load: async () => new Blob(['png']) })
    await flushPromises()

    shownIn()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(viewer.shown.value).toBe(null)
    expect(shownIn()).toBe(null)

    viewer.show({ key: 'ch1/gate.png', load: async () => new Blob(['png']) })
    await flushPromises()
    const close = /** @type {HTMLElement} */ (
      document.querySelector('[data-action="close-picture"]')
    )
    close.click()
    await flushPromises()
    expect(viewer.shown.value).toBe(null)
    wrapper.unmount()
  })
})
