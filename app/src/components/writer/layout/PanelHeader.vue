<template>
  <!-- The height of the editor's tab strip, so the panels' headers run in one
       band across the top of the window. -->
  <div
    class="w-full h-9 flex-none flex items-center gap-1 px-1 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 select-none"
  >
    <slot name="start" />
    <h2
      v-if="title"
      :class="['flex-1 min-w-0 truncate text-sm font-semibold', $slots.start ? 'px-1' : 'px-2']"
    >
      {{ title }}
    </h2>
    <div v-else class="flex-1" />
    <slot />
  </div>
</template>

<script setup>
/**
 * The header of a panel: what it is, and the buttons for it at the end. See
 * `HeaderButton`. The chat and its settings put a way back at the start.
 *
 * @typedef {Object} Props
 * @property {string} [title] - None, and the buttons have the strip to themselves
 */
defineProps({
  title: { type: String, default: '' },
})
</script>
