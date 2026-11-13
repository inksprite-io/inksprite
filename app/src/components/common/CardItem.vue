<template>
  <!-- The last one open draws no line of its own over the box's. -->
  <div class="[&:last-child>[data-card-body]]:border-b-0" data-card-item>
    <div class="flex items-center" :class="headerClass">
      <!-- Something of its own beside it, not opening it: a profile's star. -->
      <div v-if="$slots.leading" class="flex-none pl-1">
        <slot name="leading" />
      </div>
      <button
        type="button"
        class="flex-1 min-w-0 flex items-center gap-3 py-2 min-h-14 text-left text-sm border-0 bg-transparent cursor-pointer"
        :class="$slots.leading ? 'pl-1 pr-3' : 'px-3'"
        :aria-expanded="expandable ? open : undefined"
        :aria-current="active || undefined"
        data-card-toggle
        @click="emit('toggle')"
        @dblclick="emit('dblclick')"
      >
        <!-- Two lines, the second there whether or not it says anything, so
             every card is the same height; a third only for something wrong
             with it. -->
        <span class="flex flex-col min-w-0 flex-1">
          <span class="flex items-center gap-2 min-w-0">
            <span
              class="truncate"
              :class="
                active
                  ? 'text-primary-700 dark:text-primary-200'
                  : 'text-surface-800 dark:text-surface-100'
              "
              >{{ title }}</span
            >
            <slot name="badges" />
          </span>
          <span class="min-h-4 truncate text-xs text-surface-500 dark:text-surface-400">
            <slot name="subtitle">{{ subtitle }}</slot>
          </span>
          <slot name="notes" />
        </span>
        <span
          v-if="$slots.meta"
          class="flex-none flex flex-col items-end text-xs text-surface-500 dark:text-surface-400"
        >
          <slot name="meta" />
        </span>
      </button>
      <!-- A button of its own at its end, where a click on the card does
           something other than open it: a model's settings. -->
      <div v-if="$slots.trailing" class="flex-none pr-1">
        <slot name="trailing" />
      </div>
    </div>
    <!-- What has to be done before it can be opened to any use: signing in. -->
    <div v-if="$slots.after" class="px-3 pb-2">
      <slot name="after" />
    </div>
    <div
      v-if="open && $slots.default"
      class="flex flex-col gap-3 px-3 pt-2 pb-3 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40"
      data-card-body
    >
      <slot />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

/**
 * One card in a `CardList`, as the model list has them: a name, a line under
 * it, and what can be said of it in a few words on the right; the one in use
 * tinted, and the one open with what it holds below it. Every list of things
 * in the settings is made of these.
 *
 * @typedef {Object} Props
 * @property {string} title
 * @property {string} [subtitle] - The line under it; `#subtitle` for more than words
 * @property {boolean} [active] - The one in use: a chat's model or profile, the web search service
 * @property {boolean} [open] - Whether what it holds shows
 * @property {boolean} [expandable] - Whether it opens, for a screen reader to say so
 */
const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  active: { type: Boolean, default: false },
  open: { type: Boolean, default: false },
  expandable: { type: Boolean, default: true },
})

/** `toggle`: clicked, to open or shut, or choose. `dblclick`: clicked twice, to take at once. */
const emit = defineEmits(['toggle', 'dblclick'])

const headerClass = computed(() => {
  if (props.active) return 'bg-primary-50 dark:bg-primary-900/40'
  if (props.open) return 'bg-surface-50 dark:bg-surface-900/40'
  return 'hover:bg-surface-100 dark:hover:bg-surface-800'
})
</script>
