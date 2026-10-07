<template>
  <div class="flex flex-col px-2 pt-2 pb-1">
    <section class="flex flex-col gap-3" data-workflow="convert">
      <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">
        Convert to Markdown
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
      <AiAllowedProviders
        v-if="routesProviders"
        :model-value="settings.allowedProviders"
        :model="settings.model || ''"
        @update:model-value="pick({ allowedProviders: $event })"
      />
      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Reasoning Effort"
          description="How much extended thinking to request. OpenRouter providers only."
        />
        <Select
          input-id="workflow-convert-effort"
          :model-value="settings.reasoningEffort || AI_DEFAULTS.reasoningEffort"
          :options="REASONING_EFFORT_OPTIONS"
          option-label="label"
          option-value="value"
          class="w-full dark:!bg-surface-900"
          size="small"
          @update:model-value="pick({ reasoningEffort: $event })"
        />
      </div>
      <div class="flex items-center justify-between gap-2">
        <label
          for="workflow-convert-on-import"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >
          Convert documents on import
        </label>
        <ToggleSwitch
          input-id="workflow-convert-on-import"
          :model-value="settings.onImport === true"
          class="flex-none"
          @update:model-value="pick({ onImport: $event })"
        />
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import SettingLabel from '@/components/common/SettingLabel.vue'
import AiModelSelector from './ai/AiModelSelector.vue'
import AiProviderSelector from './ai/AiProviderSelector.vue'
import AiAllowedProviders from './ai/AiAllowedProviders.vue'
import { AI_DEFAULTS, REASONING_EFFORT_OPTIONS, resolveAISettings } from '@/ai/defaults.js'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'

/**
 * Which provider, model, allowed providers and reasoning effort each workflow
 * runs on, apart from the chat's. Laid out like the AI section, with the same controls, so the
 * two read alike. A workflow takes what it has not been given from the active
 * preset the first time this opens — provider and model with the providers
 * allowed to serve it, and the preset's effort — and is its own from then on.
 */

const aiConfig = useAIConfig()
const { workflows, setWorkflow } = useApplicationState()

const settings = computed(() => workflows.value.convert || {})
const routesProviders = computed(
  () => aiConfig.getProvider(settings.value.providerId)?.type === 'openrouter'
)

/** @param {Partial<import('@/types/models.js').WorkflowSettings>} patch */
const pick = patch => setWorkflow('convert', patch)

onMounted(() => {
  const preset = aiConfig.activeAIPreset.value
  if (!preset) return
  /** @type {Partial<import('@/types/models.js').WorkflowSettings>} */
  const patch = {}
  if (!settings.value.providerId && preset.providerId) {
    patch.providerId = preset.providerId
    patch.model = preset.model || null
    // The providers allowed to serve that model come with it.
    if (preset.allowedProviders?.length) patch.allowedProviders = [...preset.allowedProviders]
  }
  // Unset, a request asks for the app's default effort; the preset's is what
  // the writer chose, and what the menu should start from.
  if (!settings.value.reasoningEffort) {
    patch.reasoningEffort = resolveAISettings(preset.generationOverrides).reasoningEffort
  }
  if (Object.keys(patch).length) pick(patch)
})
</script>
