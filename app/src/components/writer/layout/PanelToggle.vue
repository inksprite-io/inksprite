<template>
  <HeaderButton
    :icon="icon"
    :label="label"
    :aria-pressed="!showing"
    :data-panel-toggle="panel"
    @click="$emit('toggle')"
  />
</template>

<script setup>
import { computed } from 'vue'
import HeaderButton from './HeaderButton.vue'

/**
 * The button at the edge of a panel's header that takes the neighbouring
 * panel's room, and gives it back. It is named for what a press brings
 * forward: this panel, spread over the neighbour's room (Expand chat), and
 * then the neighbour, back beside it (Show editor). Pressed means this panel
 * is the one spread out. The chevrons point the way the panel's edge moves.
 *
 * @typedef {Object} Props
 * @property {'editor'|'chat'} panel - The neighbour it shows and hides; the
 *   panel it sits in is the other one
 * @property {boolean} showing - Whether the neighbour is on screen
 * @property {'left'|'right'} side - Which side of this panel the neighbour is on
 */
const props = defineProps({
  panel: { type: String, required: true },
  showing: { type: Boolean, required: true },
  side: { type: String, required: true },
})

defineEmits(['toggle'])

/** The panel the toggle sits in, beside the neighbour. */
const OWN = { chat: 'editor', editor: 'chat' }

const label = computed(() => (props.showing ? `Expand ${OWN[props.panel]}` : `Show ${props.panel}`))

// Toward the neighbour to push it off, and back the other way to let it in.
const icon = computed(() => {
  const toward = props.side === 'right' ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'
  const away = props.side === 'right' ? 'pi pi-angle-double-left' : 'pi pi-angle-double-right'
  return props.showing ? toward : away
})
</script>
