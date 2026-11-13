<template>
  <div class="flex items-center gap-1">
    <label
      v-tooltip.top="{ value: description, showDelay: 400 }"
      class="text-xs font-medium text-surface-700 dark:text-surface-200"
    >
      {{ label }}
    </label>
    <!-- Each button has a place of its own where the setting can be saved, so
         neither moves when the other comes, and none of them makes the row
         taller than its label. -->
    <span :class="{ 'w-5 flex-none flex justify-center': saveable }">
      <button
        v-if="overridden"
        v-tooltip.top="resetTooltip"
        class="flex items-center justify-center w-5 h-6 -my-1 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
        :aria-label="`Reset ${label}`"
        @click="emit('reset')"
      >
        <i class="pi pi-replay text-xs" />
      </button>
    </span>
    <span v-if="saveable" class="w-5 flex-none flex justify-center">
      <button
        v-if="unsaved"
        v-tooltip.top="saveTooltip"
        class="flex items-center justify-center w-5 h-6 -my-1 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
        :aria-label="`Save ${label}`"
        @click="emit('save')"
      >
        <i class="pi pi-save text-xs" />
      </button>
    </span>
  </div>
</template>

<script setup>
/**
 * Label for a single generation setting. The reset affordance only appears
 * once the setting has been overridden, so the panel reads as "everything is
 * default except these". A setting kept somewhere besides here, a chat's
 * prompt on its profile, can have a save beside it too, there while the two
 * differ.
 *
 * @typedef {Object} Props
 * @property {string} label - Display name
 * @property {string} [description] - Shown as a tooltip on hover
 * @property {boolean} [overridden] - Whether this setting differs from the default
 * @property {string} [resetTooltip] - Tooltip on the reset affordance, for settings that revert to something other than a default
 * @property {boolean} [saveable] - Whether it can be saved where it is kept besides
 * @property {boolean} [unsaved] - Whether it differs from what is kept there
 * @property {string} [saveTooltip] - Tooltip on the save affordance
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
  saveable: {
    type: Boolean,
    default: false,
  },
  unsaved: {
    type: Boolean,
    default: false,
  },
  saveTooltip: {
    type: String,
    default: 'Save to profile',
  },
})

const emit = defineEmits(['reset', 'save'])
</script>
