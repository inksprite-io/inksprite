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
    <AiModelUpstreams
      v-if="routesProviders"
      :upstreams="shownPreset"
      :model="selectedModelId || ''"
      @update="handleUpstreamsChange"
    />
    <AiGenerationGroup />
    <AiSamplingGroup />
  </div>
</template>

<script setup>
/**
 * An AI preset: what a request runs on — which provider, which model, and how
 * it generates. The one Settings › AI shows, which a chat's settings can ask
 * it to: the only place a preset is edited, since every chat on it runs as it
 * says. A chat only picks one.
 *
 * Not a chat profile (`ai/profiles/index.js`), which is how a chat is run.
 */
import { computed } from 'vue'
import AiPresetSelector from './AiPresetSelector.vue'
import AiProviderSelector from './AiProviderSelector.vue'
import AiModelSelector from './AiModelSelector.vue'
import AiModelUpstreams from './AiModelUpstreams.vue'
import AiGenerationGroup from './AiGenerationGroup.vue'
import AiSamplingGroup from './AiSamplingGroup.vue'
import { useAIConfig } from '@/composables/useAIConfig'

const aiConfig = useAIConfig()

const shownPreset = computed(() => aiConfig.shownPreset.value)
const selectedProviderId = computed(() => shownPreset.value?.providerId || null)
const selectedModelId = computed(() => shownPreset.value?.model || null)
const routesProviders = computed(
  () => aiConfig.getProvider(selectedProviderId.value)?.type === 'openrouter'
)

const handleProviderChange = providerId => {
  if (!shownPreset.value) return
  aiConfig.updatePreset(shownPreset.value.id, { providerId })
}

const handleModelChange = modelId => {
  if (!shownPreset.value) return
  aiConfig.updatePreset(shownPreset.value.id, { model: modelId })
}

/** @param {import('@/ai/routing.js').ModelUpstreams} patch - The list that changed */
const handleUpstreamsChange = patch => {
  if (!shownPreset.value) return
  aiConfig.updatePreset(shownPreset.value.id, patch)
}
</script>
