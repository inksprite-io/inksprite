/**
 * @module composables/usePagePress
 * @description Whether the pointer is held down from a press that began in
 * the page.
 *
 * A frame set into the page takes the pointer while it is over it, and the
 * page hears nothing of it there: not that it moved, and not that it was let
 * go. So a drag that starts in the page, a panel's edge above all, stops
 * dead as it crosses onto a terminal's frame, and is still thought held when
 * it is let go there. While a press that began in the page is held, a frame
 * steps out of the pointer's way (`TerminalFrame`).
 *
 * A press in the frame itself is the frame's, and nothing here hears of it.
 */
import { readonly, ref } from 'vue'

const held = ref(false)
let listening = false

const release = () => {
  held.value = false
}

/** Listen for the page's presses, once, for as long as the page is there. */
function listen() {
  if (listening || typeof document === 'undefined') return
  listening = true
  // The button that drags: a press of another opens a menu, and its release
  // may go to the menu.
  document.addEventListener(
    'pointerdown',
    event => {
      if (event.button === 0) held.value = true
    },
    true
  )
  document.addEventListener('pointerup', release, true)
  document.addEventListener('pointercancel', release, true)
  // A release the page never heard of, over another window or under a menu
  // of the system's: the pointer moving with nothing held says so.
  document.addEventListener(
    'pointermove',
    event => {
      if (held.value && event.buttons === 0) release()
    },
    true
  )
  window.addEventListener('blur', release)
}

/**
 * Whether a press that began in the page is still held.
 *
 * @returns {Readonly<import('vue').Ref<boolean>>}
 */
export function usePagePress() {
  listen()
  return readonly(held)
}
