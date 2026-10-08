<template>
  <div
    ref="root"
    class="absolute z-10 flex items-center gap-1 max-w-full rounded-md border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-800 shadow-md px-2 py-1 text-sm"
    :style="{ left: `${Math.max(0, left - shift)}px`, top: `${top}px` }"
    data-link-popover
  >
    <!-- Pressing here leaves the caret in the editor, in the link. -->
    <div v-if="!editing" class="flex items-center gap-1 min-w-0" @mousedown.prevent>
      <i class="pi pi-link flex-none text-surface-500 dark:text-surface-400" />
      <button
        type="button"
        class="min-w-0 max-w-80 truncate text-primary-600 dark:text-primary-400 hover:underline"
        :title="href"
        data-action="open-link"
        @click="$emit('open')"
      >
        {{ href }}
      </button>
      <Button
        type="button"
        label="Edit"
        severity="secondary"
        text
        size="small"
        class="flex-none !py-0.5"
        data-action="edit-link"
        @click="$emit('edit')"
      />
      <Button
        type="button"
        label="Remove"
        severity="secondary"
        text
        size="small"
        class="flex-none !py-0.5"
        data-action="remove-link"
        @click="$emit('remove')"
      />
    </div>

    <!-- Escape goes back to the text; going anywhere else just puts it away. -->
    <form
      v-else
      class="flex items-center gap-1"
      @submit.prevent="$emit('apply', { href: address, text })"
      @keydown.esc.stop.prevent="$emit('close', true)"
      @focusout="onFocusOut"
    >
      <InputText
        v-if="withText"
        v-model="text"
        size="small"
        class="w-36"
        placeholder="Text"
        aria-label="Text"
        data-link-text
      />
      <InputText
        ref="addressField"
        v-model="address"
        size="small"
        class="w-64"
        placeholder="Link"
        aria-label="Link"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        data-link-address
      />
      <Button type="submit" label="Apply" size="small" data-action="apply-link" />
    </form>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

/**
 * The link the caret is in, shown under it, or the field for making or
 * changing one (see `editor/links`). Placed by the editor, in its page.
 *
 * @typedef {Object} Props
 * @property {string} href - Where the link goes, or the address to start the field with
 * @property {number} left - From the left of the page, in pixels
 * @property {number} top - From the top of the page, in pixels
 * @property {boolean} [editing] - The field rather than the link
 * @property {boolean} [withText] - The field asks for the link's words too
 */
const props = defineProps({
  href: { type: String, required: true },
  left: { type: Number, required: true },
  top: { type: Number, required: true },
  editing: { type: Boolean, default: false },
  withText: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'edit', 'remove', 'apply', 'close'])

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<{ $el: HTMLInputElement }|null>} */
const addressField = ref(null)

const address = ref(props.href)
const text = ref('')

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

/** The field opens with the address in hand, to type over or paste into. */
const focusField = async () => {
  await nextTick()
  addressField.value?.$el.focus()
  addressField.value?.$el.select()
}

onMounted(() => {
  fit()
  if (props.editing) focusField()
})

watch(
  () => [props.left, props.top, props.href, props.editing],
  () => {
    fit()
    if (props.editing) {
      address.value = props.href
      focusField()
    }
  }
)

/** @param {FocusEvent} event */
const onFocusOut = event => {
  const next = /** @type {Node|null} */ (event.relatedTarget)
  if (!next || !root.value?.contains(next)) emit('close', false)
}
</script>
