import { describe, it, expect, vi, afterEach } from 'vitest'
import { hasTouchKeyboard, submitOnEnter } from '@/utils/touch.js'

/** @param {boolean} coarse - Whether the main pointer is a finger */
const pointer = coarse =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(query => ({ matches: coarse && query === '(pointer: coarse)' }))
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hasTouchKeyboard', () => {
  it('is true where the main pointer is a finger', () => {
    pointer(true)
    expect(hasTouchKeyboard()).toBe(true)
  })

  it('is false with a mouse', () => {
    pointer(false)
    expect(hasTouchKeyboard()).toBe(false)
  })

  it('is false where nothing can say', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(hasTouchKeyboard()).toBe(false)
  })
})

describe('submitOnEnter', () => {
  it('submits, and keeps the Enter out of the field', () => {
    pointer(false)
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    const action = vi.fn()

    submitOnEnter(event, action)

    expect(action).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves the Enter to start a new line on a touch screen', () => {
    pointer(true)
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    const action = vi.fn()

    submitOnEnter(event, action)

    expect(action).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
