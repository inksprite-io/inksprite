/**
 * @module composables/useJumpToBottom
 * @description When to offer a way back to the end of a long scroll.
 *
 * A chat does not follow its newest message down — see Chat.vue — so a writer
 * who has gone back up through a long one has a long way to come back. The
 * button that takes them there is offered when two things are true at once:
 *
 * - the end is far away, more than a panel's height below what they can see.
 *   Any nearer and the scroll wheel is as quick, and a button over the text is
 *   in the way;
 * - they are heading for it. Somebody scrolling up is going back to read
 *   something, and a button that appears under their pointer as they do is
 *   offering to undo what they are in the middle of. Scrolling down is the
 *   moment the offer is an answer to anything.
 *
 * Only the writer's own scrolling counts as heading anywhere. The chat moves
 * the panel itself — to the top of a summary as it starts being written, to the
 * end of the chat when something is sent or one is opened — and says so with
 * `hush`, so that its own movement is not read as somebody's intent.
 *
 * How far is far is one answer, and the chat asks it too: a writer that far
 * from the end has gone to read something, and is not brought back by a
 * message landing there.
 */

import { ref } from 'vue'

/** How long after the chat moves the panel its scrolling is taken to be the chat's. */
const HUSH_MS = 1000

/** How many times a jump goes again when the end moved under it. */
const MAX_PASSES = 4

/** Once the next frame has been laid out and drawn. */
const drawn = () =>
  new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/**
 * @param {() => HTMLElement|null} scroller - The element that scrolls, asked for
 *   each time because a component library owns it and may not have made it yet
 * @param {import('vue').Ref<number>} [spare] - Room at the bottom of the scroll
 *   that is not content, and is not part of how far away the end is
 */
export function useJumpToBottom(scroller, spare = ref(0)) {
  const visible = ref(false)

  let lastTop = 0
  let hushedUntil = 0

  /**
   * How far below what can be seen the end of the content is.
   * @param {HTMLElement} panel
   */
  const gapOf = panel => panel.scrollHeight - spare.value - panel.scrollTop - panel.clientHeight

  /** Whether the end is more than a panel's height below what can be seen. */
  const far = () => {
    const panel = scroller()
    return Boolean(panel) && gapOf(panel) > panel.clientHeight
  }

  /** The panel scrolled. Wired to its `scroll` event. */
  const onScroll = () => {
    const panel = scroller()
    if (!panel) return

    const down = panel.scrollTop > lastTop
    const up = panel.scrollTop < lastTop
    lastTop = panel.scrollTop

    if (Date.now() < hushedUntil) {
      visible.value = false
      return
    }

    // Neither up nor down is the panel being resized under a scroll that has
    // not moved, which says nothing about where anybody is heading.
    if (!far() || up) visible.value = false
    else if (down) visible.value = true
  }

  /** The chat is about to move the panel itself. */
  const hush = () => {
    hushedUntil = Date.now() + HUSH_MS
    visible.value = false
  }

  /**
   * Go to the end of the content, at once rather than smoothly, as other chat
   * apps do. Turns off screen stand at a guessed height until they are laid
   * out, so the end moves as the ones passed on the way come into view: a
   * smooth scroll to where the end was when it set out stopped short of where
   * it is. The panel can change height under it too, as the message box sizes
   * itself when a chat opens. So the jump is made again once a frame has been
   * drawn, until it is at the end.
   *
   * @returns {Promise<void>}
   */
  const jump = async () => {
    const panel = scroller()
    if (!panel) return

    hush()
    let passes = 0
    do {
      panel.scrollTop = Math.max(0, panel.scrollHeight - spare.value - panel.clientHeight)
      await drawn()
    } while (gapOf(panel) > 1 && ++passes < MAX_PASSES)
  }

  return { visible, far, onScroll, hush, jump }
}
