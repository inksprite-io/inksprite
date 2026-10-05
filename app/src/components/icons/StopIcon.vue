<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 1200 1200"
    xmlns="http://www.w3.org/2000/svg"
    :fill="color"
    class="icon-stop"
  >
    <path
      d="m150 0h900c82.844 0 150 82.844 150 150v900c0 82.844-67.156 150-150 150h-900c-82.844 0-150-82.844-150-150v-900c0-82.844 67.156-150 150-150z"
    />
  </svg>
</template>

<script setup>
// "Stop" by Isma Ruiz from the Noun Project, under CC BY 3.0:
// https://thenounproject.com/icon/569575/ (listed in config/credits.js).

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
