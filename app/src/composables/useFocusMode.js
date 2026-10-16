/**
 * @module composables/useFocusMode
 * @description Focus mode: the document alone, filling the screen.
 *
 * Everything but the page goes: the rail, the sidebar, the chat, the strip
 * of tabs, and on a phone the tab bar. The page goes full screen as well,
 * where it can be: in a browser that lets it, and in the desktop app.
 *
 * Option-Command-F, or Control-Alt-F off a Mac, goes in and comes out, as
 * Scrivener's composition mode does. Escape comes out too, once nothing
 * else on the page has taken it, and so does leaving full screen whichever
 * way the writer leaves it. A browser full screen keeps Escape for itself,
 * so the find would stay open behind it; Chrome, Edge and the desktop app
 * let the page have it, and leave full screen on Escape held down instead.
 *
 * One state for the app: the writer's frame lays itself out by it, and the
 * editor panel drops its tabs.
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'

const isMac = /Mac|iP(hone|ad|od)/.test(
  (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || ''
)

/** Whether the writer is in focus mode. */
const focused = ref(false)

/**
 * Whether focus mode put the page in full screen, and so takes it out again.
 * A page already full screen when focus mode began is left as it was.
 */
let ownFullScreen = false

/**
 * Whether a key is the one for focus mode: Option-Command-F on a Mac,
 * Control-Alt-F elsewhere.
 *
 * Option changes the character a Mac reports, so there the key is also known
 * by where it is. Off a Mac it has to be an F: AltGr is Control-Alt to a
 * browser there, and on some keyboards types a character with that key.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isFocusKey(event) {
  if (event.shiftKey || !event.altKey) return false
  const f = event.key?.toLowerCase() === 'f'
  if (isMac) return event.metaKey && !event.ctrlKey && (f || event.code === 'KeyF')
  return event.ctrlKey && !event.metaKey && f
}

/**
 * The keyboard lock, which gives the page keys the browser would keep while it
 * is full screen. Chromium's alone, and not in the DOM's types yet.
 *
 * @returns {{lock?: (keys: string[]) => Promise<void>, unlock?: () => void}|undefined}
 */
const keyboard = () => /** @type {any} */ (navigator).keyboard

/** Go full screen, unless the page is already or cannot be. */
const goFullScreen = () => {
  const root = document.documentElement
  if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') return
  root
    .requestFullscreen()
    .then(() => {
      ownFullScreen = true
      // Left again before the page had gone.
      if (!focused.value) return leaveFullScreen()
      keyboard()
        ?.lock?.(['Escape'])
        .catch(() => {})
    })
    .catch(() => {
      // Refused, as a page in a frame is: focus mode still fills the window.
    })
}

/** Leave the full screen focus mode went into. */
const leaveFullScreen = () => {
  if (!ownFullScreen) return
  ownFullScreen = false
  keyboard()?.unlock?.()
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
}

const enter = () => {
  if (focused.value) return
  focused.value = true
  goFullScreen()
}

const leave = () => {
  if (!focused.value) return
  focused.value = false
  leaveFullScreen()
}

const toggle = () => (focused.value ? leave() : enter())

/**
 * Leaving full screen some other way, such as Escape in a browser, which
 * keeps the key for itself, or the window's own button, leaves focus mode.
 */
const onFullScreenChange = () => {
  if (document.fullscreenElement || !ownFullScreen) return
  ownFullScreen = false
  keyboard()?.unlock?.()
  focused.value = false
}

/**
 * Whether an Escape that reached the page is focus mode's. The editor marks
 * every Escape handled, so being handled says nothing; what has a use for
 * one stops it on the way instead: the find, and a link or comment being
 * written. A menu or a dialog closes on it, and focus mode stays.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
const isFocusEscape = event => {
  const target = /** @type {Element|null} */ (event.target)
  if (target?.closest?.('[role="menu"], [role="listbox"], [role="dialog"]')) return false
  return !document.querySelector('.p-dialog-mask')
}

/**
 * The key goes in and out anywhere in the writer, and Escape comes out.
 *
 * @param {KeyboardEvent} event
 */
const onKeyDown = event => {
  if (isFocusKey(event)) {
    if (event.defaultPrevented) return
    event.preventDefault()
    toggle()
    return
  }
  if (event.key !== 'Escape' || !focused.value || !isFocusEscape(event)) return
  event.preventDefault()
  leave()
}

/**
 * @returns {{
 *   focused: import('vue').Ref<boolean>,
 *   enter: () => void,
 *   leave: () => void,
 *   toggle: () => void,
 * }}
 */
export function useFocusMode() {
  return { focused, enter, leave, toggle }
}

/**
 * Take focus mode's keys, for as long as the component calling this is
 * mounted: the writer's frame. Focus mode ends with it.
 */
export function useFocusModeKeys() {
  onMounted(() => {
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('fullscreenchange', onFullScreenChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('fullscreenchange', onFullScreenChange)
    leave()
  })
}
