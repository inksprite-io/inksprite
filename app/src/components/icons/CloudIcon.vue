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
    stroke-linejoin="round"
    class="icon-cloud"
  >
    <path d="M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 5.6 8.6 5.2 5.2 0 0 0 7 19z" />
  </svg>
</template>

<script setup>
/**
 * The Sync and sharing settings' icon: a cloud.
 *
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
