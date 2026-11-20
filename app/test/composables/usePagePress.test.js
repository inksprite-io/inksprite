/* global Event, MouseEvent */
import { describe, it, expect, beforeEach } from 'vitest'
import { usePagePress } from '@/composables/usePagePress.js'

/** A pointer's event, from somewhere in the page. */
const pointer = (type, init = {}) =>
  document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }))

describe('usePagePress', () => {
  const held = usePagePress()

  beforeEach(() => {
    pointer('pointerup')
  })

  it('is held from a press in the page until it is let go', () => {
    expect(held.value).toBe(false)
    pointer('pointerdown')
    expect(held.value).toBe(true)
    pointer('pointermove', { buttons: 1 })
    expect(held.value).toBe(true)
    pointer('pointerup')
    expect(held.value).toBe(false)
  })

  it('is one and the same for everything that asks', () => {
    pointer('pointerdown')
    expect(usePagePress().value).toBe(true)
  })

  it('is let go when the press is called off, as when a drag of the system’s takes over', () => {
    pointer('pointerdown')
    pointer('pointercancel')
    expect(held.value).toBe(false)
  })

  it('is let go when the window loses the keys', () => {
    pointer('pointerdown')
    window.dispatchEvent(new Event('blur'))
    expect(held.value).toBe(false)
  })

  it('is let go by the pointer moving with nothing held, the release never having come', () => {
    pointer('pointerdown')
    pointer('pointermove', { buttons: 0 })
    expect(held.value).toBe(false)
  })

  it('is not held by a press of another button, whose release a menu may take', () => {
    pointer('pointerdown', { button: 2 })
    expect(held.value).toBe(false)
  })

  it('is left as it was by a click played whole', () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) pointer(type)
    expect(held.value).toBe(false)
  })
})
