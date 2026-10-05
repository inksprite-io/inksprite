<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 1049.995 997.1308"
    xmlns="http://www.w3.org/2000/svg"
    :fill="color"
    class="icon-chat-bubble"
  >
    <path
      d="M 956.25,0 H 93.75 C 41.953,0 0,41.953 0,93.75 v 562.5 c 0,24.844 9.8906,48.703 27.469,66.281 C 45.047,740.109 68.907,750 93.75,750 h 93.75 v 172.13 c 0.0937,30.188 18.281,57.375 46.125,69 9.0938,3.9844 18.938,6.0469 28.875,6 19.875,-0.094 38.859,-8.0625 52.875,-22.125 l 225,-225 h 415.87 c 24.844,0 48.703,-9.8906 66.281,-27.469 17.578,-17.5784 27.469,-41.438 27.469,-66.281 v -562.5 c 0,-24.844 -9.8906,-48.703 -27.469,-66.281 C 1004.9476,9.896 981.088,0.005 956.245,0.005 Z M 824.99,525 h -600 c -20.719,0 -37.5,-16.781 -37.5,-37.5 0,-20.719 16.781,-37.5 37.5,-37.5 h 600 c 20.719,0 37.5,16.781 37.5,37.5 0,20.719 -16.781,37.5 -37.5,37.5 z m 0,-225 h -600 c -20.719,0 -37.5,-16.781 -37.5,-37.5 0,-20.719 16.781,-37.5 37.5,-37.5 h 600 c 20.719,0 37.5,16.781 37.5,37.5 0,20.719 -16.781,37.5 -37.5,37.5 z"
    />
  </svg>
</template>

<script setup>
// "chat" by Dwi ridwanto from the Noun Project, under CC BY 3.0:
// https://thenounproject.com/icon/8004645/ (listed in config/credits.js).

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
