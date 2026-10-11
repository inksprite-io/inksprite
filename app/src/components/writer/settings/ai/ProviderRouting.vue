<template>
  <ExpandableSection
    title="Provider routing"
    storage-key="ui.provider-config.routing"
    subsection
    content-wrapper-class="flex flex-col"
  >
    <div class="flex flex-col gap-3 pt-2 pb-1">
      <p class="text-xs text-surface-500 dark:text-surface-400">
        Applies to every model on this connection.
      </p>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Ignored providers"
          :overridden="isOverridden('ignore')"
          @reset="setRouting({ ignore: [...ROUTING_DEFAULTS.ignore] })"
        />
        <OpenRouterProviderSelect
          :model-value="routing.ignore"
          label="Ignored providers"
          @update:model-value="setRouting({ ignore: $event })"
        />
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Data collection"
          description="Providers that may train on your prompts."
          :overridden="isOverridden('dataCollection')"
          @reset="setRouting({ dataCollection: ROUTING_DEFAULTS.dataCollection })"
        />
        <Select
          :model-value="routing.dataCollection"
          :options="dataCollectionOptions"
          option-label="label"
          option-value="value"
          class="w-full"
          size="small"
          aria-label="Data collection"
          @update:model-value="setRouting({ dataCollection: $event })"
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="Zero data retention"
          description="Some models have no such endpoint and need this off."
          :overridden="isOverridden('zdr')"
          @reset="setRouting({ zdr: ROUTING_DEFAULTS.zdr })"
        />
        <ToggleSwitch
          :model-value="routing.zdr"
          class="flex-none"
          aria-label="Zero data retention"
          @update:model-value="setRouting({ zdr: $event })"
        />
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Quantization"
          description="Clear to accept any, including unreported."
          :overridden="isOverridden('quantizations')"
          @reset="setRouting({ quantizations: ROUTING_DEFAULTS.quantizations })"
        />
        <MultiSelect
          :model-value="routing.quantizations"
          :options="QUANTIZATIONS"
          option-label="label"
          option-value="value"
          show-clear
          display="chip"
          placeholder="Any precision"
          aria-label="Quantization"
          class="w-full"
          size="small"
          @update:model-value="setRouting({ quantizations: $event || [] })"
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="Allow fallbacks"
          description="Try the next eligible provider when one is down."
          :overridden="isOverridden('allowFallbacks')"
          @reset="setRouting({ allowFallbacks: ROUTING_DEFAULTS.allowFallbacks })"
        />
        <ToggleSwitch
          :model-value="routing.allowFallbacks"
          class="flex-none"
          aria-label="Allow fallbacks"
          @update:model-value="setRouting({ allowFallbacks: $event })"
        />
      </div>
    </div>
  </ExpandableSection>
</template>

<script setup>
import { computed } from 'vue'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import ToggleSwitch from 'primevue/toggleswitch'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import SettingLabel from '@/components/common/SettingLabel.vue'
import OpenRouterProviderSelect from './OpenRouterProviderSelect.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import {
  QUANTIZATIONS,
  ROUTING_DEFAULTS,
  resolveRouting,
  isRoutingOverridden,
} from '@/ai/routing.js'

/**
 * Routing policy for one OpenRouter connection. Lives on the provider rather
 * than the AI preset because it describes the connection — a privacy floor set
 * here holds for every request made through this account. Which providers may
 * serve is the exception, and is the preset's: see AiAllowedProviders.vue.
 *
 * @typedef {Object} Props
 * @property {string} providerId - The OpenRouter provider to configure
 */
const props = defineProps({
  providerId: {
    type: String,
    required: true,
  },
})

const aiConfig = useAIConfig()

const routing = computed(() => resolveRouting(aiConfig.getProvider(props.providerId)?.routing))

const dataCollectionOptions = [
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny' },
]

/**
 * @param {keyof import('@/ai/routing.js').OpenRouterRouting} key
 * @returns {boolean}
 */
const isOverridden = key =>
  isRoutingOverridden(aiConfig.getProvider(props.providerId)?.routing, key)

/**
 * Persist a change. The whole resolved policy is written so a stored record is
 * always complete, whatever knobs existed when it was last saved.
 *
 * @param {Partial<import('@/ai/routing.js').OpenRouterRouting>} changes
 */
const setRouting = changes => {
  aiConfig.updateProvider(props.providerId, { routing: { ...routing.value, ...changes } })
}
</script>
