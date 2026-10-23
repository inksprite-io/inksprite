<template>
  <section class="flex flex-col gap-3" :data-workflow="name">
    <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">
      {{ title }}
    </h3>
    <AiProviderSelector
      :selected-provider-id="settings.providerId"
      @update:selected-provider-id="pick({ providerId: $event, model: null })"
    />
    <AiModelSelector
      :selected-provider-id="settings.providerId"
      :selected-model-id="settings.model"
      @update:selected-model-id="pick({ model: $event })"
    />
    <AiModelUpstreams
      v-if="routesProviders"
      :upstreams="settings"
      :model="settings.model || ''"
      @update="pick"
    />
    <div v-if="effortOptions.length > 1" class="flex flex-col gap-1">
      <SettingLabel label="Reasoning effort" />
      <Select
        :input-id="`workflow-${name}-effort`"
        aria-label="Reasoning effort"
        :model-value="effort"
        :options="effortOptions"
        option-label="label"
        option-value="value"
        class="w-full dark:!bg-surface-900"
        size="small"
        @update:model-value="pick({ reasoningEffort: $event })"
      />
    </div>
    <slot :settings="settings" :pick="pick" />
  </section>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import Select from 'primevue/select'
import SettingLabel from '@/components/common/SettingLabel.vue'
import AiModelSelector from './ai/AiModelSelector.vue'
import AiProviderSelector from './ai/AiProviderSelector.vue'
import AiModelUpstreams from './ai/AiModelUpstreams.vue'
import { AI_DEFAULTS, REASONING_EFFORT_OPTIONS, resolveAISettings } from '@/ai/defaults.js'
import { fitEffort } from '@/ai/capabilities.js'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'
import { useModelCapabilities } from '@/composables/useModelCapabilities'

/**
 * Which provider, model, allowed and ignored providers and reasoning effort
 * one workflow runs on, apart from the chat's. Laid out like the AI section,
 * with the same controls, so the two read alike. A workflow takes what it has
 * not been given from the active preset the first time this opens — provider
 * and model with the providers allowed and ignored for it, and the preset's
 * effort — and is its own from then on. What only one workflow has goes in
 * the slot, which is handed the settings and the way to change them.
 */

const props = defineProps({
  /** The workflow, by its name in the application state's `workflows`. */
  name: { type: String, required: true },
  title: { type: String, required: true },
})

const aiConfig = useAIConfig()
const { workflows, setWorkflow } = useApplicationState()

const settings = computed(() => workflows.value[props.name] || {})
const routesProviders = computed(
  () => aiConfig.getProvider(settings.value.providerId)?.type === 'openrouter'
)

// Only the efforts the workflow's model takes, showing the one it is sent.
const capabilities = useModelCapabilities(
  () => settings.value.providerId,
  () => settings.value.model
)
const effortOptions = computed(() =>
  REASONING_EFFORT_OPTIONS.filter(option => capabilities.value.efforts.includes(option.value))
)
const effort = computed(() =>
  fitEffort(settings.value.reasoningEffort || AI_DEFAULTS.reasoningEffort, capabilities.value)
)

/** @param {Partial<import('@/types/models.js').WorkflowSettings>} patch */
const pick = patch => setWorkflow(props.name, patch)

onMounted(() => {
  const preset = aiConfig.activeAIPreset.value
  if (!preset) return
  /** @type {Partial<import('@/types/models.js').WorkflowSettings>} */
  const patch = {}
  if (!settings.value.providerId && preset.providerId) {
    patch.providerId = preset.providerId
    patch.model = preset.model || null
    // The providers allowed and ignored for that model come with it.
    if (preset.allowedProviders?.length) patch.allowedProviders = [...preset.allowedProviders]
    if (preset.ignoredProviders?.length) patch.ignoredProviders = [...preset.ignoredProviders]
  }
  // Unset, a request asks for the app's default effort; the preset's is what
  // the writer chose, and what the menu should start from.
  if (!settings.value.reasoningEffort) {
    patch.reasoningEffort = resolveAISettings(preset.generationOverrides).reasoningEffort
  }
  if (Object.keys(patch).length) pick(patch)
})
</script>
