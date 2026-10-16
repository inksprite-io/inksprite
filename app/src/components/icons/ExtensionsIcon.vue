<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    :stroke="color"
    stroke-width="2"
    stroke-linejoin="round"
    class="icon-extensions"
  >
    <!-- A puzzle piece: what fits into the app. -->
    <path d="M4.5 5.5h5a2.5 2.5 0 1 1 5 0h5v5a2.5 2.5 0 1 1 0 5v5h-15z" />
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
