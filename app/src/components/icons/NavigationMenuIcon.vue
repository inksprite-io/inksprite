<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 768 648"
    xmlns="http://www.w3.org/2000/svg"
    :fill="color"
    class="icon-navigation-menu"
  >
    <path
      d="M 636,0 H 132 C 96.992,0 63.418,13.906 38.66,38.66 13.906,63.418 0,96.992 0,132 v 384 c 0,35.008 13.906,68.582 38.66,93.34 C 63.418,634.094 96.992,648 132,648 h 504 c 35.008,0 68.582,-13.906 93.34,-38.66 C 754.094,584.582 768,551.008 768,516 V 132 C 768,96.992 754.094,63.418 729.34,38.66 704.582,13.906 671.008,0 636,0 Z M 472,552 H 132 c -9.5469,0 -18.703,-3.793 -25.457,-10.543 C 99.793,534.7031 96,525.547 96,516 V 132 c 0,-9.5469 3.793,-18.703 10.543,-25.457 C 113.2969,99.793 122.453,96 132,96 h 340 z"
    />
  </svg>
</template>

<script setup>
// "navigation menu" by Gregor Cresnar from the Noun Project, under CC BY 3.0:
// https://thenounproject.com/icon/5498011/ (listed in config/credits.js).

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
