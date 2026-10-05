/**
 * @module composables/useNearTurns
 * @description Which of a chat's turns are in the page.
 *
 * A long chat mounted whole costs what all of it costs. One of 781 messages came
 * to over eight thousand components and a few hundred megabytes, for a panel
 * that shows three or four turns at a time. So a turn is mounted only while it
 * is near: within a screen of what can be seen, either way. Further off it
 * stands as an empty block at the height it last had, so the scroll is as long
 * as it would be and nothing moves when a turn comes or goes.
 *
 * A turn that has not been near yet stands at a guess, so that the scrollbar
 * says where in the chat the writer is before they have been through it: the
 * lines its text takes at the column's width, at the height a line comes to in
 * the turns measured so far, over what a turn takes besides its text. Against
 * a long chat at two widths, guessed from the newest few turns, the whole came
 * within a few percent; a flat guess was three quarters short. When a guess
 * above what is on screen is replaced by the real thing, or the guesses change,
 * the turn the writer is reading is put back where it was. Chromium does that itself, as scroll anchoring. WebKit anchors when
 * something above changes size but not when something is put into it, which is
 * what mounting a turn is, and without this the chat jumped on nearly every
 * step of scrolling up through a long one there.
 *
 * Some turns stay whatever: the newest two, which are what was just sent and
 * the reply to it, where the writer is looking and where the chat takes them;
 * whatever the chat names in `keep`, such as a summary being written; and a
 * turn with an editor open in it, so that going to look something up does not
 * throw away what was being typed. Until the page has said which turns are
 * near, the newest few are mounted, so that a chat opens onto its end drawn.
 *
 * A turn let go loses what its components held, so what the writer opened in
 * one — its reasoning, its tool calls, the raw text — is kept by the chat
 * instead, with `useTurnState`.
 *
 * Without IntersectionObserver — under test — every turn is mounted.
 */

/* global IntersectionObserver */
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { textLines } from '@/utils/turns.js'

/** How far off screen a turn is mounted ahead of time: one screen either way. */
const AHEAD = '100% 0px'

/** What a turn takes besides its text: its header, its padding and border. */
export const BASE_HEIGHT = 80

/** The height of a line of text until turns at this width have been measured: the chat's prose. */
export const LINE_HEIGHT = 28

/** How much of the turn's width a character of its text takes, on average. */
export const CHARACTER_WIDTH = 9

/** The width taken until the turns have one. */
const UNKNOWN_WIDTH = 640

/** How long a change of width has to hold before the guesses are made again at it. */
const SETTLE_MS = 250

/** How many of the newest turns stay mounted wherever the writer is. */
const NEWEST = 2

/** How many of the newest turns are mounted before the page has said which are near. */
const OPENING = 8

/** @type {import('vue').InjectionKey<(id: string, on: boolean) => void>} */
const HOLD = Symbol('hold a turn')

/** @type {import('vue').InjectionKey<(on: boolean) => void>} */
const HOLD_THIS = Symbol('hold this turn')

/** @type {import('vue').InjectionKey<Map<string, unknown>>} */
const STATE = Symbol('turn state')

/**
 * @typedef {Object} TurnLike
 * @property {string} id
 * @property {{id: string, content?: string}[]} [messages] - What it says, to guess its height from
 */

/**
 * @param {() => HTMLElement|null} scroller - The element that scrolls, asked
 *   for once the chat is mounted
 * @param {import('vue').Ref<TurnLike[]>} turns - The chat's turns, in order
 * @param {() => string|null} [keep] - A turn to keep mounted besides the rest
 */
