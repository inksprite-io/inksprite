// A chat, a turn and a message stand in here for Chat, ChatTurn and ChatMessage,
// which the composable is shared between.
/* eslint-disable vue/one-component-per-file */
/* global Event */
/* global Element */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  BASE_HEIGHT,
  LINE_HEIGHT,
  holdTurnWhile,
  useNearTurns,
  useTurnHolder,
  useTurnState,
} from '../../src/composables/useNearTurns.js'

/** The observers the page made, so a test can say what they would have seen. */
let intersections = []
let resizes = []

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback
    this.options = options
    this.targets = new Set()
    intersections.push(this)
  }
  observe(el) {
    this.targets.add(el)
  }
  unobserve(el) {
    this.targets.delete(el)
  }
  disconnect() {
    this.targets.clear()
  }
}

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback
    this.targets = new Set()
    resizes.push(this)
  }
  observe(el) {
    this.targets.add(el)
  }
  unobserve(el) {
    this.targets.delete(el)
  }
  disconnect() {
    this.targets.clear()
  }
}

const saved = {}

beforeEach(() => {
  intersections = []
  resizes = []
  saved.io = window.IntersectionObserver
  saved.ro = window.ResizeObserver
  window.IntersectionObserver = FakeIntersectionObserver
  window.ResizeObserver = FakeResizeObserver
  globalThis.IntersectionObserver = FakeIntersectionObserver
  globalThis.ResizeObserver = FakeResizeObserver
})

afterEach(() => {
  window.IntersectionObserver = saved.io
  window.ResizeObserver = saved.ro
  globalThis.IntersectionObserver = saved.io
  globalThis.ResizeObserver = saved.ro
})

/** A turn's body: says which turn it is, and can open an editor that holds it. */
const Body = defineComponent({
  props: { id: { type: String, required: true } },
  setup(props) {
    const editing = ref(false)
    const open = useTurnState(`${props.id}:open`, false)
    holdTurnWhile(editing)
    return () =>
      h('div', {
        'data-body': props.id,
        'data-open': String(open.value),
        onEdit: () => (editing.value = !editing.value),
        onToggle: () => (open.value = !open.value),
      })
  },
})

/** The turn, which lets what is in it hold it. */
const Turn = defineComponent({
  props: { id: { type: String, required: true } },
  setup(props) {
    useTurnHolder(() => props.id)
    return () => h(Body, { id: props.id })
  },
})

/**
 * A chat of `count` turns laid out the way Chat.vue lays them out.
 * @param {number} count
 * @param {import('vue').Ref<string|null>} [kept]
 * @param {boolean} [attach] - Into the document, for a test that needs it connected
 * @param {Record<string, string>} [texts] - What some of the turns say; the rest say nothing
 */
const chat = (count, kept = ref(null), attach = false, texts = {}) => {
  const turns = ref(
    Array.from({ length: count }, (_, i) => ({
      id: `t${i}`,
      messages: [{ id: `m${i}`, content: texts[`t${i}`] || '' }],
    }))
  )
  const Host = defineComponent({
    setup() {
      const root = ref(null)
      const near = useNearTurns(
        () => root.value,
        turns,
        () => [kept.value]
      )
      return () =>
        h('div', { ref: root }, [
          h(
            'div',
            { 'data-container': '' },
            turns.value.map(turn =>
              h(
                'div',
                {
                  key: turn.id,
                  ref: el => near.track(turn.id, el),
                  'data-turn': turn.id,
                  style: near.isMounted(turn.id)
                    ? undefined
                    : { height: `${near.heightOf(turn.id)}px` },
                },
                near.isMounted(turn.id) ? [h(Turn, { id: turn.id })] : []
              )
            )
          ),
        ])
    },
  })
  const wrapper = mount(Host, attach ? { attachTo: document.body } : {})
  return { wrapper, turns }
}

/** @param {import('@vue/test-utils').VueWrapper} wrapper */
const mounted = wrapper => wrapper.findAll('[data-body]').map(body => body.attributes('data-body'))

/** @param {import('@vue/test-utils').VueWrapper} wrapper @param {string} id */
const block = (wrapper, id) => wrapper.find(`[data-turn="${id}"]`)

/**
 * Say which turns the page now sees near the screen, and which it does not.
 * @param {import('@vue/test-utils').VueWrapper} wrapper
 * @param {Record<string, boolean>} seen
 */
