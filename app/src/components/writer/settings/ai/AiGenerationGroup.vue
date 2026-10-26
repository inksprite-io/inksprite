<template>
  <ExpandableSection
    title="Generation"
    storage-key="ui.settings.ai-generation"
    subsection
    content-wrapper-class="flex flex-col"
  >
    <div class="flex flex-col gap-3 pt-2 pb-1">
      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2">
          <SettingLabel
            label="Max tokens"
            :overridden="isOverridden('maxTokens')"
            @reset="resetSettings(['maxTokens'])"
          />
          <span
            v-if="effective.maxTokens === 0"
            class="text-xs text-surface-500 dark:text-surface-400"
            data-zero="maxTokens"
          >
            Unlimited
          </span>
        </div>
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
      </div>

      <div v-if="effortOptions.length > 1" class="flex flex-col gap-1">
        <SettingLabel
          label="Reasoning effort"
          :overridden="isOverridden('reasoningEffort')"
          @reset="resetSettings(['reasoningEffort'])"
        />
        <Select
          :model-value="effort"
          :options="effortOptions"
          option-label="label"
          option-value="value"
          class="w-full dark:!bg-surface-900"
          size="small"
          aria-label="Reasoning effort"
          @update:model-value="setSetting('reasoningEffort', $event)"
        />
      </div>

      <div
        v-if="capabilities.reasons && capabilities.reasoningDisplay"
        class="flex items-center justify-between gap-2"
      >
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
        <div class="flex items-center justify-between gap-2">
          <SettingLabel
            label="Tool rounds per turn"
            :overridden="isOverridden('maxToolRounds')"
            @reset="resetSettings(['maxToolRounds'])"
          />
          <span
            v-if="effective.maxToolRounds === 0"
            class="text-xs text-surface-500 dark:text-surface-400"
            data-zero="maxToolRounds"
          >
            Unlimited
          </span>
        </div>
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
import { fitEffort } from '@/ai/capabilities.js'
import { useAIConfig } from '@/composables/useAIConfig'
import { useModelCapabilities } from '@/composables/useModelCapabilities'

const { effective, isOverridden, setSetting, resetSettings } = useGenerationSettings()

const aiConfig = useAIConfig()

// Only what the preset's model takes, and the effort it would be sent: a
// level it lacks reads as the nearest it has, and stays stored as chosen.
const capabilities = useModelCapabilities(
  () => aiConfig.shownPreset.value?.providerId,
  () => aiConfig.shownPreset.value?.model
)
const effortOptions = computed(() =>
  REASONING_EFFORT_OPTIONS.filter(option => capabilities.value.efforts.includes(option.value))
)
const effort = computed(() => fitEffort(effective.value.reasoningEffort, capabilities.value))

// Presets saved before this setting existed have no flag; treat them as
// allowing tools, which is what they did.
const toolsEnabled = computed(() => aiConfig.shownPreset.value?.toolsEnabled !== false)

const setToolsEnabled = enabled => {
  const preset = aiConfig.shownPreset.value
  if (preset) aiConfig.updatePreset(preset.id, { toolsEnabled: enabled })
}
</script>
