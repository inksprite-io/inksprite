<template>
  <div class="flex flex-col gap-2 px-1">
    <Textarea
      :model-value="hints"
      size="small"
      class="w-full font-mono text-xs dark:!bg-surface-900"
      auto-resize
      rows="3"
      :placeholder="EXAMPLE"
      aria-label="Pronunciation hints"
      data-hints
      @update:model-value="$emit('update:hints', $event)"
    />
    <div class="flex justify-end">
      <Button
        type="button"
        label="Preview"
        icon="pi pi-volume-up"
        size="small"
        severity="secondary"
        text
        :loading="previewing"
        :disabled="!hinted"
        data-action="preview-hints"
        @click="$emit('preview')"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import { parseHints } from '@/tts/hints.js'

/**
 * The project's pronunciation hints, as the text they are kept as, and the
 * way to hear the words they respell.
 *
 * @typedef {Object} Props
 * @property {string} hints
 * @property {boolean} [previewing] - Whether a preview is being fetched
 */
const props = defineProps({
  hints: { type: String, default: '' },
  previewing: { type: Boolean, default: false },
})

defineEmits(['update:hints', 'preview'])

/** Whether there is a hint to hear. */
const hinted = computed(() => parseHints(props.hints).length > 0)

const EXAMPLE = 'quinoa:keenwah\nEleanor:ellinore'
</script>
