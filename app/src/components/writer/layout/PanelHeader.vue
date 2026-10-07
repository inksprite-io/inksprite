<template>
  <!-- The height of the editor's tab strip and the chat's header, so the
       three run in one band across the top of the window. -->
  <div
    class="w-full h-9 flex-none flex items-center gap-1 px-1 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 select-none"
  >
    <h2 v-if="title" class="flex-1 min-w-0 truncate px-2 text-sm font-semibold">{{ title }}</h2>
    <div v-else class="flex-1" />
    <slot />
  </div>
</template>

<script setup>
/**
 * The header of a list in the sidebar: what it is, and the buttons for it
 * at the end. See `HeaderButton`.
 *
 * @typedef {Object} Props
 * @property {string} [title] - None, and the buttons have the strip to themselves
 */
defineProps({
  title: { type: String, default: '' },
})
</script>
