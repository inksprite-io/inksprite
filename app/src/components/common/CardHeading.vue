<template>
  <div
    class="px-3 py-1 text-xs font-semibold text-surface-500 dark:text-surface-400 bg-surface-50 dark:bg-surface-900 border-surface-200 dark:border-surface-700 [&:not(:first-child)]:border-t"
    :class="{ 'sticky top-0 z-10': sticky }"
  >
    <slot />
  </div>
</template>

<script setup>
/**
 * A heading between the groups of a `CardList`: Recommended, or a
 * connection's name, in the model list. Kept in view while its group scrolls
 * past, in a list that scrolls on its own.
 *
 * @typedef {Object} Props
 * @property {boolean} [sticky]
 */
defineProps({
  sticky: { type: Boolean, default: false },
})
</script>
