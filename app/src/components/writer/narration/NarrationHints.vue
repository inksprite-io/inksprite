<template>
  <div class="flex flex-col gap-1 px-1">
    <Textarea
      :model-value="hints"
      size="small"
      class="w-full font-mono text-xs dark:!bg-surface-900"
      auto-resize
      rows="3"
      placeholder="Aelinor:AY-lin-or"
      aria-label="Pronunciation hints"
      data-hints
      @update:model-value="$emit('update:hints', $event)"
    />
    <p class="text-xs text-surface-500 dark:text-surface-400">
      One per line, <code>word:pronunciation</code>. Whole words only.
    </p>
  </div>
</template>

<script setup>
import Textarea from 'primevue/textarea'

/**
 * The project's pronunciation hints, as the text they are kept as.
 *
 * @typedef {Object} Props
 * @property {string} hints
 */
defineProps({
  hints: { type: String, default: '' },
})

defineEmits(['update:hints'])
</script>
