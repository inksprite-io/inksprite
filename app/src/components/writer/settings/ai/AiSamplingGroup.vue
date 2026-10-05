<template>
  <ExpandableSection
    title="Sampling"
    storage-key="ui.settings.ai-sampling"
    subsection
    content-wrapper-class="flex flex-col"
  >
    <div class="flex flex-col gap-3 pt-2 pb-1">
      <div v-for="spec in PARAMETER_SPECS" :key="spec.key" class="flex flex-col gap-1">
        <SettingLabel
          :label="AI_PARAMETERS[spec.key].label"
          :description="AI_PARAMETERS[spec.key].description"
          :overridden="isParameterOverridden(spec.key)"
          @reset="resetParameter(spec.key)"
        />
        <CustomSlider
          :model-value="effective.parameters[spec.key]"
          :min="AI_PARAMETERS[spec.key].min"
          :max="spec.max ?? AI_PARAMETERS[spec.key].max"
          :slider-max="spec.sliderMax"
          :step="AI_PARAMETERS[spec.key].step"
          :fractional="spec.fractional !== false"
          @update:model-value="setParameter(spec.key, $event)"
        />
      </div>

      <!-- Seed sits outside `parameters` in AI_DEFAULTS, and a slider across
           two billion values would be useless, so it gets a plain input. -->
      <div class="flex flex-col gap-1">
        <SettingLabel
          :label="AI_PARAMETERS.seed.label"
          :description="AI_PARAMETERS.seed.description"
          :overridden="isOverridden('seed')"
          @reset="resetSettings(['seed'])"
        />
        <InputNumber
          :model-value="effective.seed"
          :min="AI_PARAMETERS.seed.min"
          :max="AI_PARAMETERS.seed.max"
          :use-grouping="false"
          size="small"
          class="w-full"
          @update:model-value="setSetting('seed', $event ?? 0)"
        />
      </div>
    </div>
  </ExpandableSection>
</template>

<script setup>
import InputNumber from 'primevue/inputnumber'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import CustomSlider from './CustomSlider.vue'
import SettingLabel from '@/components/common/SettingLabel.vue'
import { AI_PARAMETERS } from '@/config/aiParameters'
import { useGenerationSettings } from '@/composables/useGenerationSettings'

const {
  effective,
  isOverridden,
  isParameterOverridden,
  setSetting,
  setParameter,
  resetSettings,
  resetParameter,
} = useGenerationSettings()

/**
 * Display order, plus the bounds AI_PARAMETERS can't express. Top-K is
 * unbounded above, so the slider covers the useful range while the number
 * input stays open-ended.
 *
 * @type {Array<{key: string, max?: number, sliderMax?: number, fractional?: boolean}>}
 */
const PARAMETER_SPECS = [
  { key: 'temperature' },
  { key: 'topP' },
  { key: 'topK', max: Infinity, sliderMax: 500, fractional: false },
  { key: 'minP' },
  { key: 'topA' },
  { key: 'frequencyPenalty' },
  { key: 'presencePenalty' },
  { key: 'repetitionPenalty' },
]
</script>
