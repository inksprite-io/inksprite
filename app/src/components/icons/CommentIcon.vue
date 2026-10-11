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
    class="icon-comment"
  >
    <!-- A bubble drawn in outline, so it does not read as the chats' filled
         one, with a line in it marked as a commented passage is. -->
    <path
      d="M5 3.5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z"
    />
    <rect x="7" y="8.5" width="10" height="4" rx="1" :fill="color" stroke="none" />
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
