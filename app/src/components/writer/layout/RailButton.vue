<template>
  <!-- A button, so the keyboard reaches it and a screen reader hears its
       name. Disabled is said rather than set: a disabled button cannot be
       hovered for its tooltip, which is the one thing left to learn from it. -->
  <button
    v-tooltip.right="tooltip"
    type="button"
    class="flex items-center justify-center p-3 w-full text-surface-contrast duration-150 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
    :class="[
      disabled
        ? 'cursor-default'
        : 'cursor-pointer hover:bg-primary-200 hover:dark:bg-primary-emphasis',
      { 'bg-surface-300 dark:bg-surface-500': active, 'opacity-50': dimmed },
    ]"
    :aria-label="tooltip"
    :aria-disabled="disabled || undefined"
    :aria-pressed="toggle ? active : undefined"
    @click="!disabled && $emit('click')"
  >
    <span class="relative flex">
      <slot />
      <span
        v-if="badge"
        class="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-primary-500 text-white text-[10px] leading-4 text-center font-semibold"
        data-rail-badge
      >
        {{ badge }}
      </span>
    </span>
  </button>
</template>

<script setup>
/**
 * One button on the navigation rail.
 *
 * @typedef {Object} Props
 * @property {string} tooltip - Also its name, for anyone who cannot see the icon
 * @property {boolean} [active] - Drawn pressed: the panel it stands for is showing
 * @property {boolean} [dimmed] - Drawn faded: the panel it stands for is hidden
 * @property {boolean} [disabled] - Shown but inert
 * @property {boolean} [toggle] - Stands for something that is on or off, and says which
 * @property {number} [badge] - A count to show on the icon; nothing when zero
 */
defineProps({
  tooltip: { type: String, required: true },
  active: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  toggle: { type: Boolean, default: false },
  badge: { type: Number, default: 0 },
})

defineEmits(['click'])
</script>
