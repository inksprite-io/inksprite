<template>
  <div class="flex flex-col gap-3">
    <AiPresetSelector />
    <AiProviderSelector
      :selected-provider-id="selectedProviderId"
      @update:selected-provider-id="handleProviderChange"
    />
    <AiModelSelector
      :selected-model-id="selectedModelId"
      :selected-provider-id="selectedProviderId"
      @update:selected-model-id="handleModelChange"
    />
    <AiAllowedProviders
      v-if="routesProviders"
      :model-value="activePreset?.allowedProviders"
      :model="selectedModelId || ''"
      @update:model-value="handleAllowedChange"
    />
    <AiGenerationGroup />
    <AiSamplingGroup />
  </div>
</template>

<script setup>
/**
 * An AI preset: what a request runs on — which provider, which model, and how
 * it generates.
 *
 * App-wide, not the chat's, and shown in both places it is wanted: in a chat's
 * settings, because that is where it is read and changed while writing, and in
 * the settings dialog, because a fresh install has no chat to open yet and the
 * provider has to be reachable before anything can run at all. One component
 * either way, so the two cannot drift.
 *
 * Not a chat profile (`ai/profiles/index.js`), which is how a chat is run.
 */
import { computed } from 'vue'
import AiPresetSelector from './AiPresetSelector.vue'
import AiProviderSelector from './AiProviderSelector.vue'
import AiModelSelector from './AiModelSelector.vue'
import AiAllowedProviders from './AiAllowedProviders.vue'
import AiGenerationGroup from './AiGenerationGroup.vue'
import AiSamplingGroup from './AiSamplingGroup.vue'
import { useAIConfig } from '@/composables/useAIConfig'

const aiConfig = useAIConfig()

const activePreset = computed(() => aiConfig.activeAIPreset.value)
const selectedProviderId = computed(() => activePreset.value?.providerId || null)
const selectedModelId = computed(() => activePreset.value?.model || null)
const routesProviders = computed(
  () => aiConfig.getProvider(selectedProviderId.value)?.type === 'openrouter'
)

const handleProviderChange = providerId => {
  if (!activePreset.value) return
  aiConfig.updatePreset(activePreset.value.id, { providerId })
}

const handleModelChange = modelId => {
  if (!activePreset.value) return
  aiConfig.updatePreset(activePreset.value.id, { model: modelId })
}

/** @param {string[]|undefined} allowedProviders */
const handleAllowedChange = allowedProviders => {
  if (!activePreset.value) return
  aiConfig.updatePreset(activePreset.value.id, { allowedProviders })
}
</script>
