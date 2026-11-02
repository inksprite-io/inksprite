/**
 * @module composables/useHoverSubmenus
 * @description A TieredMenu's submenus opening as the pointer reaches them.
 *
 * PrimeVue's TieredMenu opens a submenu on a click, and on hover only after
 * one has been opened that way. It remembers that in its `dirty` flag and
 * forgets it as the menu closes, with no option for starting without it, so
 * the flag is kept set here.
 *
 * Two more things then go wrong, and are put right through the menu's
 * pass-through, which reaches each item:
 *
 * - A submenu goes the moment the pointer is on another item, and a straight
 *   line to something low in a submenu crosses the items under the one it
 *   opened from. So the menu hears of a pointer on an item only once it has
 *   rested there.
 * - A click on an item shuts its submenu if it is open, and now the pointer
 *   has opened it on the way to the click. A click from habit would see it go,
 *   so that click is stopped short of the menu.
 *
 * A finger has no hover. A tap sends the mouse events and then the click, so
 * where the main pointer cannot hover the menu is left as it is. In a narrow
 * window a submenu opens inline and the menu goes by clicks alone, so there a
 * click still shuts it.
 */

import { onBeforeUnmount, watch } from 'vue'

/** How long the pointer rests on an item before the menu hears of it, in ms. */
const REST = 200

/** TieredMenu's default breakpoint, under which its submenus open inline. */
const INLINE = '(max-width: 960px)'

/** What an item with its submenu open does with a click: nothing. */
const keepsOpen = {
  /** @param {Event} event */
  onClickCapture: event => event.stopImmediatePropagation(),
}

/**
 * @param {import('vue').Ref<any>} menu - The TieredMenu's template ref
 * @returns {Object} Pass-through for the menu to take
 */
export function useHoverSubmenus(menu) {
  if (!window.matchMedia?.('(hover: hover)').matches) return {}

  watch(menu, instance => {
    instance?.$watch(
      'dirty',
      (/** @type {boolean} */ dirty) => {
        if (!dirty) instance.dirty = true
      },
      { immediate: true }
    )
  })

  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer
  /** The events sent once the pointer has rested, which go on to the menu. */
  const rested = new WeakSet()

  /** @param {MouseEvent} event */
  const onMouseenterCapture = event => {
    if (rested.has(event)) return
    event.stopImmediatePropagation()
    clearTimeout(timer)
    const item = /** @type {HTMLElement} */ (event.currentTarget)
    timer = setTimeout(() => {
      if (!menu.value?.visible) return
      const again = new window.MouseEvent('mouseenter')
      rested.add(again)
      item.dispatchEvent(again)
    }, REST)
  }
  const onMouseleave = () => clearTimeout(timer)
  onBeforeUnmount(onMouseleave)

  return {
    itemContent: (/** @type {{context: {active: boolean}}} */ { context }) => ({
      onMouseenterCapture,
      onMouseleave,
      ...(context.active && !window.matchMedia(INLINE).matches ? keepsOpen : {}),
    }),
  }
}