const see = async (wrapper, seen) => {
  const observer = intersections[0]
  observer.callback(
    Object.entries(seen).map(([id, isIntersecting]) => ({
      target: block(wrapper, id).element,
      isIntersecting,
    }))
  )
  await nextTick()
}

/**
 * Say how tall the page has laid turns out.
 * @param {import('@vue/test-utils').VueWrapper} wrapper
 * @param {Record<string, number>} sizes
 * @param {number} [width] - How wide they are
 */
const measure = (wrapper, sizes, width = 400) => {
  resizes[0].callback(
    Object.entries(sizes).map(([id, height]) => ({
      target: block(wrapper, id).element,
      borderBoxSize: [{ blockSize: height }],
      contentRect: { height, width },
    }))
  )
}

describe('useNearTurns', () => {
  it('mounts every turn where the page cannot say what is near', () => {
    window.IntersectionObserver = undefined
    globalThis.IntersectionObserver = undefined
    const { wrapper } = chat(12)

    expect(mounted(wrapper)).toHaveLength(12)
  })

  it('opens onto the newest few, the rest standing at a guess', () => {
    const { wrapper } = chat(12)

    expect(mounted(wrapper)).toEqual(['t4', 't5', 't6', 't7', 't8', 't9', 't10', 't11'])
    expect(block(wrapper, 't0').attributes('style')).toContain(`height: ${BASE_HEIGHT}px`)
  })

  it('watches every turn from the scrolling element, a screen ahead either way', () => {
    const { wrapper } = chat(5)

    expect(intersections).toHaveLength(1)
    expect(intersections[0].options.root).toBe(wrapper.element)
    expect(intersections[0].options.rootMargin).toBe('100% 0px')
    expect(intersections[0].targets.size).toBe(5)
  })

  it('keeps only what is near once the page has said, and the newest two', async () => {
    const { wrapper } = chat(12)

    await see(wrapper, { t3: true, t4: true, t5: false, t9: false, t10: false, t11: false })

    expect(mounted(wrapper)).toEqual(['t3', 't4', 't10', 't11'])
  })

  it('lets a turn go at the height it last had', async () => {
    const { wrapper } = chat(12)
    await see(wrapper, { t3: true })
    measure(wrapper, { t3: 812 })

    await see(wrapper, { t3: false })

    expect(mounted(wrapper)).not.toContain('t3')
    expect(block(wrapper, 't3').attributes('style')).toContain('height: 812px')
  })

  it('does not take the height of a block for the height of its turn', async () => {
    const { wrapper } = chat(12)
    await see(wrapper, { t3: false })

    measure(wrapper, { t3: 55 })
    await nextTick()

    expect(block(wrapper, 't3').attributes('style')).toContain(`height: ${BASE_HEIGHT}px`)
  })

  it('keeps the turn the chat names, wherever it is', async () => {
    const kept = ref('t1')
    const { wrapper } = chat(12, kept)

    await see(wrapper, { t1: false })
    expect(mounted(wrapper)).toContain('t1')

    kept.value = null
    await nextTick()
    expect(mounted(wrapper)).not.toContain('t1')
  })

  it('keeps a turn with an editor open until it is closed', async () => {
    const { wrapper } = chat(12)
    await see(wrapper, { t3: true })
    await wrapper.find('[data-body="t3"]').trigger('edit')
    await nextTick()

    await see(wrapper, { t3: false })
    expect(mounted(wrapper)).toContain('t3')

    await wrapper.find('[data-body="t3"]').trigger('edit')
    await nextTick()
    expect(mounted(wrapper)).not.toContain('t3')
  })

  it('stops watching a turn that is gone', async () => {
    const { wrapper, turns } = chat(5)
    const gone = block(wrapper, 't0').element

    turns.value = turns.value.slice(1)
    await nextTick()

    expect(intersections[0].targets.has(gone)).toBe(false)
    expect(resizes[0].targets.has(gone)).toBe(false)
  })

  it('stops watching altogether when the chat closes', () => {
    const { wrapper } = chat(5)

    wrapper.unmount()

    expect(intersections[0].targets.size).toBe(0)
    expect(resizes[0].targets.size).toBe(0)
  })
})

