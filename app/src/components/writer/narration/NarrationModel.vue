<template>
  <div class="flex flex-col gap-3">
    <AiProviderSelector
      kind="speech"
      :selected-provider-id="choice.providerId"
      @update:selected-provider-id="pickProvider"
    />
    <AiModelSelector
      kind="speech"
      :selected-provider-id="choice.providerId"
      :selected-model-id="choice.model"
      @update:selected-model-id="$emit('choose', { model: $event })"
    />
  </div>
</template>

<script setup>
import { watch } from 'vue'
import AiModelSelector from '../settings/ai/AiModelSelector.vue'
import AiProviderSelector from '../settings/ai/AiProviderSelector.vue'
import { useModelLists } from '@/composables/useModelLists'

/**
 * What the project is read aloud through: one of the connections that
 * speaks, and its model. The connection is edited in the dialog behind ⋮, as
 * from the AI settings.
 *
 * @typedef {Object} Props
 * @property {import('@/composables/useApplicationState.js').NarrationChoice} choice
 */
const props = defineProps({
  choice: { type: Object, required: true },
})

const emit = defineEmits(['choose'])

const modelLists = useModelLists()

/** @param {string|null} providerId */
const pickProvider = providerId => {
  if (providerId !== props.choice.providerId) emit('choose', { providerId, model: null })
}

// A connection that reads with one model, as Kokoro-FastAPI does, has it
// picked once its list is in.
watch(
  () => {
    const id = props.choice.providerId
    return !props.choice.model && id ? modelLists.listOf(id, 'speech')?.models : undefined
  },
  models => {
    if (models?.length === 1) emit('choose', { model: models[0].id })
  },
  { immediate: true }
)
</script>
