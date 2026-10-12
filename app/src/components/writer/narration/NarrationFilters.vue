<template>
  <div class="flex flex-col gap-2 px-1">
    <Textarea
      :model-value="filters"
      size="small"
      class="w-full font-mono text-xs dark:!bg-surface-900"
      :class="{ 'focus:!border-[var(--p-textarea-invalid-border-color)]': !valid }"
      auto-resize
      rows="3"
      :placeholder="EXAMPLE"
      :invalid="!valid"
      aria-label="Filters"
      data-filters
      @update:model-value="$emit('update:filters', $event)"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Textarea from 'primevue/textarea'
import { filtersValid } from '@/tts/filters.js'

/**
 * The project's filters, as the text they are kept as: a regular expression
 * to a line, for what is not read aloud. A line that is not one marks the
 * field, as it is typed, and is not used.
 *
 * @typedef {Object} Props
 * @property {string} filters
 */
const props = defineProps({
  filters: { type: String, default: '' },
})

defineEmits(['update:filters'])

const valid = computed(() => filtersValid(props.filters))

const EXAMPLE = '^Page \\d+$\n\\[\\d+\\]'
</script>