describe('useNearTurns guessing heights', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  /** @param {import('@vue/test-utils').VueWrapper} wrapper @param {string} id */
  const standing = (wrapper, id) => block(wrapper, id).attributes('style')

  it('guesses a turn not measured yet from the lines its text takes', () => {
    // No width yet, so 640 pixels: 71 characters to a line. Two paragraphs, the
    // first two lines long, and the break between them.
    const { wrapper } = chat(12, ref(null), false, {
      t0: `${'x'.repeat(100)}\n\n${'y'.repeat(30)}`,
    })

    expect(standing(wrapper, 't0')).toContain(`height: ${BASE_HEIGHT + LINE_HEIGHT * 4}px`)
    expect(standing(wrapper, 't1')).toContain(`height: ${BASE_HEIGHT}px`)
  })

  it('fits the height of a line to the turns it has measured', async () => {
    // 400 pixels wide is 44 characters to a line: the newest two take two
    // lines each, and came to 40 pixels a line.
    const { wrapper } = chat(12, ref(null), false, {
      t0: 'w'.repeat(132),
      t10: 'z'.repeat(88),
      t11: 'z'.repeat(88),
    })
    measure(wrapper, { t10: BASE_HEIGHT + 80, t11: BASE_HEIGHT + 80 })
    vi.advanceTimersByTime(300)
    await nextTick()

    await see(wrapper, { t0: false })

    expect(standing(wrapper, 't0')).toContain(`height: ${BASE_HEIGHT + 40 * 3}px`)
  })

  it('makes the guesses again at a new width once it has held', async () => {
    const { wrapper } = chat(12, ref(null), false, { t0: 'w'.repeat(142) })
    expect(standing(wrapper, 't0')).toContain(`height: ${BASE_HEIGHT + LINE_HEIGHT * 2}px`)

    // Narrowed to 200 pixels, 22 characters to a line.
    measure(wrapper, { t0: 999 }, 200)
    await nextTick()
    expect(standing(wrapper, 't0')).toContain(`height: ${BASE_HEIGHT + LINE_HEIGHT * 2}px`)

    vi.advanceTimersByTime(300)
    await nextTick()
    expect(standing(wrapper, 't0')).toContain(`height: ${BASE_HEIGHT + LINE_HEIGHT * 7}px`)
  })

  it('keeps the height a turn was measured at over any guess', async () => {
    const { wrapper } = chat(12, ref(null), false, { t3: 'w'.repeat(500) })
    await see(wrapper, { t3: true })
    measure(wrapper, { t3: 333 })

    await see(wrapper, { t3: false })

    expect(standing(wrapper, 't3')).toContain('height: 333px')
  })
})

