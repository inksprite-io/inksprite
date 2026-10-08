/**
 * @module composables/useFindKey
 * @description Command-F, or Control-F off a Mac, finds in the panel the
 * writer is in.
 *
 * The browser's own find sees only what is in the page, and most of a long
 * chat is not: see useNearTurns, nor most of a long plain document. A
 * document is found in by its view, which can replace as well. So the key is
 * taken from the browser by the panel that has the focus, or with nothing in
 * it focused the one last clicked or touched, and only when the panel has a
 * find of its own to open. Anywhere else, in a dialog, the key is still the
 * browser's.
 */

/* global Node */
import { onBeforeUnmount, onMounted } from 'vue'

const isMac = /Mac|iP(hone|ad|od)/.test(
  (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || ''
)

/** What was last clicked or touched, for when nothing has the focus. */
/** @type {EventTarget|null} */
let pressed = null
let listening = false

/** @param {PointerEvent} event */
const remember = event => {
  pressed = event.target
}

/**
 * Whether a key is the find key: the browser's own, so that it is the one the
 * writer already reaches for.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isFindKey(event) {
  if (event.altKey || event.shiftKey || event.key?.toLowerCase() !== 'f') return false
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/**
 * Open a panel's find on the find key, while the writer is in the panel.
 *
 * @param {() => Element|null|undefined} root - The panel
 * @param {() => boolean} open - Opens the find, or says there is none to open
 */
export function useFindKey(root, open) {
  /** @param {KeyboardEvent} event */
  const onKeyDown = event => {
    if (event.defaultPrevented || !isFindKey(event)) return
    const panel = root()
    if (!panel?.isConnected) return
    // The focus decides, unless it is on nothing, or on something around the
    // panel that a click inside it focused, such as the split the panel is in.
    const focused = document.activeElement
    const within =
      focused && focused !== document.body && !focused.contains(panel)
        ? panel.contains(focused)
        : pressed instanceof Node && panel.contains(pressed)
    if (within && open()) event.preventDefault()
  }

  onMounted(() => {
    if (!listening) {
      document.addEventListener('pointerdown', remember, true)
      listening = true
    }
    document.addEventListener('keydown', onKeyDown)
  })

  onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown))
}
