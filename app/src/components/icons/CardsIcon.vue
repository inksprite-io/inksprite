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
    stroke-linecap="round"
    class="icon-cards"
  >
    <!-- A card with a portrait on it, and the edge of another behind. -->
    <path d="M4 7v11a3 3 0 0 0 3 3h8" />
    <rect x="8" y="2.5" width="12.5" height="16" rx="2" />
    <circle cx="14.25" cy="8.5" r="2.25" :fill="color" stroke="none" />
    <path d="M10.5 15.25a3.75 3.25 0 0 1 7.5 0z" :fill="color" stroke="none" />
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
