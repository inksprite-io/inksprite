import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

/**
 * @module composables/useLinkMenu
 * @description The documents `[[` opens a list of in the message field.
 *
 * As in a document (`editor/linkPicker`): typing `[[` lists the project's
 * documents, which narrow as a name is typed after it, and a `#` goes on to
 * a document's headings. Enter or Tab puts in the one highlighted in place of
 * the `[[` and what was typed, as the message holds a link (`chatLink`);
 * Escape puts the list away until the `[[` is typed again. Its keys are the
 * field's own while it is open, as the command menu's are (`useCommandMenu`).
 */

/** @typedef {import('./useDocumentLinks.js').LinkSuggestion} LinkSuggestion */

/** `[[` and a name not yet closed, at the end of the text before the caret. */
const OPENED = /\[\[([^[\]\n]*)$/

/**
 * The `[[` the caret is after in a text, and what has been typed since.
 *
 * @param {string} text
 * @param {number} caret
 * @returns {{start: number, query: string}|null}
 */
export function linkAtCaret(text, caret) {
  const found = OPENED.exec(text.slice(0, caret))
  return found ? { start: caret - found[0].length, query: found[1] } : null
}

/**
 * The menu for one message field.
 *
 * @param {import('vue').Ref<HTMLTextAreaElement|null>} field - The textarea
 * @param {import('vue').Ref<string>} draft - What it holds
 * @param {Object} options
 * @param {(query: string) => LinkSuggestion[]} options.suggest - What a name
 *   could be
 * @param {(entry: LinkSuggestion, before: string) => string|null} options.textFor -
 *   What goes in for the one picked, given the draft before the `[[`
 * @returns {{
 *   open: import('vue').ComputedRef<boolean>,
 *   entries: import('vue').ComputedRef<LinkSuggestion[]>,
 *   active: import('vue').Ref<number>,
 *   pick: (index: number) => Promise<void>,
 *   onKeydown: (event: KeyboardEvent) => void,
 * }}
 */
export function useLinkMenu(field, draft, { suggest, textFor }) {
  /** Where the caret is, or null while the field is not focused or holds a selection. */
  const caret = ref(/** @type {number|null} */ (null))
  /** Where the `[[` Escape put the list away for starts. */
  const shut = ref(/** @type {number|null} */ (null))
  const active = ref(0)

  const spot = computed(() => (caret.value === null ? null : linkAtCaret(draft.value, caret.value)))
  const entries = computed(() => (spot.value ? suggest(spot.value.query) : []))
  const open = computed(
    () => !!spot.value && entries.value.length > 0 && shut.value !== spot.value.start
  )

  watch(spot, at => {
    if (!at || at.start !== shut.value) shut.value = null
  })
  watch(
    () => spot.value && `${spot.value.start}:${spot.value.query}`,
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
   * Put the one picked in place of the `[[` and what was typed, and the
   * caret after it.
   *
   * @param {number} index - Which of the entries
   */
  const pick = async index => {
    const at = spot.value
    const entry = entries.value[index]
    const end = caret.value
    if (!at || !entry || end === null) return
    const text = draft.value
    const link = textFor(entry, text.slice(0, at.start))
    if (!link) return
    const to = at.start + link.length
    draft.value = text.slice(0, at.start) + link + text.slice(end)
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
        pick(active.value)
        break
      case 'Escape':
        shut.value = /** @type {NonNullable<typeof spot.value>} */ (spot.value).start
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return { open, entries, active, pick, onKeydown }
}
