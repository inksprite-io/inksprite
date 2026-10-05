<template>
  <div class="flex items-center gap-1">
    <label
      v-tooltip.top="{ value: description, showDelay: 400 }"
      class="text-xs font-medium text-surface-700 dark:text-surface-200"
    >
      {{ label }}
    </label>
    <button
      v-if="overridden"
      v-tooltip.top="resetTooltip"
      class="p-1 leading-none text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
      :aria-label="`Reset ${label}`"
      @click="emit('reset')"
    >
      <i class="pi pi-replay text-xs" />
    </button>
  </div>
</template>

<script setup>
/**
 * Label for a single generation setting. The reset affordance only appears
 * once the setting has been overridden, so the panel reads as "everything is
 * default except these".
 *
 * @typedef {Object} Props
 * @property {string} label - Display name
 * @property {string} [description] - Shown as a tooltip on hover
 * @property {boolean} [overridden] - Whether this setting differs from the default
 * @property {string} [resetTooltip] - Tooltip on the reset affordance, for settings that revert to something other than a default
 */
defineProps({
  label: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  overridden: {
    type: Boolean,
    default: false,
  },
  resetTooltip: {
    type: String,
    default: 'Reset to default',
  },
})

const emit = defineEmits(['reset'])
</script>