describe('useNearTurns keeping the view still', () => {
  /** How tall each turn is once it is mounted. */
  const real = { t3: 740, t8: 900 }
  let original

  // A layout of the chat's blocks, one under another in their container under
  // its top margin, in the scroller, which is 800 pixels tall and at the top of
  // the page: what happy-dom does not do.
  beforeEach(() => {
    original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      if (!this.hasAttribute('data-turn')) return { top: 0, bottom: 800, height: 800 }
      const container = this.parentElement
      const heightOf = el =>
        el.querySelector('[data-body]')
          ? real[el.dataset.turn] || 300
          : parseFloat(el.style.height) || 0
      let top = -container.parentElement.scrollTop + (parseFloat(container.style.marginTop) || 0)
      for (const el of container.children) {
        if (el === this) break
        top += heightOf(el)
      }
      const height = heightOf(this)
      return { top, bottom: top + height, height }
    }
  })

  afterEach(() => {
    Element.prototype.getBoundingClientRect = original
  })

  it('puts the turn being read back where it was when one above it comes in', async () => {
    const { wrapper } = chat(12, ref(null), true)
    await see(wrapper, { t3: false, t4: true, t5: true })
    // Six blocks down: t0 to t3 at the guess, t4 and t5 mounted at 300.
    wrapper.element.scrollTop = 4 * BASE_HEIGHT + 300 + 100
    const reading = block(wrapper, 't5').element.getBoundingClientRect().top

    await see(wrapper, { t3: true })
    await nextTick()

    expect(mounted(wrapper)).toContain('t3')
    expect(block(wrapper, 't5').element.getBoundingClientRect().top).toBe(reading)
    expect(wrapper.element.scrollTop).toBe(4 * BASE_HEIGHT + 300 + 100 + (740 - BASE_HEIGHT))
    wrapper.unmount()
  })

  it('leaves the scroll alone when what comes in is below what is being read', async () => {
    const { wrapper } = chat(12, ref(null), true)
    await see(wrapper, { t4: true, t5: true })
    wrapper.element.scrollTop = 4 * BASE_HEIGHT + 100

    await see(wrapper, { t8: true })
    await nextTick()

    expect(mounted(wrapper)).toContain('t8')
    expect(wrapper.element.scrollTop).toBe(4 * BASE_HEIGHT + 100)
    wrapper.unmount()
  })

  describe('while it is scrolled by touch', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    /** @param {import('@vue/test-utils').VueWrapper} wrapper @param {string} type */
    const fire = (wrapper, type) => wrapper.element.dispatchEvent(new Event(type))

    /** @param {import('@vue/test-utils').VueWrapper} wrapper */
    const container = wrapper => wrapper.find('[data-container]').element

    /** A chat scrolled to t5, with t3 above it about to come in. */
    const scrolled = async () => {
      const { wrapper } = chat(12, ref(null), true)
      await see(wrapper, { t3: false, t4: true, t5: true })
      wrapper.element.scrollTop = 4 * BASE_HEIGHT + 300 + 100
      return wrapper
    }

    it('shifts the turns rather than moving the scroll, which would stop it in iOS', async () => {
      const wrapper = await scrolled()
      const reading = block(wrapper, 't5').element.getBoundingClientRect().top

      fire(wrapper, 'touchstart')
      await see(wrapper, { t3: true })
      await nextTick()

      expect(block(wrapper, 't5').element.getBoundingClientRect().top).toBe(reading)
      expect(wrapper.element.scrollTop).toBe(4 * BASE_HEIGHT + 300 + 100)
      expect(container(wrapper).style.marginTop).toBe(`${-(740 - BASE_HEIGHT)}px`)
      wrapper.unmount()
    })

    it('keeps the shift while it coasts, and takes it into the scroll once it is still', async () => {
      const wrapper = await scrolled()
      fire(wrapper, 'touchstart')
      await see(wrapper, { t3: true })
      await nextTick()
      const reading = block(wrapper, 't5').element.getBoundingClientRect().top

      fire(wrapper, 'touchend')
      vi.advanceTimersByTime(150)
      fire(wrapper, 'scroll')
      vi.advanceTimersByTime(150)
      expect(container(wrapper).style.marginTop).not.toBe('')

      vi.advanceTimersByTime(100)
      expect(container(wrapper).style.marginTop).toBe('')
      expect(wrapper.element.scrollTop).toBe(4 * BASE_HEIGHT + 300 + 100 + (740 - BASE_HEIGHT))
      expect(block(wrapper, 't5').element.getBoundingClientRect().top).toBe(reading)
      wrapper.unmount()
    })

    it('keeps the shift for as long as a finger is on the panel', async () => {
      const wrapper = await scrolled()
      fire(wrapper, 'touchstart')
      await see(wrapper, { t3: true })
      await nextTick()

      vi.advanceTimersByTime(1000)

      expect(container(wrapper).style.marginTop).not.toBe('')
      wrapper.unmount()
    })

    it('moves the scroll again once the touch is over', async () => {
      const wrapper = await scrolled()
      fire(wrapper, 'touchstart')
      fire(wrapper, 'touchend')
      vi.advanceTimersByTime(250)

      await see(wrapper, { t3: true })
      await nextTick()

      expect(container(wrapper).style.marginTop).toBe('')
      expect(wrapper.element.scrollTop).toBe(4 * BASE_HEIGHT + 300 + 100 + (740 - BASE_HEIGHT))
      wrapper.unmount()
    })
  })
})

describe('useTurnState', () => {
  it('comes back as it was left when the turn comes back', async () => {
    const { wrapper } = chat(12)
    await see(wrapper, { t3: true })
    await wrapper.find('[data-body="t3"]').trigger('toggle')
    await nextTick()

    await see(wrapper, { t3: false })
    await see(wrapper, { t3: true })

    expect(wrapper.find('[data-body="t3"]').attributes('data-open')).toBe('true')
  })

  it('is each turn’s own', async () => {
    const { wrapper } = chat(12)
    await wrapper.find('[data-body="t10"]').trigger('toggle')
    await nextTick()

    expect(wrapper.find('[data-body="t11"]').attributes('data-open')).toBe('false')
  })

  it('is the component’s own outside a chat', async () => {
    const first = mount(Body, { props: { id: 'x' } })
    await first.find('[data-body]').trigger('toggle')
    const second = mount(Body, { props: { id: 'x' } })

    expect(first.find('[data-body]').attributes('data-open')).toBe('true')
    expect(second.find('[data-body]').attributes('data-open')).toBe('false')
  })
})
