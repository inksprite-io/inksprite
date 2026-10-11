<template>
  <div
    ref="root"
    class="px-2 py-1 text-sm"
    :class="
      docked
        ? 'w-full'
        : 'absolute z-10 w-max max-w-[calc(100%-2rem)] rounded-md border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-800 shadow-md'
    "
    :style="
      docked
        ? undefined
        : {
            left: `${Math.max(0, left - shift)}px`,
            top: `${top}px`,
            minWidth: openedWidth ? `${openedWidth}px` : undefined,
          }
    "
    data-comment-popover
    :data-stacked="stacked || undefined"
  >
    <!-- Pressing here leaves the caret in the editor, in the passage. -->
    <div
      v-if="!editing"
      class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1"
      @mousedown.prevent
    >
      <i
        class="pi pi-comment text-surface-500 dark:text-surface-400"
        :class="{ 'row-start-2': stacked }"
      />
      <span
        ref="said"
        class="keeps-scrollbar max-h-40 overflow-y-auto overscroll-contain px-1 break-words whitespace-pre-line text-surface-700 dark:text-surface-200"
        :class="[
          isMobile ? 'text-base/[1.5rem]' : 'text-[0.9375rem]/[1.375rem]',
          { 'max-w-96': !docked, 'col-span-3': stacked },
        ]"
        data-comment-text
        >{{ text }}</span
      >
      <div class="flex items-center" :class="{ 'row-start-2 col-start-3': stacked }">
        <Button
          v-tooltip.bottom="tip('Edit comment')"
          type="button"
          icon="pi pi-pencil"
          text
          rounded
          size="small"
          aria-label="Edit comment"
          data-action="edit-comment"
          @click="$emit('edit')"
        />
        <Button
          v-tooltip.bottom="tip('Resolve')"
          type="button"
          icon="pi pi-check"
          text
          rounded
          size="small"
          severity="success"
          aria-label="Resolve"
          data-action="resolve-comment"
          @click="$emit('resolve')"
        />
      </div>
    </div>

    <form
      v-else
      class="flex w-96 min-w-full max-w-full"
      :class="stacked ? 'flex-col' : 'items-center gap-1'"
      @submit.prevent="save"
      @keydown.esc.stop.prevent="$emit('close', true)"
      @focusout="onFocusOut"
    >
      <!-- As wide as a comment that runs to the full width, with the buttons
           beside the text or under it, or as the comment it opened on if that
           was wider. Escape goes back to the text; going anywhere else just
           puts it away. -->
      <Textarea
        ref="field"
        v-model="draft"
        rows="1"
        auto-resize
        size="small"
        class="keeps-scrollbar max-h-40 overscroll-contain"
        :class="[
          isMobile ? '!text-base/[1.5rem]' : '!text-[0.9375rem]/[1.375rem]',
          stacked ? 'w-full' : 'flex-1 min-w-0',
          { '!overflow-y-auto': full },
        ]"
        placeholder="Comment"
        aria-label="Comment"
        data-comment-field
        @keydown.enter="onEnter"
      />
      <!-- A pressed button would take the focus from the field, and in Safari
           give it to nothing, which puts the field away before the click. -->
      <div class="flex flex-none items-center" :class="{ 'self-end': stacked }" @mousedown.prevent>
        <Button
          v-tooltip.bottom="tip('Cancel')"
          type="button"
          icon="pi pi-times"
          text
          rounded
          size="small"
          aria-label="Cancel"
          data-action="cancel-comment"
          @click="$emit('close', true)"
        />
        <Button
          v-tooltip.bottom="tip(existing ? 'Save' : 'Add comment')"
          type="submit"
          icon="pi pi-check"
          text
          rounded
          size="small"
          severity="success"
          :aria-label="existing ? 'Save' : 'Add comment'"
          :disabled="!draft.trim()"
          data-action="save-comment"
        />
      </div>
    </form>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import { submitOnEnter } from '@/utils/touch.js'
import { useScreenSize } from '@/composables/useScreenSize.js'

/**
 * The comment the caret is in, shown under it, or the field for writing one
 * on a passage or changing what was said. Placed by the editor, in its page,
 * as the link popover is; or, on a phone, in a bar at the bottom of the
 * screen, out of the way of the menu iOS keeps beside a selection.
 *
 * @typedef {Object} Props
 * @property {string} text - What was said, or what the field starts with
 * @property {number} [left] - From the left of the page, in pixels
 * @property {number} [top] - From the top of the page, in pixels
 * @property {boolean} [editing] - The field rather than the comment
 * @property {boolean} [existing] - The field is on a comment already in the text
 * @property {boolean} [docked] - In the bar, as wide as it, rather than over the text
 */
const props = defineProps({
  text: { type: String, default: '' },
  left: { type: Number, default: 0 },
  top: { type: Number, default: 0 },
  editing: { type: Boolean, default: false },
  existing: { type: Boolean, default: false },
  docked: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'resolve', 'save', 'close'])

