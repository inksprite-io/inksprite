<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 1200 1200"
    xmlns="http://www.w3.org/2000/svg"
    :fill="color"
    class="icon-plus"
  >
    <path
      d="m43.918 674.38v-150.18c0-38.254 31.168-69.422 70.84-69.422h340.02v-340.02c0-39.668 31.168-70.84 69.422-70.84h150.18c39.668 0 70.84 31.168 70.84 70.84v340.02h340.02c38.254 0 70.84 31.168 70.84 69.422v150.18c0 39.668-32.586 70.84-70.84 70.84h-340.02v340.02c0 38.254-31.168 70.84-70.84 70.84h-150.18c-38.254 0-69.422-32.586-69.422-70.84v-340.02h-340.02c-39.668 0-70.84-31.168-70.84-70.84z"
      fill-rule="evenodd"
    />
  </svg>
</template>

<script setup>
// "Plus" by sumhi_icon from the Noun Project, under CC BY 3.0:
// https://thenounproject.com/icon/1809808/ (listed in config/credits.js).

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
