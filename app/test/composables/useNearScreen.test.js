import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useNearScreen } from '@/composables/useNearScreen.js'

/** A stand-in observer the test drives by hand. */
class Observer {
  /** @type {Observer[]} */
  static made = []
  /** @param {Function} callback @param {object} options */
  constructor(callback, options) {
    this.callback = callback
    this.options = options
    this.observed = new Set()
    this.disconnected = false
    Observer.made.push(this)
  }
  /** @param {Element} el */
  observe(el) {
    this.observed.add(el)
  }
  /** @param {Element} el */
  unobserve(el) {
    this.observed.delete(el)
  }
  disconnect() {
    this.disconnected = true
  }
  /** @param {Element} target @param {boolean} isIntersecting */
  report(target, isIntersecting) {
    this.callback([{ target, isIntersecting }])
  }
}

/** @param {any} directive @param {Element} el @param {string} value */
const mount = (directive, el, value) => directive.mounted(el, { value })

describe('useNearScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Observer.made = []
  })

  it('counts every row near where the browser cannot say', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { isNear, vNear } = effectScope().run(() => useNearScreen())
    mount(vNear, document.createElement('div'), 'a')
    expect(isNear('a')).toBe(true)
    expect(isNear('never seen')).toBe(true)
  })

  it('counts a row near only while it is reported on the screen', () => {
    vi.stubGlobal('IntersectionObserver', Observer)
    const { isNear, vNear } = effectScope().run(() => useNearScreen())
    const a = document.createElement('div')
    const b = document.createElement('div')
    mount(vNear, a, 'a')
    mount(vNear, b, 'b')
    expect(isNear('a')).toBe(false)

    const [observer] = Observer.made
    observer.report(a, true)
    expect(isNear('a')).toBe(true)
    expect(isNear('b')).toBe(false)

    observer.report(a, false)
    expect(isNear('a')).toBe(false)
  })

  it('keeps a row near while its blank gives way to the row itself', () => {
    vi.stubGlobal('IntersectionObserver', Observer)
    const { isNear, vNear } = effectScope().run(() => useNearScreen())
    const blank = document.createElement('div')
    mount(vNear, blank, 'a')
    const [observer] = Observer.made
    observer.report(blank, true)

    const row = document.createElement('div')
    const directive = /** @type {any} */ (vNear)
    directive.unmounted(blank)
    mount(vNear, row, 'a')
    expect(isNear('a')).toBe(true)
    expect(observer.observed.has(blank)).toBe(false)
    expect(observer.observed.has(row)).toBe(true)
  })

  it('watches within the box that scrolls, a margin past its ends', () => {
    vi.stubGlobal('IntersectionObserver', Observer)
    const box = document.createElement('div')
    const row = document.createElement('div')
    box.append(row)
    const { vNear } = effectScope().run(() =>
      useNearScreen({ root: el => el.parentElement, margin: 100 })
    )
    mount(vNear, row, 'a')
    expect(Observer.made[0].options).toEqual({ root: box, rootMargin: '100px 0px' })
  })

  it('stops watching when its scope ends', () => {
    vi.stubGlobal('IntersectionObserver', Observer)
    const scope = effectScope()
    const { vNear } = scope.run(() => useNearScreen())
    mount(vNear, document.createElement('div'), 'a')
    scope.stop()
    expect(Observer.made[0].disconnected).toBe(true)
  })
})
