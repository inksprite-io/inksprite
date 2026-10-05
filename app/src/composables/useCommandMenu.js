import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { commandAtCaret, matchCommands } from '@/ai/commands.js'

/**
 * @module composables/useCommandMenu
 * @description The menu of commands a slash opens in the message field.
 *
 * It opens while the caret is in a command's name at the start of a line, and
 * lists the commands that name could be finishing. It only ever finishes the
 * name: what comes after is the writer's to type, the same as without it.
 */

/** @typedef {import('@/ai/commands.js').CommandEntry} CommandEntry */

/**
 * The id of a command's row in the menu, for the row itself and for the
 * field's `aria-activedescendant`, which names the row a screen reader is on
 * while the focus stays in the field.
 *
 * @param {string} listId - The menu's id
 * @param {string} name - The command's
 * @returns {string}
 */
export const commandOptionId = (listId, name) => `${listId}-${name}`

/**
 * The menu for one message field.
 *
 * The field's own keys are the menu's while it is open, and nobody else's:
 * Enter that would have sent the message finishes the name instead, and Escape
 * that would have closed the panel closes the menu. So `onKeydown` has to see
 * a key before the field's own handlers do, which means binding it on
 * something around the field, in the capture phase; it stops the keys it
 * uses there. It leaves alone any key it has no use for, and Enter with a
 * modifier, which already means something else in the field.
 *
 * Enter is left alone, too, when the name is already typed out in full. The
 * writer who types `/tarot` and presses Enter wants it sent, not
 * finished; Tab still finishes it.
 *
 * Escape shuts it for the rest of that command: typing on does not bring it
 * back, and it opens again once the caret has left the name and come back to
 * one. Picking a name shuts it on that name, because a name that takes a
 * setting is finished without a space, which leaves the caret still in it, and
 * a menu that opened again there would take the next Enter for itself.
 *
 * @param {import('vue').Ref<HTMLTextAreaElement|null>} field - The textarea
 * @param {import('vue').Ref<string>} draft - What it holds
 * @returns {{
 *   open: import('vue').ComputedRef<boolean>,
 *   entries: import('vue').ComputedRef<CommandEntry[]>,
 *   active: import('vue').Ref<number>,
 *   pick: (index: number) => Promise<void>,
 *   onKeydown: (event: KeyboardEvent) => void,
 * }}
 */
export function useCommandMenu(field, draft) {
  /** Where the caret is, or null while the field is not focused or holds a selection. */
  const caret = ref(/** @type {number|null} */ (null))
  /**
   * The command the menu was shut on: where its slash is, and the one name it
   * was shut at when it was shut by a pick rather than by Escape.
   */
  const shut = ref(/** @type {{start: number, typed?: string}|null} */ (null))
  const active = ref(0)

  const spot = computed(() =>
    caret.value === null ? null : commandAtCaret(draft.value, caret.value)
  )
  const entries = computed(() => (spot.value ? matchCommands(spot.value.typed) : []))
  const open = computed(() => {
    if (!spot.value || entries.value.length === 0) return false
    const was = shut.value
    if (!was || was.start !== spot.value.start) return true
    return was.typed !== undefined && was.typed !== spot.value.typed
  })

  // Out of the name, and whatever shut the menu is over with.
  watch(spot, at => {
    if (!at) shut.value = null
  })

  // A different name is a different list, and the first of it is the best
  // guess at what the writer means.
  watch(
    () => spot.value && `${spot.value.start}:${spot.value.typed}`,
    () => (active.value = 0)
  )

  /** Read the caret off the field, after anything that could have moved it. */
  const track = () => {
    const el = field.value
    caret.value =
      el && document.activeElement === el && el.selectionStart === el.selectionEnd
        ? el.selectionStart
        : null
  }
  const leave = () => (caret.value = null)

  // Typing, clicking, arrowing about and focusing all move the caret, and
  // none of them says so on its own. Sending clears the draft without moving
  // it, which is fine: an empty draft has no command in it.
  const MOVES = ['input', 'click', 'keyup', 'focus', 'select']

  watch(
    field,
    (el, was) => {
      for (const type of MOVES) was?.removeEventListener(type, track)
      was?.removeEventListener('blur', leave)
      for (const type of MOVES) el?.addEventListener(type, track)
      el?.addEventListener('blur', leave)
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    const el = field.value
    for (const type of MOVES) el?.removeEventListener(type, track)
    el?.removeEventListener('blur', leave)
  })

  /**
   * Finish the name with this entry, and put the caret after it.
   *
   * @param {number} index - Which of the entries
   */
  const pick = async index => {
    const at = spot.value
    const entry = entries.value[index]
    if (!at || !entry) return

    const text = draft.value
    const after = text.slice(at.end)
    // A space to start what the command is about, unless it takes a setting
    // first or the draft already has one there.
    const spaced = entry.takesParam || /^\s/.test(after) ? '' : ' '
    const finished = `/${entry.name}${spaced}`
    const to = at.start + finished.length
    shut.value = { start: at.start, typed: entry.name }
    draft.value = text.slice(0, at.start) + finished + after
    // Moved with the text rather than read back after it, so the two never
    // disagree about where the caret is, even for the one render between.
    caret.value = to

    await nextTick()
    const el = field.value
    if (!el) return
    el.focus()
    el.setSelectionRange(to, to)
  }

  /** @param {KeyboardEvent} event */
  const onKeydown = event => {
    if (!open.value || event.target !== field.value || event.isComposing) return
    const at = /** @type {NonNullable<typeof spot.value>} */ (spot.value)
    const count = entries.value.length

    switch (event.key) {
      case 'ArrowDown':
        active.value = (active.value + 1) % count
        break
      case 'ArrowUp':
        active.value = (active.value - 1 + count) % count
        break
      case 'Tab':
        if (event.shiftKey) return
        pick(active.value)
        break
      case 'Enter':
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
        if (entries.value[active.value].name === at.typed.toLowerCase()) return
        pick(active.value)
        break
      case 'Escape':
        shut.value = { start: at.start }
        break
      default:
        return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  return { open, entries, active, pick, onKeydown }
}
