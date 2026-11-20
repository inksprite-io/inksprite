<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    :stroke="color"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="icon-terminal"
  >
    <!-- A prompt and its cursor. -->
    <path d="M2.5 4l4 4-4 4" />
    <path d="M8.5 12.5h5" />
  </svg>
</template>

<script setup>
// Drawn for inksprite, so it credits nobody (OWN_ICONS in config/credits.js).

/**
 * @typedef {Object} Props
 * @property {number} [size] - Icon size in pixels
 * @property {string} [color] - Icon color (CSS color or 'currentColor')
 */

/** @type {Props} */
defineProps({
  size: {
    type: Number,
    default: 24,
  },
  color: {
    type: String,
    default: 'currentColor',
  },
})
</script>
