<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    :stroke="color"
    stroke-width="2"
    stroke-linecap="round"
    class="icon-search"
  >
    <!-- A glass held over a page: the search across the project. -->
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5 21 21" stroke-width="2.5" />
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
