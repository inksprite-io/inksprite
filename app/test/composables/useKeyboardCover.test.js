import { describe, it, expect, afterEach, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useKeyboardCover } from '@/composables/useKeyboardCover.js'

/** A full-height element, its bottom at 800, and what the composable says of it. */
const mountCovered = () => {
  const element = ref(null)
  /** @type {{ covered: import('vue').Ref<number>|null }} */
  const measured = { covered: null }
  const wrapper = mount(
    defineComponent({
      setup() {
        measured.covered = useKeyboardCover(element)
        return () => h('div', { ref: element })
      },
    })
  )
  vi.spyOn(element.value, 'getBoundingClientRect').mockReturnValue(
    /** @type {DOMRect} */ ({ bottom: 800 })
  )
  return { wrapper, covered: () => measured.covered?.value }
}

/** A visual viewport that can be moved, as the keyboard and iOS's panning move it. */
const fakeViewport = (height, offsetTop) => {
  const target = new window.EventTarget()
  const viewport = Object.assign(target, { height, offsetTop })
  vi.stubGlobal('visualViewport', viewport)
  return viewport
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useKeyboardCover', () => {
  it('is how far the element runs on under the visible part of the page', () => {
    const viewport = fakeViewport(800, 0)
    const { wrapper, covered } = mountCovered()

    viewport.height = 500
    viewport.dispatchEvent(new window.Event('resize'))
    expect(covered()).toBe(300)

    // iOS pans the page up under the keyboard, and less of it is covered.
    viewport.offsetTop = 120
    viewport.dispatchEvent(new window.Event('scroll'))
    expect(covered()).toBe(180)

    wrapper.unmount()
  })

  it('is nothing where the page is made smaller for the keyboard, or cannot be measured', () => {
    fakeViewport(800, 0)
    const { wrapper, covered } = mountCovered()
    window.dispatchEvent(new window.Event('resize'))
    expect(covered()).toBe(0)
    wrapper.unmount()

    vi.stubGlobal('visualViewport', undefined)
    const unmeasured = mountCovered()
    window.dispatchEvent(new window.Event('resize'))
    expect(unmeasured.covered()).toBe(0)
    unmeasured.wrapper.unmount()
  })
})
