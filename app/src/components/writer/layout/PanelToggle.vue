<template>
  <button
    v-tooltip.bottom="label"
    type="button"
    class="flex-none w-7 h-7 rounded flex items-center justify-center text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
    :aria-label="label"
    :aria-pressed="!showing"
    :data-panel-toggle="panel"
    @click="$emit('toggle')"
  >
    <i :class="icon" style="font-size: 0.75rem"></i>
  </button>
</template>

<script setup>
import { computed } from 'vue'

/**
 * The button at the edge of a panel's header that takes the neighbouring
 * panel's room, and gives it back. It stands for the neighbour: press it and
 * the neighbour goes, so this panel has the width; press it again and the
 * neighbour is back. Pressed means this panel is the one spread out. The
 * chevrons point the way the panel's edge moves.
 *
 * @typedef {Object} Props
 * @property {'editor'|'chat'} panel - The neighbour it shows and hides
 * @property {boolean} showing - Whether the neighbour is on screen
 * @property {'left'|'right'} side - Which side of this panel the neighbour is on
 */
const props = defineProps({
  panel: { type: String, required: true },
  showing: { type: Boolean, required: true },
  side: { type: String, required: true },
})

defineEmits(['toggle'])

const label = computed(() => `${props.showing ? 'Hide' : 'Show'} ${props.panel}`)

// Toward the neighbour to push it off, and back the other way to let it in.
const icon = computed(() => {
  const toward = props.side === 'right' ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'
  const away = props.side === 'right' ? 'pi pi-angle-double-left' : 'pi pi-angle-double-right'
  return props.showing ? toward : away
})
</script>
