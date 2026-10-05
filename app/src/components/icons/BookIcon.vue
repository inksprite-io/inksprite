<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 1200 1200"
    xmlns="http://www.w3.org/2000/svg"
    :fill="color"
    class="icon-book"
  >
    <path
      d="m66.672 932.7c207.42 0 340.75 33.336 422.23 66.672h-488.9v-666.67h66.672zm66.66-732.06c317.32 12.203 433.33 122.16 433.33 122.16v639.24c-75.816-40.273-210.31-86.977-433.33-94.859zm133.33 178.21c87.109 11.664 152.87 29.746 200 48.18v-71.16c-50.988-17.641-117.06-33.719-200-44.27zm0 200c87.109 11.652 152.87 29.746 200 48.18v-71.16c-50.988-17.652-117.06-33.73-200-44.27zm0 199.99c87.109 11.664 152.87 29.762 200 48.191v-71.16c-50.988-17.652-117.06-33.73-200-44.27zm866.66-446.15v600c-207.41 0-340.75 33.336-422.23 66.672h488.9v-666.67zm-66.66 534.48c-223.02 7.8828-357.52 54.59-433.33 94.859v-639.25c1.0547-1.043 115.96-109.96 433.33-122.16zm-133.34-155.51c-82.871 10.488-148.95 26.566-199.99 44.219v71.16c47.258-18.422 113.02-36.527 199.99-48.191zm0-200c-82.871 10.488-148.95 26.566-199.99 44.219v71.16c47.258-18.422 113.02-36.527 199.99-48.18zm0-199.99c-82.871 10.488-148.95 26.555-199.99 44.207v71.16c47.258-18.422 113.02-36.516 199.99-48.18z"
    />
  </svg>
</template>

<script setup>
// "open book" by b farias from the Noun Project, under CC BY 3.0:
// https://thenounproject.com/icon/2762478/ (listed in config/credits.js).

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
