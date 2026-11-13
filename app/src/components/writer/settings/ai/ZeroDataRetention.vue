<template>
  <div class="flex items-center justify-between gap-2" data-setting="zdr">
    <SettingLabel
      label="Zero data retention"
      description="Some models have no such endpoint and need this off."
      :overridden="overridden"
      @reset="emit('reset')"
    />
    <ToggleSwitch
      :model-value="modelValue"
      class="flex-none"
      aria-label="Zero data retention"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<script setup>
import ToggleSwitch from 'primevue/toggleswitch'
import SettingLabel from '@/components/common/SettingLabel.vue'

/**
 * A connection's zero-data-retention switch: OpenRouter's among its provider
 * routing, NanoGPT's on its own. Where it is kept is the caller's.
 *
 * @typedef {Object} Props
 * @property {boolean} modelValue - Whether only providers that keep nothing serve
 * @property {boolean} [overridden] - Whether it is off its default
 */
defineProps({
  modelValue: { type: Boolean, required: true },
  overridden: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'reset'])
</script>
