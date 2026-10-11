<template>
  <div class="flex items-center justify-center gap-4">
    <Slider
      v-model.number="sliderValue"
      type="range"
      :min="props.sliderMin ?? props.min"
      :max="props.sliderMax ?? props.max"
      :step="props.step"
      :aria-label="props.label || undefined"
      class="custom-slider flex-1 m-1 ml-3"
      :pt="{
        root: {
          class: '!h-1.5',
        },
        range: {
          class: 'bg-[#646cff] rounded-full',
        },
        handle: {
          class:
            '!bg-[#646cff] ' +
            'hover:bg-[#535bf2] ' +
            'border-surface-0 dark:border-surface-900 shadow ' +
            'transition-transform focus-visible:!outline-none ' +
            'focus-visible:!ring-4 focus-visible:ring-[#646cff66] ' + // “glow”
            'scale-80 hover:scale-100',
        },
      }"
    />
    <InputNumber
      v-model.number="inputValue"
      type="number"
      :min="props.min"
      :max="props.max"
      :min-fraction-digits="0"
      :max-fraction-digits="props.fractional ? 2 : 0"
      :aria-label="props.label || undefined"
      size="small"
      class="flex-none"
      :pt="{
        root: { class: 'w-auto' },
        pcInputText: {
          root: {
            class: 'h-6 leading-8 px-2 w-[8ch] !text-xs text-right tabular-nums',
          },
        },
      }"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Slider } from 'primevue'
import InputNumber from 'primevue/inputnumber'

const props = defineProps({
  modelValue: { type: Number, required: true },
  sliderMin: { type: Number, required: false },
  sliderMax: { type: Number, required: false },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  step: { type: Number, required: true },
  fractional: { type: Boolean, required: false, default: true },
  /** What a screen reader calls the slider and its number: the setting's name. */
  label: { type: String, required: false, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const clamp = (/** @type {number} */ v, /** @type {number} */ min, /** @type {number} */ max) =>
  Math.min(Math.max(v, min), max)

const sliderValue = computed({
  get: () => clamp(props.modelValue, props.sliderMin ?? props.min, props.sliderMax ?? props.max),
  set: v =>
    emit('update:modelValue', clamp(v, props.sliderMin ?? props.min, props.sliderMax ?? props.max)),
})

const inputValue = computed({
  get: () => clamp(props.modelValue, props.min, props.max),
  set: v => emit('update:modelValue', v),
})
</script>

<style scoped>
/* Remove the custom slider handle */
:deep(.custom-slider .p-slider-handle > span) {
  display: none !important;
}
:deep(.custom-slider .p-slider-handle::before),
:deep(.custom-slider .p-slider-handle::after) {
  content: none !important;
}
</style>
