import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useMessageField } from '../../src/composables/useMessageField.js'

/** What one row of the field is tall, and what each line of draft adds. */
const ROW = 40
const LINE = 24

/**
 * A field in a row, with the layout the test environment does not do stood
 * in for: the field is as tall as one row, and its draft is as many lines as
 * the test says. Every reading of its height is recorded with the styles it
 * was taken under, which is how a test sees where a measurement was made.
 */
const lay = () => {
  const lines = ref(1)
  const over = ref(0)
  const readings = []
  const beside = ref(null)

  const Host = defineComponent({
    setup() {
      const field = ref(null)
      const row = ref(null)
      const draft = ref('')
      const fitted = useMessageField(field, row, draft)
      beside.value = fitted.beside
      return { field, row, draft }
    },
    render() {
      return h('div', { ref: 'row' }, [h('textarea', { ref: 'field' })])
    },
  })

  const wrapper = mount(Host)
  const row = wrapper.element
  const field = wrapper.find('textarea').element

  Object.defineProperty(field, 'offsetParent', { value: row, configurable: true })
  Object.defineProperty(field, 'clientHeight', { get: () => ROW })
  Object.defineProperty(field, 'scrollHeight', {
    get: () => {
      readings.push({
        wrap: row.style.flexWrap,
        basis: field.style.flexBasis,
        height: field.style.height,
      })
      return ROW + LINE * (lines.value - 1) + over.value
    },
  })

  /** Write a draft that runs to this many lines beside the buttons. */
  const write = async (count, extra = 0) => {
    lines.value = count
    over.value = extra
    wrapper.vm.draft = 'x'.repeat(count)
    await nextTick()
  }

  return {
    row,
    field,
    readings,
    write,
    beside: () => beside.value.value,
    unlay: () => Object.defineProperty(field, 'offsetParent', { value: null }),
  }
}

describe('useMessageField', () => {
  it('keeps the buttons beside a draft that fits on one line', async () => {
    const laid = lay()
    await laid.write(1)

    expect(laid.beside()).toBe(true)
    expect(laid.field.style.height).toBe(`${ROW}px`)
  })

  it('drops the buttons under a draft that runs past the line', async () => {
    const laid = lay()
    await laid.write(2)

    expect(laid.beside()).toBe(false)
    expect(laid.field.style.height).toBe(`${ROW + LINE}px`)
  })

  it('brings the buttons back when the draft fits again', async () => {
    const laid = lay()
    await laid.write(2)
    await laid.write(1)

    expect(laid.beside()).toBe(true)
  })

  it('measures beside the buttons, however the row is laid out', async () => {
    const laid = lay()
    await laid.write(2)

    // Taken with nothing wrapping and the field at its one-row height...
    const measured = laid.readings.find(reading => reading.wrap === 'nowrap')
    expect(measured).toBeDefined()
    expect(parseFloat(measured.basis)).toBe(0)
    expect(measured.height).toBe('auto')
    // ...and the row given back as it was.
    expect(laid.row.style.flexWrap).toBe('')
    expect(laid.field.style.flexBasis).toBe('')
  })

  it('forgives the pixel a fractional line height leaves', async () => {
    const laid = lay()
    await laid.write(1, 1)

    expect(laid.beside()).toBe(true)
  })

  it('leaves a field that is not laid out alone', async () => {
    const laid = lay()
    laid.unlay()
    await laid.write(2)

    expect(laid.beside()).toBe(true)
    expect(laid.field.style.height).toBe('')
  })

  it('fits at once when first laid out, and once a run of resizes settles after', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] })
    const Real = window.ResizeObserver
    /** @type {Function[]} */
    const callbacks = []
    window.ResizeObserver = class {
      constructor(callback) {
        callbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    }
    try {
      const { readings } = lay()
      await nextTick()
      const resized = () => callbacks.forEach(callback => callback([], null))
      const fits = () => readings.filter(reading => reading.height === 'auto').length

      // The first callback sizes the field to the draft waiting in it.
      resized()
      vi.advanceTimersByTime(16)
      const first = fits()
      expect(first).toBeGreaterThan(0)

      // A panel's edge being dragged resizes the field every frame. Fitting
      // on each meant laying the page out on each, which is the stutter.
      for (let i = 0; i < 6; i++) {
        resized()
        vi.advanceTimersByTime(16)
      }
      expect(fits()).toBe(first)

      vi.advanceTimersByTime(100)
      expect(fits()).toBe(first * 2)
    } finally {
      window.ResizeObserver = Real
      vi.useRealTimers()
    }
  })
})
