/* global KeyboardEvent, Event */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { isFocusKey, useFocusMode, useFocusModeKeys } from '@/composables/useFocusMode.js'

/** The focus key as it is off a Mac, which is what the tests run as. */
const FOCUS_KEY = { key: 'f', code: 'KeyF', ctrlKey: true, altKey: true }

/**
 * @param {Record<string, unknown>} init
 * @param {EventTarget} [target]
 */
const press = (init, target = document.body) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

/** The writer's frame, as far as focus mode is concerned. */
const mountFrame = () =>
  mount(
    defineComponent({
      setup() {
        useFocusModeKeys()
        return () => h('div')
      },
    }),
    { attachTo: document.body }
  )

/** What is full screen, as the page sees it. */
let fullScreen = null

const settle = () => new Promise(resolve => setTimeout(resolve))

describe('useFocusMode', () => {
  let frame
  const root = document.documentElement

  beforeEach(() => {
    fullScreen = null
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullScreen,
    })
    root.requestFullscreen = vi.fn(async () => {
      fullScreen = root
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    document.exitFullscreen = vi.fn(async () => {
      fullScreen = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    frame = mountFrame()
  })

  afterEach(() => {
    frame?.unmount()
    delete root.requestFullscreen
    delete document.exitFullscreen
    delete document.fullscreenElement
    document.body.innerHTML = ''
  })

  it('is Control-Alt-F off a Mac, and nothing near it', () => {
    const key = init => isFocusKey(new KeyboardEvent('keydown', init))
    expect(key(FOCUS_KEY)).toBe(true)
    expect(key({ ...FOCUS_KEY, key: 'F' })).toBe(true)
    expect(key({ ...FOCUS_KEY, shiftKey: true })).toBe(false)
    expect(key({ ...FOCUS_KEY, altKey: false })).toBe(false)
    expect(key({ ...FOCUS_KEY, ctrlKey: false, metaKey: true })).toBe(false)
    expect(key({ ...FOCUS_KEY, key: 'g', code: 'KeyG' })).toBe(false)
  })

  it('is not AltGr with that key where it types a character', () => {
    expect(isFocusKey(new KeyboardEvent('keydown', { ...FOCUS_KEY, key: '[' }))).toBe(false)
  })

  it('is Option-Command-F on a Mac, whatever character Option makes of it', async () => {
    vi.resetModules()
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' })
    try {
      const mac = await import('@/composables/useFocusMode.js')
      const key = init => mac.isFocusKey(new KeyboardEvent('keydown', init))
      const optionCommand = { key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true }

      expect(key(optionCommand)).toBe(true)
      expect(key({ ...optionCommand, key: 'f' })).toBe(true)
      expect(key(FOCUS_KEY)).toBe(false)
      expect(key({ ...optionCommand, shiftKey: true })).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('goes in and out on the key, which it takes from the browser', () => {
    const { focused } = useFocusMode()

    expect(press(FOCUS_KEY).defaultPrevented).toBe(true)
    expect(focused.value).toBe(true)

    press(FOCUS_KEY)
    expect(focused.value).toBe(false)
  })

  it('leaves the key to whatever took it first', () => {
    const field = document.createElement('input')
    document.body.append(field)
    field.addEventListener('keydown', event => event.preventDefault())

    press(FOCUS_KEY, field)

    expect(useFocusMode().focused.value).toBe(false)
  })

  it('comes out on Escape', () => {
    const { enter, focused } = useFocusMode()
    enter()

    expect(press({ key: 'Escape' }).defaultPrevented).toBe(true)
    expect(focused.value).toBe(false)
  })

  it('comes out on an Escape the editor marked handled, as it marks every one', () => {
    const { enter, focused } = useFocusMode()
    enter()
    const page = document.createElement('div')
    page.contentEditable = 'true'
    document.body.append(page)
    page.addEventListener('keydown', event => event.preventDefault())

    press({ key: 'Escape' }, page)

    expect(focused.value).toBe(false)
  })

  it('stays for an Escape something else stopped: the find, a link being written', () => {
    const { enter, focused } = useFocusMode()
    enter()
    const field = document.createElement('input')
    document.body.append(field)
    field.addEventListener('keydown', event => event.stopPropagation())

    press({ key: 'Escape' }, field)

    expect(focused.value).toBe(true)
  })

  it('stays for an Escape pressed in a menu, which closes instead', () => {
    const { enter, focused } = useFocusMode()
    enter()
    const menu = document.createElement('ul')
    menu.setAttribute('role', 'menu')
    const item = document.createElement('li')
    menu.append(item)
    document.body.append(menu)

    press({ key: 'Escape' }, item)

    expect(focused.value).toBe(true)
  })

  it('stays for an Escape that closes a dialog over it', () => {
    const { enter, focused } = useFocusMode()
    enter()
    const mask = document.createElement('div')
    mask.className = 'p-dialog-mask'
    document.body.append(mask)

    press({ key: 'Escape' })

    expect(focused.value).toBe(true)
  })

  it('leaves Escape alone out of focus mode', () => {
    expect(press({ key: 'Escape' }).defaultPrevented).toBe(false)
  })

  it('goes full screen, and back', async () => {
    const { enter, leave } = useFocusMode()

    enter()
    await settle()
    expect(root.requestFullscreen).toHaveBeenCalledTimes(1)
    expect(document.fullscreenElement).toBe(root)

    leave()
    await settle()
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1)
    expect(document.fullscreenElement).toBe(null)
  })

  it('asks for Escape while full screen, where the browser keeps it otherwise, and lets it go', async () => {
    const lock = vi.fn(async () => {})
    const unlock = vi.fn()
    Object.defineProperty(navigator, 'keyboard', { configurable: true, value: { lock, unlock } })
    try {
      const { enter, leave } = useFocusMode()
      enter()
      await settle()
      expect(lock).toHaveBeenCalledWith(['Escape'])

      leave()
      expect(unlock).toHaveBeenCalled()
    } finally {
      delete navigator.keyboard
    }
  })

  it('comes out when full screen is left some other way', async () => {
    const { enter, focused } = useFocusMode()
    enter()
    await settle()

    await document.exitFullscreen()

    expect(focused.value).toBe(false)
  })

  it('leaves a page that was full screen already as it was', async () => {
    fullScreen = document.body
    const { enter, leave, focused } = useFocusMode()

    enter()
    await settle()
    expect(root.requestFullscreen).not.toHaveBeenCalled()
    expect(focused.value).toBe(true)

    leave()
    expect(document.exitFullscreen).not.toHaveBeenCalled()
    expect(fullScreen).toBe(document.body)
  })

  it('fills the window where full screen is refused, or there is none', async () => {
    root.requestFullscreen = vi.fn(async () => {
      throw new Error('Permissions check failed')
    })
    const { enter, leave, focused } = useFocusMode()

    enter()
    await settle()
    expect(focused.value).toBe(true)
    leave()

    delete root.requestFullscreen
    enter()
    expect(focused.value).toBe(true)
    leave()
    expect(document.exitFullscreen).not.toHaveBeenCalled()
  })

  it('leaves full screen when focus mode ended before the page got there', async () => {
    const { enter, leave, focused } = useFocusMode()

    enter()
    leave()
    await settle()

    expect(focused.value).toBe(false)
    expect(document.fullscreenElement).toBe(null)
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('ends with the frame, and stops listening', async () => {
    const { enter, focused } = useFocusMode()
    enter()
    await settle()

    frame.unmount()
    frame = null

    expect(focused.value).toBe(false)
    expect(document.fullscreenElement).toBe(null)
    press(FOCUS_KEY)
    expect(focused.value).toBe(false)
  })
})
