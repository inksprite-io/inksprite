<template>
  <div
    class="rounded-lg border border-surface-200 dark:border-surface-700"
    :class="scrolls ? 'overflow-y-auto' : 'overflow-hidden'"
    data-card-list
  >
    <slot />
  </div>
</template>

<script setup>
/**
 * A list of cards (`CardItem`) in one box, as the model list is, with
 * headings (`CardHeading`) between its groups where it has any. A list with
 * nothing in it isn't shown at all: no empty box, and no group heading over
 * nothing.
 *
 * @typedef {Object} Props
 * @property {boolean} [scrolls] - Whether it scrolls on its own, in a height its holder gives it
 */
defineProps({
  scrolls: { type: Boolean, default: false },
})
</script>