export function useNearTurns(scroller, turns, keep = () => null) {
  const watching =
    typeof IntersectionObserver !== 'undefined' && typeof ResizeObserver !== 'undefined'

  /** @type {import('vue').ShallowRef<Set<string>>} */
  const near = shallowRef(new Set())
  /** How many editors are open in each turn that has any. */
  /** @type {import('vue').ShallowRef<Map<string, number>>} */
  const held = shallowRef(new Map())
  /** Whether the page has said which turns are near yet. */
  const reported = ref(false)

  /** The height each turn had when it was last mounted, and how wide it was then. */
  /** @type {Map<string, {height: number, width: number}>} */
  const measured = new Map()
  /** How wide the turns are. Zero until the page has said. */
  const width = shallowRef(0)
  /** How tall a line of their text comes to at that width. */
  const lineHeight = shallowRef(LINE_HEIGHT)
  /** The lines each message's text takes, until the text or the width changes. */
  /** @type {Map<string, {content: string, perLine: number, lines: number}>} */
  const lineCounts = new Map()
  /** @type {Map<string, Element>} */
  const elements = new Map()
  /** @type {WeakMap<Element, string>} */
  const ids = new WeakMap()

  /** @type {IntersectionObserver|null} */
  let intersect = null
  /** @type {ResizeObserver|null} */
  let resize = null

  const newest = computed(
    () => new Set(turns.value.slice(-(reported.value ? NEWEST : OPENING)).map(turn => turn.id))
  )

  /**
   * Whether the turn is in the page, rather than standing as a block.
   * @param {string} id
   */
  const isMounted = id =>
    !watching || near.value.has(id) || newest.value.has(id) || held.value.has(id) || keep() === id

  /** How many characters fit across a turn's text. */
  const perLine = () => Math.max(20, Math.floor((width.value || UNKNOWN_WIDTH) / CHARACTER_WIDTH))

  /**
   * The lines a turn's text takes, counted once for each message and width.
   * @param {TurnLike} turn
   * @param {number} chars
   */
  const linesOf = (turn, chars) => {
    let lines = 0
    for (const message of turn.messages || []) {
      const content = message.content || ''
      let known = lineCounts.get(message.id)
      if (!known || known.content !== content || known.perLine !== chars) {
        known = { content, perLine: chars, lines: textLines(content, chars) }
        lineCounts.set(message.id, known)
      }
      lines += known.lines
    }
    return lines
  }

  /** What each turn would stand at, had it not been measured. */
  const guesses = computed(() => {
    const chars = perLine()
    const line = lineHeight.value
    return new Map(
      turns.value.map(turn => [turn.id, Math.round(BASE_HEIGHT + line * linesOf(turn, chars))])
    )
  })

  /**
   * The height the turn stands at while it is not mounted.
   * @param {string} id
   */
  const heightOf = id => measured.get(id)?.height ?? guesses.value.get(id) ?? BASE_HEIGHT

  /**
   * Fit the height of a line to the turns measured at this width: what they came
   * to over what a turn takes besides its text, against the lines their text
   * takes. With none measured at this width it stays as it was.
   */
  const calibrate = () => {
    const chars = perLine()
    let over = 0
    let lines = 0
    for (const turn of turns.value) {
      const known = measured.get(turn.id)
      if (!known || Math.abs(known.width - width.value) > 1) continue
      over += Math.max(0, known.height - BASE_HEIGHT)
      lines += linesOf(turn, chars)
    }
    if (lines === 0) return
    const fitted = over / lines
    if (Math.abs(fitted - lineHeight.value) > lineHeight.value * 0.02) lineHeight.value = fitted
  }

  /**
   * The block a turn stands in, mounted or not. Wired to it as a function ref,
   * which Vue calls with the element on every render and with null once the
   * turn is gone.
   *
   * @param {string} id
   * @param {Element|null} el
   */
  const track = (id, el) => {
    const known = elements.get(id)
    if (known === el) return
    if (known) {
      intersect?.unobserve(known)
      resize?.unobserve(known)
    }
    if (!el) {
      elements.delete(id)
      measured.delete(id)
      return
    }
    elements.set(id, el)
    ids.set(el, id)
    intersect?.observe(el)
    resize?.observe(el)
  }

  /**
   * An editor opened or closed in a turn.
   * @param {string} id
   * @param {boolean} on
   */
  const hold = (id, on) => {
    const next = new Map(held.value)
    const count = (next.get(id) || 0) + (on ? 1 : -1)
    if (count > 0) next.set(id, count)
    else next.delete(id)
    held.value = next
  }

  provide(HOLD, hold)
  provide(STATE, reactive(new Map()))

  /**
   * The first turn on screen, and how far below the top of the scroller it is.
   * @param {Element} root
   * @returns {{el: Element, top: number}|null}
   */
  const onScreen = root => {
    const top = root.getBoundingClientRect().top
    const list = turns.value
    /** @type {Element|null} */
    let found = null
    let lo = 0
    let hi = list.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const el = elements.get(list[mid].id)
      if (!el) return null
      if (el.getBoundingClientRect().bottom > top) {
        found = el
        hi = mid - 1
      } else lo = mid + 1
    }
    return found && { el: found, top: found.getBoundingClientRect().top - top }
  }

  /**
   * Put that turn back where it was, if the browser has not. Called in the same
   * task as the change, once Vue has made it, so nothing the writer did can have
   * moved it in between: where it is now against where it was is what the change
   * did, and nothing else.
   *
   * @param {Element} root
   * @param {{el: Element, top: number}|null} was
   */
  const keepInPlace = (root, was) => {
    if (!was?.el.isConnected) return
    const moved = was.el.getBoundingClientRect().top - root.getBoundingClientRect().top - was.top
    if (Math.abs(moved) >= 1) root.scrollTop += moved
  }

  /**
   * Change what the turns stand at, keeping the one being read where it is.
   * @param {Element} root
   * @param {() => void} change
   */
  const rearrange = (root, change) => {
    const was = onScreen(root)
    change()
    nextTick(() => keepInPlace(root, was))
  }

  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let settling

  onMounted(() => {
    const root = scroller()
    if (!watching || !root) return

    intersect = new IntersectionObserver(
      entries => {
        const next = new Set(near.value)
        for (const entry of entries) {
          const id = ids.get(entry.target)
          if (id === undefined) continue
          if (entry.isIntersecting) next.add(id)
          else next.delete(id)
        }
        rearrange(root, () => {
          near.value = next
          reported.value = true
          calibrate()
        })
      },
      { root, rootMargin: AHEAD }
    )

    // Only a mounted turn's height is its own; a block's is whatever it was
    // given. A new width is taken once it has held, rather than on every frame
    // of dragging the panel's edge.
    resize = new ResizeObserver(entries => {
      let wide = width.value
      for (const entry of entries) {
        wide = entry.contentRect.width
        const id = ids.get(entry.target)
        if (id === undefined || !isMounted(id)) continue
        measured.set(id, {
          height: entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
          width: wide,
        })
      }
      if (Math.abs(wide - width.value) <= 1) return
      clearTimeout(settling)
      settling = setTimeout(() => {
        rearrange(root, () => {
          width.value = wide
          calibrate()
        })
      }, SETTLE_MS)
    })

    // The width the turns have now, so that the first guesses are made at it.
    const first = elements.values().next().value
    if (first) width.value = first.getBoundingClientRect().width

    for (const el of elements.values()) {
      intersect.observe(el)
      resize.observe(el)
    }
  })

  onBeforeUnmount(() => {
    intersect?.disconnect()
    resize?.disconnect()
    clearTimeout(settling)
  })

  return { isMounted, heightOf, track }
}

