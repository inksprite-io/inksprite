/* global KeyboardEvent, PointerEvent */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { isFindKey, useFindKey } from '@/composables/useFindKey.js'

/** The find key as it is off a Mac, which is what the tests run as. */
const press = (target, init = {}) => {
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

/** A focusable box around a panel, as the split around the chat is, and something beside it. */
const layout = (open = vi.fn(() => true)) => {
  const Panel = defineComponent({
    setup() {
      const root = ref(null)
      useFindKey(() => root.value, open)
      return () =>
        h('div', { tabindex: -1, 'data-around': '' }, [
          h('div', { ref: root, 'data-panel': '' }, [
            h('p', { 'data-text': '' }, 'Words'),
            h('input', { 'data-field': '' }),
          ]),
        ])
    },
  })
  const wrapper = mount(
    { render: () => h('div', [h(Panel), h('input', { 'data-outside': '' })]) },
    { attachTo: document.body }
  )
  const at = selector => wrapper.find(selector).element
  return { wrapper, open, at }
}

/** A click or a touch on something, before the key. */
const pointAt = element => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

describe('useFindKey', () => {
  let mounted
  afterEach(() => mounted?.wrapper.unmount())

  it('is the browser’s own find key, and nothing near it', () => {
    expect(isFindKey(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))).toBe(true)
    expect(isFindKey(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true }))).toBe(true)
    expect(
      isFindKey(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true }))
    ).toBe(false)
    expect(isFindKey(new KeyboardEvent('keydown', { key: 'f', metaKey: true }))).toBe(false)
    expect(isFindKey(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true }))).toBe(false)
  })

  it('opens the find of the panel the focus is in, and takes the key from the browser', () => {
    mounted = layout()
    mounted.at('[data-field]').focus()

    const event = press(mounted.at('[data-field]'))

    expect(mounted.open).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves the key to the browser with the focus elsewhere', () => {
    mounted = layout()
    pointAt(mounted.at('[data-text]'))
    mounted.at('[data-outside]').focus()

    const event = press(mounted.at('[data-outside]'))

    expect(mounted.open).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('goes by what was last clicked when the focus is on something around the panel', () => {
    mounted = layout()
    pointAt(mounted.at('[data-text]'))
    mounted.at('[data-around]').focus()

    press(mounted.at('[data-around]'))

    expect(mounted.open).toHaveBeenCalledOnce()
  })

  it('leaves the key to the browser when the panel has no find to open', () => {
    mounted = layout(vi.fn(() => false))
    mounted.at('[data-field]').focus()

    expect(press(mounted.at('[data-field]')).defaultPrevented).toBe(false)
  })
})
