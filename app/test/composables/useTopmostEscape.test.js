import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { isTopmostMask, useTopmostEscape } from '@/composables/useTopmostEscape.js'

/** A dialog mask on the page, as PrimeVue leaves one. */
const openMask = () => {
  const mask = document.createElement('div')
  mask.className = 'p-dialog-mask'
  document.body.appendChild(mask)
  return mask
}

const escape = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))

/** Mount something that listens the way a dialog would. */
const listen = (visible, mask) => {
  const close = vi.fn()
  const wrapper = mount(
    defineComponent({
      setup() {
        useTopmostEscape(visible, () => mask, close)
        return () => h('div')
      },
    })
  )
  return { close, wrapper }
}

describe('useTopmostEscape', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('knows which mask is on top', () => {
    const below = openMask()
    expect(isTopmostMask(below)).toBe(true)
    const above = openMask()
    expect(isTopmostMask(below)).toBe(false)
    expect(isTopmostMask(above)).toBe(true)
    expect(isTopmostMask(null)).toBe(false)
  })

  it('closes on Escape while nothing is open over it', () => {
    const mask = openMask()
    const { close } = listen(ref(true), mask)

    escape()

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape to the dialog opened over it', () => {
    const mask = openMask()
    const { close } = listen(ref(true), mask)
    openMask()

    escape()

    expect(close).not.toHaveBeenCalled()
  })

  it('listens only while showing, and not after it is gone', async () => {
    const mask = openMask()
    const visible = ref(false)
    const { close, wrapper } = listen(visible, mask)

    escape()
    expect(close).not.toHaveBeenCalled()

    visible.value = true
    await wrapper.vm.$nextTick()
    escape()
    expect(close).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    escape()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
