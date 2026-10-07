/**
 * @module composables/useLongPress
 * @description A finger held still on something, for what a right-click opens
 * everywhere else.
 *
 * A phone has no right-click, and iOS fires no `contextmenu` for a long press,
 * so the press is timed here. It is a press only while the finger stays put: a
 * finger that moves first is scrolling, and is left to.
 *
 * A finger that moves once the press has been taken is dragging what it is on,
 * which a held finger also starts in the outline, so whatever the press opened
 * is told to close again. A finger lifted after a press is not a tap: the
 * click that would follow is cancelled, so the row it was on does not open as
 * the menu does.
 */

import { onBeforeUnmount } from 'vue'

/** How long a finger has to stay down to be a long press. iOS takes about this long. */
export const LONG_PRESS_MS = 500

/** How far a finger can wander, in pixels, and still be held still. */
const SLOP = 10

/**
 * @typedef {Object} LongPressHandlers
 * @property {(event: TouchEvent) => void} touchstart
 * @property {(event: TouchEvent) => void} touchmove
 * @property {(event: TouchEvent) => void} touchend - For touchcancel too
 */

/**
 * @param {(at: {x: number, y: number}) => void} onPress - Where the finger is,
 *   in the viewport's coordinates
 * @param {() => void} [onMoveAfter] - The finger moved after the press was taken
 * @returns {LongPressHandlers}
 */
export function useLongPress(onPress, onMoveAfter = () => {}) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer
  /** Where the finger went down, while it is still a press. */
  /** @type {{x: number, y: number}|null} */
  let start = null
  /** Whether the press was taken. */
  let pressed = false

  const wait = () => {
    clearTimeout(timer)
    timer = undefined
  }

  /** @param {TouchEvent} event */
  const touchstart = event => {
    wait()
    pressed = false
    start = null
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    const at = { x: touch.clientX, y: touch.clientY }
    start = at
    timer = setTimeout(() => {
      timer = undefined
      pressed = true
      onPress(at)
    }, LONG_PRESS_MS)
  }

  /** @param {TouchEvent} event */
  const touchmove = event => {
    const touch = event.touches[0]
    if (!start || !touch) return
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) < SLOP) return
    wait()
    start = null
    if (pressed) onMoveAfter()
  }

  /** @param {TouchEvent} event */
  const touchend = event => {
    wait()
    start = null
    if (!pressed) return
    pressed = false
    if (event.cancelable) event.preventDefault()
  }

  onBeforeUnmount(wait)

  return { touchstart, touchmove, touchend }
}
