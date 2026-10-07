<template>
  <button
    v-tooltip.bottom="label"
    type="button"
    class="flex-none w-7 h-7 rounded flex items-center justify-center text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-default"
    :aria-label="label"
    :disabled="loading"
    :aria-busy="loading || undefined"
    @click="$emit('click', $event)"
  >
    <i :class="loading ? 'pi pi-spin pi-spinner' : icon" style="font-size: 0.75rem"></i>
  </button>
</template>

<script setup>
/**
 * A small icon button in a panel's header: the editor's tab strip, the
 * chat's header, the sidebar's lists. Its label is its tooltip and its name.
 *
 * @typedef {Object} Props
 * @property {string} icon - A PrimeIcons class, `pi pi-plus`
 * @property {string} label
 * @property {boolean} [loading] - Busy: a spinner in place of the icon, and no clicks
 */
defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  loading: { type: Boolean, default: false },
})

defineEmits(['click'])
</script>
