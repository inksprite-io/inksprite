<template>
  <Dialog
    :visible="true"
    header="Choose a model"
    :modal="true"
    :draggable="false"
    class="w-[min(64rem,95vw)] h-[min(42rem,90vh)]"
    :pt="settingsLook('flex-1 min-h-0 flex flex-col')"
    data-model-picker-dialog
    @update:visible="open => open || emit('close')"
  >
    <ModelPicker
      class="flex-1 min-h-0"
      :provider-id="choice.providerId"
      :model="choice.model"
      @update:choice="choice = $event"
      @use="use"
    />
    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <Button label="Cancel" size="small" severity="secondary" text @click="emit('close')" />
        <Button
          label="Use"
          size="small"
          :disabled="!choice.providerId || !choice.model"
          data-action="use-model"
          @click="use(choice)"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
import { settingsLook } from '@/components/common/settingsLook.js'
import Button from 'primevue/button'
import ModelPicker from './ModelPicker.vue'
import { useConnections } from '@/composables/useConnections.js'

/**
 * The model picker in a dialog, with Use: for a chat, from its model menu or
 * its settings, and for Convert. Opens on the model in use, or with none on
 * the writer's first connection.
 *
 * @typedef {Object} Props
 * @property {string|null} [providerId] - The connection in use
 * @property {string|null} [model] - The model in use
 */
const props = defineProps({
  providerId: { type: String, default: null },
  model: { type: String, default: null },
})

/** `use`: `{providerId, model}`, the model to take. `close`: put away. */
const emit = defineEmits(['use', 'close'])

const connections = useConnections()

// On the model in use where its connection is the writer's, and otherwise on
// their first connection, with no model chosen yet.
const theirs = connections.connectionsFor('chat')
const onTheirs = Boolean(props.providerId) && theirs.some(one => one.id === props.providerId)

const choice = ref({
  providerId: onTheirs ? props.providerId : (theirs[0]?.id ?? null),
  model: onTheirs ? props.model : null,
})

/** @param {{providerId: string|null, model: string|null}} picked */
function use(picked) {
  if (!picked.providerId || !picked.model) return
  emit('use', { providerId: picked.providerId, model: picked.model })
  emit('close')
}
</script>
