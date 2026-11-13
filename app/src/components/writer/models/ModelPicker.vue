<template>
  <ModelList
    class="min-h-0 h-full"
    :provider-ids="connectionIds"
    :choice="{ providerId, model }"
    :tint="tint"
    data-model-picker
    @update:choice="emit('update:choice', $event)"
    @use="emit('use', $event)"
  >
    <template #chosen="{ model: chosen }">
      <div class="flex flex-col gap-3">
        <slot name="chosen" :model="chosen" />
        <ModelSettings :provider-id="chosen.providerId" :model="chosen.id" />
      </div>
    </template>
  </ModelList>
</template>

<script setup>
import { computed } from 'vue'
import ModelList from './ModelList.vue'
import ModelSettings from './ModelSettings.vue'
import { useConnections } from '@/composables/useConnections.js'

/**
 * Choosing and tuning a model in one place: the models of the writer's
 * connections, each saying which serves it, and the one chosen opening on
 * its settings, with whatever its holder puts above them (`#chosen`).
 *
 * @typedef {Object} Props
 * @property {string|null} [providerId] - The connection shown
 * @property {string|null} [model] - The model chosen on it
 * @property {boolean} [tint] - Whether the chosen one is marked as in use
 */
defineProps({
  providerId: { type: String, default: null },
  model: { type: String, default: null },
  tint: { type: Boolean, default: true },
})

/**
 * `update:choice`: `{providerId, model}`, a model clicked. `use`: one
 * double-clicked, to take at once.
 */
const emit = defineEmits(['update:choice', 'use'])

const connections = useConnections()

/** The writer's connections that chat, whose models are listed. */
const connectionIds = computed(() => connections.connectionsFor('chat').map(one => one.id))
</script>
