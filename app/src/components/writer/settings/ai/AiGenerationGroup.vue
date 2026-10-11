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
          label="Max tokens"
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
          label="Max tokens"
          @update:model-value="setSetting('maxTokens', $event)"
        />
        <p
          v-if="effective.maxTokens === 0"
          class="text-xs text-surface-500 dark:text-surface-400"
          data-zero="maxTokens"
        >
          The provider decides.
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Reasoning effort"
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
          aria-label="Reasoning effort"
          @update:model-value="setSetting('reasoningEffort', $event)"
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="Show reasoning"
          :overridden="isOverridden('showModelReasoning')"
          @reset="resetSettings(['showModelReasoning'])"
        />
        <ToggleSwitch
          :model-value="effective.showModelReasoning"
          class="flex-none"
          aria-label="Show reasoning"
          @update:model-value="setSetting('showModelReasoning', $event)"
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
          Allow tool use
        </label>
        <ToggleSwitch
          :model-value="toolsEnabled"
          class="flex-none"
          aria-label="Allow tool use"
          @update:model-value="setToolsEnabled"
        />
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Tool rounds per turn"
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
          label="Tool rounds per turn"
          @update:model-value="setSetting('maxToolRounds', $event)"
        />
        <p
          v-if="effective.maxToolRounds === 0"
          class="text-xs text-surface-500 dark:text-surface-400"
          data-zero="maxToolRounds"
        >
          No limit.
        </p>
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