/**
 * Let what is inside a turn keep it mounted. Called by the turn, with its id.
 *
 * @param {() => string} id
 */
export function useTurnHolder(id) {
  const hold = inject(HOLD, null)
  provide(HOLD_THIS, on => hold?.(id(), on))
}

/**
 * Keep the turn this is in mounted while `active` is true: an editor, while it
 * is open.
 *
 * @param {import('vue').Ref<boolean>} active
 */
export function holdTurnWhile(active) {
  const hold = inject(HOLD_THIS, null)
  if (!hold) return

  let holding = false
  /** @param {boolean} on */
  const set = on => {
    if (on === holding) return
    holding = on
    hold(on)
  }
  watch(active, set, { immediate: true })
  onBeforeUnmount(() => set(false))
}

/**
 * State a turn's components keep for as long as the chat is open rather than
 * for as long as they are mounted: whether a panel is open, say. Outside a chat
 * it is the component's own, as a ref would be.
 *
 * @template T
 * @param {string} key - What it belongs to: a message id and what is open in it
 * @param {T} initial
 * @returns {import('vue').WritableComputedRef<T>}
 */
export function useTurnState(key, initial) {
  const values = inject(STATE, null) ?? reactive(new Map())
  return computed({
    get: () => /** @type {T} */ (values.has(key) ? values.get(key) : initial),
    set: value => {
      if (value === initial) values.delete(key)
      else values.set(key, value)
    },
  })
}
