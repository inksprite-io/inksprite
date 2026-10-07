<template>
  <ExpandableSection
    title="Generation"
    storage-key="ui.settings.ai-generation"
    subsection
    content-wrapper-class="flex flex-col"
  >
    <div class="flex flex-col gap-3 pt-2 pb-1">
      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Max Tokens"
          description="0 lets the provider decide."
          :overridden="isOverridden('maxTokens')"
          @reset="resetSettings(['maxTokens'])"
        />
        <CustomSlider
          :model-value="effective.maxTokens"
          :min="0"
          :max="Infinity"
          :slider-max="2000"
          :step="50"
          :fractional="false"
          @update:model-value="setSetting('maxTokens', $event)"
        />
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Reasoning Effort"
          description="Levels apply on OpenRouter only."
          :overridden="isOverridden('reasoningEffort')"
          @reset="resetSettings(['reasoningEffort'])"
        />
        <Select
          :model-value="effective.reasoningEffort"
          :options="REASONING_EFFORT_OPTIONS"
          option-label="label"
          option-value="value"
          class="w-full dark:!bg-surface-900"
          size="small"
          @update:model-value="setSetting('reasoningEffort', $event)"
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="Show Reasoning"
          :overridden="isOverridden('showModelReasoning')"
          @reset="resetSettings(['showModelReasoning'])"
        />
        <ToggleSwitch
          :model-value="effective.showModelReasoning"
          class="flex-none"
          @update:model-value="setSetting('showModelReasoning', $event)"
        />
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2">
          <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
            Allow Tool Use
          </label>
          <ToggleSwitch
            :model-value="toolsEnabled"
            class="flex-none"
            @update:model-value="setToolsEnabled"
          />
        </div>
        <p class="text-xs text-surface-500 dark:text-surface-400">
          Turn off for models without tool calling.
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Tool Rounds per Turn"
          description="0 means no limit."
          :overridden="isOverridden('maxToolRounds')"
          @reset="resetSettings(['maxToolRounds'])"
        />
        <CustomSlider
          :model-value="effective.maxToolRounds"
          :min="0"
          :max="Infinity"
          :slider-max="300"
          :step="10"
          :fractional="false"
          @update:model-value="setSetting('maxToolRounds', $event)"
        />
      </div>
    </div>
  </ExpandableSection>
</template>

<script setup>
import { computed } from 'vue'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import CustomSlider from './CustomSlider.vue'
import SettingLabel from '@/components/common/SettingLabel.vue'
import { useGenerationSettings } from '@/composables/useGenerationSettings'
import { REASONING_EFFORT_OPTIONS } from '@/ai/defaults.js'
import { useAIConfig } from '@/composables/useAIConfig'

const { effective, isOverridden, setSetting, resetSettings } = useGenerationSettings()

const aiConfig = useAIConfig()

// Presets saved before this setting existed have no flag; treat them as
// allowing tools, which is what they did.
const toolsEnabled = computed(() => aiConfig.activeAIPreset.value?.toolsEnabled !== false)

const setToolsEnabled = enabled => {
  const preset = aiConfig.activeAIPreset.value
  if (preset) aiConfig.updatePreset(preset.id, { toolsEnabled: enabled })
}
</script>