/**
 * A button's tooltip, where there is a pointer to hover with. In the phone's
 * bar a tap shows it and leaves it up, over the field.
 *
 * @param {string} text
 * @returns {string|null}
 */
const tip = text => (props.docked ? null : text)

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const said = ref(null)
/** @type {import('vue').Ref<{ $el: HTMLTextAreaElement }|null>} */
const field = ref(null)

const draft = ref(props.text)

// iOS zooms the page in on a field whose text is smaller than 16px, and does
// not zoom back out, so on a phone the field keeps the full size, and the
// comment it is opened on matches it.
const { isMobile } = useScreenSize()

/**
 * How far left of where it was put it has to go to stay over the text: inside
 * the page's padding, so that on a phone it neither meets the screen's edge
 * nor makes the page wider than the screen. Its width is its content's, held
 * to the text's, so it is the same wherever it is put.
 */
const shift = ref(0)

/**
 * The buttons under the comment rather than beside it, once it runs past a
 * line, and the comment's icon with them, so the text has the width. Whether
 * it does is measured with them beside it, so that the room they leave by
 * going under it cannot bring them back up.
 */
const stacked = ref(false)

/**
 * How many lines an element's text takes at the width it has.
 *
 * @param {HTMLElement} element
 * @returns {number}
 */
const linesIn = element => {
  const style = window.getComputedStyle(element)
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  return Math.round((element.scrollHeight - padding) / line)
}

/**
 * The field grown as tall as it may, so that what is written scrolls in it.
 * Only then does it get a scrollbar: PrimeVue sizes it to its text less its
 * border, so it is always that much short and would show one for a line.
 */
const full = ref(false)

/**
 * Whether an element's text would make it taller than it may be.
 *
 * @param {HTMLElement} element
 * @returns {boolean}
 */
const pastMaxHeight = element => {
  const border = element.offsetHeight - element.clientHeight
  return element.scrollHeight + border > parseFloat(window.getComputedStyle(element).maxHeight)
}

const fit = async () => {
  stacked.value = false
  await nextTick()
  const text = props.editing ? field.value?.$el : said.value
  stacked.value = !!text && linesIn(text) > 1
  full.value = props.editing && !!text && pastMaxHeight(text)
  if (props.docked) return
  await nextTick()
  const element = root.value
  const page = /** @type {HTMLElement|null} */ (element?.offsetParent ?? null)
  if (!element || !page) return
  const edge = page.clientWidth - (parseFloat(window.getComputedStyle(page).paddingRight) || 0)
  shift.value = Math.max(0, props.left + element.offsetWidth - edge)
}

/**
 * The field opens with the caret after what was said, to go on from it. The
 * editor's selection is let go first: iOS keeps its menu (Copy, Paste) over
 * a selection the editor still holds, and the menu covers the field. The
 * passage stays tinted, and the editor puts its selection back when the
 * field closes.
 */
const focusField = async () => {
  await nextTick()
  const element = field.value?.$el
  if (!element) return
  window.getSelection()?.removeAllRanges()
  element.focus()
  element.setSelectionRange(element.value.length, element.value.length)
}

onMounted(() => {
  fit()
  if (props.editing) focusField()
})

/**
 * The width of the comment the field was opened on, which the field keeps, so
 * that Edit does not narrow the box under the writer's eye. Read as the
 * comment turns into the field, before the field is drawn.
 */
const openedWidth = ref(0)

watch(
  () => props.editing,
  editing => {
    openedWidth.value = editing && !props.docked ? (root.value?.offsetWidth ?? 0) : 0
  }
)

watch(
  () => [props.left, props.top, props.text, props.editing],
  () => {
    fit()
    if (props.editing) {
      draft.value = props.text
      focusField()
    }
  }
)

watch(draft, fit)

const save = () => {
  if (draft.value.trim()) emit('save', draft.value.trim())
}

/**
 * Enter saves and Shift-Enter starts a new line, as in the chat; on a touch
 * screen Enter starts one, and the button saves. Enter that ends a word being
 * composed is the composing's.
 *
 * @param {KeyboardEvent} event
 */
const onEnter = event => {
  if (event.isComposing || event.shiftKey) return
  submitOnEnter(event, save)
}

/** @param {FocusEvent} event */
const onFocusOut = event => {
  const next = /** @type {Node|null} */ (event.relatedTarget)
  if (!next || !root.value?.contains(next)) emit('close', false)
}
</script>

<style scoped>
/* The comment is on the box's own ground, so a scrollbar shown only while it
   scrolls would give no sign that there is more of it: the thumb stays, on no
   track. Safari and Chrome keep a scrollbar they are given a style for. */
.keeps-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.keeps-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.keeps-scrollbar::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgb(128 128 128 / 0.45);
}
@supports not selector(::-webkit-scrollbar) {
  .keeps-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgb(128 128 128 / 0.45) transparent;
  }
}
</style>
