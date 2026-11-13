<template>
  <CardItem
    :title="name"
    :active="active"
    :open="open"
    data-connection-card
    @toggle="emit('toggle')"
  >
    <template #badges>
      <slot name="badges" />
    </template>
    <template #subtitle>
      <span v-if="address" data-connection-address>{{ address }}</span>
    </template>
    <template v-if="$slots.notes" #notes>
      <slot name="notes" />
    </template>
    <template v-if="status" #meta>
      <span class="flex items-center gap-1.5" :data-status="tone">
        <span v-if="tone === 'bad'" class="w-2 h-2 rounded-full bg-red-500" aria-hidden="true" />
        {{ status }}
      </span>
    </template>
    <template v-if="$slots.after" #after>
      <slot name="after" />
    </template>
    <div class="flex flex-col gap-3" data-connection-body>
      <slot />
    </div>
  </CardItem>
</template>

<script setup>
import CardItem from '@/components/common/CardItem.vue'

/**
 * One connection, as Settings › Connections lists every kind of them, AI,
 * web search and MCP servers alike: its name, its address, and what is wrong
 * with it, where something is, a click from its settings, which open in the
 * card. One that answered says nothing of it: every connection would. A card
 * of a `CardList`, as every list in the settings is.
 *
 * @typedef {Object} Props
 * @property {string} name
 * @property {string} [address] - Where it answers, as a host or an address
 * @property {string} [status] - What is wrong with it, or why it can't be used
 *   here, in words
 * @property {'bad'|'neutral'} [tone] - A red dot beside the status for
 *   something wrong, none for something that only is
 * @property {boolean} [open] - Whether its settings show
 * @property {boolean} [active] - Marked as the one in use, where one is
 */
defineProps({
  name: { type: String, required: true },
  address: { type: String, default: '' },
  status: { type: String, default: '' },
  tone: { type: String, default: 'bad' },
  open: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
})

/** `toggle`: its settings asked to open or shut. */
const emit = defineEmits(['toggle'])
</script>
