<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 850 850"
    xmlns="http://www.w3.org/2000/svg"
    :fill="color"
    class="icon-full-screen"
  >
    <path
      d="M 50,350 C 22.5,350 0,327.5 0,300 V 100 C 0,45 45,0 100,0 h 200 c 27.5,0 50,22.5 50,50 0,27.5 -22.5,50 -50,50 H 100 v 200 c 0,27.5 -22.5,50 -50,50 z M 850,300 V 100 C 850,45 805,0 750,0 H 550 c -27.5,0 -50,22.5 -50,50 0,27.5 22.5,50 50,50 h 200 v 200 c 0,27.5 22.5,50 50,50 27.5,0 50,-22.5 50,-50 z M 350,800 c 0,-27.5 -22.5,-50 -50,-50 H 100 V 550 C 100,522.5 77.5,500 50,500 22.5,500 0,522.5 0,550 v 200 c 0,55 45,100 100,100 h 200 c 27.5,0 50,-22.5 50,-50 z M 850,750 V 550 c 0,-27.5 -22.5,-50 -50,-50 -27.5,0 -50,22.5 -50,50 V 750 H 550 c -27.5,0 -50,22.5 -50,50 0,27.5 22.5,50 50,50 h 200 c 55,0 100,-45 100,-100 z"
    />
  </svg>
</template>

<script setup>
// "Full Screen" by Ruben Semedo from the Noun Project, under CC BY 3.0:
// https://thenounproject.com/icon/446783/ (listed in config/credits.js).

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
