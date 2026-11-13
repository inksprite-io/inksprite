<template>
  <div class="flex flex-col gap-1" data-model-settings>
    <AiGenerationGroup :provider-id="providerId" :model="model" />
    <AiSamplingGroup :provider-id="providerId" :model="model" />
    <ExpandableSection
      v-if="routes"
      title="Providers"
      storage-key="ui.model.providers"
      subsection
      content-wrapper-class="flex flex-col"
    >
      <div class="pt-2 pb-1">
        <AiModelUpstreams
          :upstreams="run"
          :stored="stored"
          :model="model"
          :service="service"
          :zdr-only="zdrOnly"
          @update="change"
        />
      </div>
    </ExpandableSection>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import AiGenerationGroup from '../settings/ai/AiGenerationGroup.vue'
import AiSamplingGroup from '../settings/ai/AiSamplingGroup.vue'
import AiModelUpstreams from '../settings/ai/AiModelUpstreams.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useAIService } from '@/composables/useAIService'
import { resolveRouting } from '@/ai/routing.js'

/**
 * A model's settings on a connection: how long a reply may be and how it
 * writes, its samplers, and on OpenRouter and NanoGPT the providers that
 * serve it, on NanoGPT once it has said they can be chosen for it. They
 * are the model's, so a change reaches every chat on it. Kept the first time
 * one is changed, and only the changes.
 *
 * @typedef {Object} Props
 * @property {string} providerId
 * @property {string} model
 */
const props = defineProps({
  providerId: { type: String, required: true },
  model: { type: String, required: true },
})

const aiConfig = useAIConfig()
const aiService = useAIService()

/** What the model runs with now. */
const run = computed(() => aiConfig.runOn(props.providerId, props.model))
/** The writer's changes, where there are any. */
const stored = computed(() => aiConfig.settingsOf(props.providerId, props.model))
const connection = computed(() => aiConfig.getProvider(props.providerId))
/** The service whose providers serve the model, where there are any to choose. */
const service = computed(() => {
  const type = connection.value?.type
  return type === 'openrouter' || type === 'nanogpt' ? type : null
})
/** Whether NanoGPT lets this model's providers be chosen; unknown until it says. */
const nanoGptSelectable = ref(false)
watch(
  () => (service.value === 'nanogpt' ? props.model : null),
  async model => {
    nanoGptSelectable.value = false
    if (!model) return
    try {
      const { selectable } = await aiService.listNanoGptProviders(model)
      if (model === props.model) nanoGptSelectable.value = selectable
    } catch (error) {
      console.error(`Failed to ask NanoGPT about the providers of ${model}:`, error)
    }
  },
  { immediate: true }
)
/** Whether its providers are the writer's to choose. */
const routes = computed(
  () => service.value === 'openrouter' || (service.value === 'nanogpt' && nanoGptSelectable.value)
)
/** NanoGPT: whether the connection asks for zero data retention, so only providers keeping nothing serve. */
const zdrOnly = computed(
  () => service.value === 'nanogpt' && resolveRouting(connection.value?.routing).zdr
)

/** @param {Partial<import('@/types/models.js').AIPreset>} patch */
const change = patch => aiConfig.changeModelSettings(props.providerId, props.model, patch)
</script>
