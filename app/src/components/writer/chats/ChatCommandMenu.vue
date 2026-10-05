<template>
  <div
    :id="id"
    ref="list"
    role="listbox"
    aria-label="Commands"
    class="max-h-72 overflow-y-auto rounded-2xl p-1 shadow-lg bg-surface-0 dark:bg-surface-900 border border-surface-200 dark:border-surface-700"
  >
    <!-- Never taking the field's focus: a press on a row has its default
         stopped, so the caret stays where the writer left it for the pick
         to put the name back in front of. -->
    <div
      v-for="(entry, index) in entries"
      :id="commandOptionId(id, entry.name)"
      :key="entry.name"
      role="option"
      :aria-selected="index === active"
      :data-command="entry.name"
      class="flex flex-col gap-0.5 px-3 py-1.5 rounded-xl cursor-pointer"
      :class="index === active ? 'bg-surface-100 dark:bg-surface-800' : ''"
      @mousedown.prevent
      @click="emit('pick', index)"
      @mousemove="index === active || emit('hover', index)"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-sm truncate">
          <span class="font-medium text-surface-800 dark:text-surface-100">/{{ entry.name }}</span>
          <span class="text-surface-500 dark:text-surface-400">{{ argumentsOf(entry) }}</span>
        </span>
        <i
          v-if="entry.consults"
          v-tooltip.top="'Calls the model'"
          class="pi pi-sparkles ml-auto flex-none text-xs text-surface-400"
          data-consults
          aria-label="Calls the model"
        />
      </div>
      <!-- Two lines at most, rather than one: a chat panel is narrow, and a
           sentence cut off at "as a direction to fol…" has lost its point. -->
      <span class="text-xs text-surface-500 dark:text-surface-400 line-clamp-2">
        {{ entry.description }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { commandOptionId } from '@/composables/useCommandMenu.js'

/**
 * The commands a slash could be starting, as a list to pick from. It shows
 * them and says which was picked; which one is highlighted, and what the keys
 * do, belong to the field it is under. See composables/useCommandMenu.js.
 */

/** @typedef {import('@/ai/commands.js').CommandEntry} CommandEntry */

const props = defineProps({
  /** The list's id, for the field's `aria-controls`. */
  id: { type: String, required: true },
  /** @type {import('vue').PropType<CommandEntry[]>} */
  entries: { type: Array, required: true },
  /** Which entry is highlighted. */
  active: { type: Number, default: 0 },
})

const emit = defineEmits(['pick', 'hover'])

const list = ref(/** @type {HTMLElement|null} */ (null))

/**
 * What its usage says after the name: the parentheses and the rest, which is
 * what the writer still has to type.
 *
 * @param {CommandEntry} entry
 * @returns {string}
 */
const argumentsOf = entry => entry.usage.slice(`/${entry.name}`.length)

// Arrowing past the bottom of what shows brings the next one into view. The
// highlight follows the mouse only when it moves, not when the list scrolls
// under a mouse that is standing still, or this would fight the keys.
watch(
  () => props.active,
  async index => {
    await nextTick()
    const row = list.value?.querySelector(`[data-command="${props.entries[index]?.name}"]`)
    row?.scrollIntoView?.({ block: 'nearest' })
  }
)
</script>
