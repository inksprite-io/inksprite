import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { isEscapeFor, isTopmostMask, useTopmostEscape } from '@/composables/useTopmostEscape.js'

/** A dialog mask on the page, as PrimeVue leaves one. */
const openMask = () => {
  const mask = document.createElement('div')
  mask.className = 'p-dialog-mask'
  document.body.appendChild(mask)
  return mask
}

const escape = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))

/** Press Escape in an element, letting it bubble to the document. */
const escapeIn = (element, init = {}) => {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init,
  })
  element.dispatchEvent(event)
  return event
}

/** Something PrimeVue puts on the body without a mask: a popup menu. */
const openOverlay = () => {
  const overlay = document.createElement('ul')
  overlay.className = 'p-menu-overlay'
  document.body.appendChild(overlay)
  return overlay
}

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

  it('closes on Escape pressed inside it', () => {
    const mask = openMask()
    const field = document.createElement('input')
    mask.appendChild(field)
    const { close } = listen(ref(true), mask)

    escapeIn(field)

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape to a menu opened over it, which has no mask', () => {
    const mask = openMask()
    const { close } = listen(ref(true), mask)
    const menu = openOverlay()
    // The menu closes itself on the key before it reaches the document, so
    // it is already gone by the time the dialog hears it.
    menu.addEventListener('keydown', () => menu.remove())

    escapeIn(menu)

    expect(close).not.toHaveBeenCalled()
  })

  it('leaves Escape to a select inside it whose list is open', () => {
    const mask = openMask()
    const select = document.createElement('span')
    select.setAttribute('aria-haspopup', 'listbox')
    select.setAttribute('aria-expanded', 'true')
    mask.appendChild(select)
    // The select shuts its list, says so, and marks the key handled, all
    // before the key is back up at the document.
    select.addEventListener('keydown', event => {
      select.setAttribute('aria-expanded', 'false')
      event.preventDefault()
    })
    const { close } = listen(ref(true), mask)

    escapeIn(select)

    expect(close).not.toHaveBeenCalled()
  })

  it('closes on Escape on a select whose list is shut, though the select stops the key', () => {
    const mask = openMask()
    const select = document.createElement('span')
    select.setAttribute('aria-haspopup', 'listbox')
    select.setAttribute('aria-expanded', 'false')
    mask.appendChild(select)
    select.addEventListener('keydown', event => {
      event.preventDefault()
      event.stopPropagation()
    })
    const { close } = listen(ref(true), mask)

    escapeIn(select)

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape on a shut select in a dialog opened over it', () => {
    const below = openMask()
    const above = openMask()
    const select = document.createElement('span')
    select.setAttribute('aria-haspopup', 'listbox')
    select.setAttribute('aria-expanded', 'false')
    above.appendChild(select)
    const { close } = listen(ref(true), below)

    escapeIn(select)

    expect(close).not.toHaveBeenCalled()
  })

  it('leaves Escape to a field inside it that stops it', () => {
    const mask = openMask()
    const field = document.createElement('input')
    mask.appendChild(field)
    field.addEventListener('keydown', event => event.stopPropagation())
    const { close } = listen(ref(true), mask)

    escapeIn(field)

    expect(close).not.toHaveBeenCalled()
  })

  it('takes an Escape with nothing focused as its own', () => {
    const mask = openMask()
    expect(isEscapeFor(escapeIn(document.body), mask)).toBe(true)
  })
})
