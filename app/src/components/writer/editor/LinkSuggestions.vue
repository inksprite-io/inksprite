<template>
  <div
    :id="id"
    ref="list"
    role="listbox"
    aria-label="Documents"
    class="max-h-72 w-72 max-w-full overflow-y-auto rounded-md p-1 shadow-md bg-surface-0 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-sm"
    data-link-suggestions
  >
    <!-- Never taking the focus: a press on a row has its default stopped,
         so the caret stays in the field, or the text, it was typed in. -->
    <div
      v-for="(entry, index) in entries"
      :id="`${id}-${index}`"
      :key="entry.key"
      role="option"
      :aria-selected="index === active"
      :data-index="index"
      class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer min-w-0"
      :class="index === active ? 'bg-surface-100 dark:bg-surface-700' : ''"
      @mousedown.prevent
      @click="emit('pick', index)"
      @mousemove="index === active || emit('hover', index)"
    >
      <i
        class="pi flex-none text-surface-500 dark:text-surface-400"
        :class="entry.heading ? 'pi-hashtag' : 'pi-file'"
      />
      <span class="truncate text-surface-800 dark:text-surface-100">{{ entry.title }}</span>
      <span
        v-if="entry.detail"
        class="ml-auto flex-none max-w-[45%] truncate text-xs text-surface-500 dark:text-surface-400"
      >
        {{ entry.detail }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'

/**
 * The documents, or headings, a link being made could go to, as a list to
 * pick from: under the link field, and under `[[` in the text. It shows them
 * and says which was picked; which is highlighted, and what the keys do,
 * belong to whatever it is under.
 */

/** @typedef {import('@/composables/useDocumentLinks.js').LinkSuggestion} LinkSuggestion */

const props = defineProps({
  /** The list's id, for the field's `aria-controls`. */
  id: { type: String, required: true },
  /** @type {import('vue').PropType<LinkSuggestion[]>} */
  entries: { type: Array, required: true },
  /** Which entry is highlighted. */
  active: { type: Number, default: 0 },
})

const emit = defineEmits(['pick', 'hover'])

const list = ref(/** @type {HTMLElement|null} */ (null))

// Arrowing past the bottom of what shows brings the next one into view.
watch(
  () => props.active,
  async index => {
    await nextTick()
    list.value?.querySelector(`[data-index="${index}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }
)
</script>
