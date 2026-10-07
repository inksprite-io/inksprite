<template>
  <ExpandableSection
    title="Provider Routing"
    storage-key="ui.provider-config.routing"
    subsection
    content-wrapper-class="flex flex-col"
  >
    <div class="flex flex-col gap-3 pt-2 pb-1">
      <p class="text-xs text-surface-500 dark:text-surface-400">
        Constrain which upstream providers OpenRouter may route to. Applies to every request through
        this connection, whatever the model. Which providers may serve a given model is set on its
        preset, under Allowed Providers.
      </p>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Ignored Providers"
          description="Never route to these providers, even as a fallback."
          :overridden="isOverridden('ignore')"
          @reset="setRouting({ ignore: [...ROUTING_DEFAULTS.ignore] })"
        />
        <OpenRouterProviderSelect
          :model-value="routing.ignore"
          @update:model-value="setRouting({ ignore: $event })"
        />
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Data Collection"
          description="Whether providers that may store your prompts for training are eligible to serve requests. Denied by default."
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
          @update:model-value="setRouting({ dataCollection: $event })"
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="Zero Data Retention"
          description="Route only to endpoints that keep no copy of the prompt or response. On by default; a model with no such endpoint needs this off."
          :overridden="isOverridden('zdr')"
          @reset="setRouting({ zdr: ROUTING_DEFAULTS.zdr })"
        />
        <ToggleSwitch
          :model-value="routing.zdr"
          class="flex-none"
          @update:model-value="setRouting({ zdr: $event })"
        />
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Quantization"
          description="Serve only at these precisions. Eight-bit or better by default; clear the list to accept any, including endpoints that don't report one."
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
          class="w-full"
          size="small"
          @update:model-value="setRouting({ quantizations: $event || [] })"
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="Allow Fallbacks"
          description="When the cheapest eligible provider is down, let OpenRouter try the next eligible one rather than failing. Never routes outside the filters above."
          :overridden="isOverridden('allowFallbacks')"
          @reset="setRouting({ allowFallbacks: ROUTING_DEFAULTS.allowFallbacks })"
        />
        <ToggleSwitch
          :model-value="routing.allowFallbacks"
          class="flex-none"
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
