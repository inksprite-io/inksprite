<template>
  <div
    ref="root"
    class="absolute z-10 flex items-center gap-1 max-w-full rounded-md border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-800 shadow-md px-2 py-1 text-sm"
    :style="{ left: `${Math.max(0, left - shift)}px`, top: `${top}px` }"
    data-picture-popover
  >
    <!-- Enter keeps the alt text, as going elsewhere does; Escape goes back
         to the text as it was. -->
    <form
      class="flex items-center gap-1"
      @submit.prevent="apply(true)"
      @keydown.esc.stop.prevent="$emit('close', true)"
      @focusout="onFocusOut"
    >
      <InputText
        ref="field"
        v-model="text"
        size="small"
        class="w-64"
        placeholder="Alt text"
        aria-label="Alt text"
        data-picture-alt
        @focus="$emit('edit')"
      />
    </form>
    <!-- Pressing here leaves the picture selected in the editor. -->
    <Button
      icon="pi pi-window-maximize"
      severity="secondary"
      text
      size="small"
      aria-label="View picture"
      data-action="view-picture"
      @mousedown.prevent
      @click="$emit('view')"
    />
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

/**
 * The picture selected in the editor, shown under it: its alt text, which
 * the writer can change, and a button to see it at its own size. Placed by
 * the editor, in its page (see `editor/pictures`).
 *
 * @typedef {Object} Props
 * @property {string} alt - Its alt text as it is
 * @property {number} left - From the left of the page, in pixels
 * @property {number} top - From the top of the page, in pixels
 * @property {boolean} [editing] - The field has the focus, as when asked for from the menu
 */
const props = defineProps({
  alt: { type: String, default: '' },
  left: { type: Number, required: true },
  top: { type: Number, required: true },
  editing: { type: Boolean, default: false },
})

/**
 * `apply`: the alt text, and whether to go back to the text. `edit`: the
 * field took the focus. `view`. `close`: whether to go back to the text.
 */
const emit = defineEmits(['apply', 'edit', 'view', 'close'])

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<{ $el: HTMLInputElement }|null>} */
const field = ref(null)

const text = ref(props.alt)

/** How far left of where it was put it has to go to stay on the page. */
const shift = ref(0)

const fit = async () => {
  shift.value = 0
  await nextTick()
  const element = root.value
  const page = /** @type {HTMLElement|null} */ (element?.offsetParent ?? null)
  if (!element || !page) return
  shift.value = Math.max(0, element.offsetLeft + element.offsetWidth - page.clientWidth)
}

const focusField = async () => {
  await nextTick()
  field.value?.$el.focus()
  field.value?.$el.select()
}

onMounted(() => {
  fit()
  if (props.editing) focusField()
})

watch(
  () => [props.left, props.top, props.alt],
  () => {
    fit()
    text.value = props.alt
  }
)
watch(
  () => props.editing,
  editing => editing && focusField()
)

/** @param {boolean} back - Back to the text, as Enter goes */
const apply = back => emit('apply', text.value.trim(), back)

/** @param {FocusEvent} event */
const onFocusOut = event => {
  const next = /** @type {Node|null} */ (event.relatedTarget)
  if (next && root.value?.contains(next)) return
  if (text.value.trim() !== props.alt) apply(false)
  else emit('close', false)
}
</script>
