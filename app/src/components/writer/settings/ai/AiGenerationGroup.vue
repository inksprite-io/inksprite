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
            label="Max reply length"
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
          label="Max reply length"
          @update:model-value="setSetting('maxTokens', $event)"
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
import ToggleSwitch from 'primevue/toggleswitch'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import CustomSlider from './CustomSlider.vue'
import SettingLabel from '@/components/common/SettingLabel.vue'
import { useGenerationSettings } from '@/composables/useGenerationSettings'
import { useAIConfig } from '@/composables/useAIConfig'
import { useModelCapabilities } from '@/composables/useModelCapabilities'

/**
 * How a model writes on a connection: how long a reply may be, whether its
 * reasoning shows, whether it calls tools and how many rounds a turn may take.
 *
 * @typedef {Object} Props
 * @property {string} providerId
 * @property {string} model
 */
const props = defineProps({
  providerId: { type: String, required: true },
  model: { type: String, required: true },
})

const { effective, isOverridden, setSetting, resetSettings } = useGenerationSettings(
  () => props.providerId,
  () => props.model
)

const aiConfig = useAIConfig()

// Only what the model takes. How hard it thinks is each chat's own, chosen
// in the chat.
const capabilities = useModelCapabilities(
  () => props.providerId,
  () => props.model
)

// Settings saved before this one existed have no flag; treat them as
// allowing tools, which is what they did.
const toolsEnabled = computed(
  () => aiConfig.runOn(props.providerId, props.model).toolsEnabled !== false
)

/** @param {boolean} enabled */
const setToolsEnabled = enabled =>
  aiConfig.changeModelSettings(props.providerId, props.model, { toolsEnabled: enabled })
</script>
