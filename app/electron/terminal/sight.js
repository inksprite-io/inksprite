/**
 * Whether the terminal is shown, as far as its frame can tell.
 *
 * The page round the frame can't type in the terminal, but it says where the
 * keys go: it gives them to a terminal's frame as it gives them to a field
 * of its own. A frame set where the writer can't see it would take what they
 * type and paste meanwhile, unseen. So the frame takes keys and pastes only
 * while most of it is in the window and it is large enough to read.
 *
 * That is what a frame can know of itself without being wrong. It is not all
 * of being seen: a frame can't tell that the page has drawn over it or made
 * it see-through. The browser will say whether anything at all is over a
 * frame (an `IntersectionObserver` that tracks visibility), but only that,
 * for the frame as a whole, and the app's own toasts and its header buttons'
 * tooltips lie over a corner of the terminal in the ordinary way. A terminal
 * that went by it stopped taking keys under each of them, so this doesn't.
 *
 * The browser says where a frame is a moment after it is there. A terminal
 * whose tab is brought forward is given the keys first and told it is in the
 * window a frame or two later, and what is typed in between is not to be
 * lost. So what a terminal just given the keys has for its shell is kept for
 * that moment, and sent on when the browser says it is shown, or dropped if
 * it doesn't (`keysGate`).
 */

/** How much of the frame has to be in the window, of 1. */
export const IN_WINDOW = 0.5

/**
 * How long a terminal given the keys waits to hear that it is shown before
 * it lets them go: a few frames in the ordinary way, and long enough for a
 * slow machine.
 */
export const WAIT_MS = 500

/**
 * What a frame knows of where it is.
 *
 * @typedef {Object} Sight
 * @property {number} share - How much of the frame is in the window, from 0
 *   to 1: what the page has scrolled, clipped or moved out of it is not. 0
 *   until the browser has said
 * @property {{cols: number, rows: number}|null} size - The size there is
 *   room for, or null for a frame too small to be a terminal
 */

/**
 * Whether the terminal is shown: where the writer could see what they type
 * in it, unless the page has hidden it some other way.
 *
 * @param {Sight} sight
 * @returns {boolean}
 */
export function isShown({ share, size }) {
  return share >= IN_WINDOW && size !== null
}

/**
 * What passes what the emulator has for its shell: what is typed and pasted,
 * and its own answers to what a program asks it.
 *
 * Shown, all of it is sent. Not shown, the terminal is not to take keys at
 * all, which is the frame's to see to (`takes`), and its answers are sent as
 * ever: a program in a terminal behind another tab still asks where its
 * cursor is. Waiting to hear that it is shown, everything is kept, in order.
 *
 * @typedef {Object} KeysGate
 * @property {boolean} shown - Whether the terminal is shown, as last told
 * @property {boolean} takes - Whether the terminal takes what is typed and
 *   pasted now: shown, or waiting to hear that it is
 * @property {(shown: boolean) => void} show - The terminal is shown, or it
 *   isn't. What was kept while waiting is sent when it is.
 * @property {(letGo: () => void) => void} wait - The frame was given the
 *   keys. Not shown, the terminal takes them for `WAIT_MS` all the same, and
 *   what it has for the shell meanwhile is kept. `letGo` is called if the
 *   wait ends with the terminal still not shown, and what was kept is dropped.
 * @property {(message: object) => void} say - Something for the shell
 */

/**
 * @param {(message: object) => void} send - Sends the shell something
 * @returns {KeysGate}
 */
export function keysGate(send) {
  let shown = false
  /** What is kept while waiting, or null when not waiting. @type {object[]|null} */
  let kept = null
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let waiting

  return {
    get shown() {
      return shown
    },
    get takes() {
      return shown || kept !== null
    },
    show(now) {
      shown = now
      if (!shown || kept === null) return
      clearTimeout(waiting)
      const messages = kept
      kept = null
      for (const message of messages) send(message)
    },
    wait(letGo) {
      if (shown || kept !== null) return
      kept = []
      waiting = setTimeout(() => {
        kept = null
        letGo()
      }, WAIT_MS)
    },
    say(message) {
      if (kept !== null) kept.push(message)
      else send(message)
    },
  }
}
