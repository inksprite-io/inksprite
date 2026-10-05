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
        this connection.
      </p>

      <Message v-if="loadError" severity="warn" size="small" :closable="false">
        Couldn't load the provider list. You can still type slugs by hand.
      </Message>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Allowed Providers"
          description="Route only to these providers. Leave empty to allow any."
          :overridden="isOverridden('only')"
          @reset="setRouting({ only: [] })"
        />
        <MultiSelect
          :model-value="routing.only"
          :options="providerOptions"
          :loading="loading"
          option-label="name"
          option-value="slug"
          filter
          show-clear
          display="chip"
          placeholder="Any provider"
          class="w-full"
          size="small"
          @update:model-value="setRouting({ only: $event || [] })"
        />
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Ignored Providers"
          description="Never route to these providers, even as a fallback."
          :overridden="isOverridden('ignore')"
          @reset="setRouting({ ignore: [] })"
        />
        <MultiSelect
          :model-value="routing.ignore"
          :options="providerOptions"
          :loading="loading"
          option-label="name"
          option-value="slug"
          filter
          show-clear
          display="chip"
          placeholder="None"
          class="w-full"
          size="small"
          @update:model-value="setRouting({ ignore: $event || [] })"
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
import { computed, ref, onMounted } from 'vue'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import ToggleSwitch from 'primevue/toggleswitch'
import Message from 'primevue/message'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import SettingLabel from '@/components/common/SettingLabel.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useAIService } from '@/composables/useAIService'
import {
  QUANTIZATIONS,
  ROUTING_DEFAULTS,
  resolveRouting,
  isRoutingOverridden,
} from '@/ai/routing.js'

/**
 * Routing policy for one OpenRouter connection. Lives on the provider rather
 * than the AI profile because it describes the connection — a privacy floor set
 * here holds for every request made through this account.
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
const aiService = useAIService()

/** @type {import('vue').Ref<Array<{slug: string, name: string}>>} */
const openRouterProviders = ref([])
const loading = ref(false)
const loadError = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    openRouterProviders.value = await aiService.listOpenRouterProviders()
  } catch (error) {
    console.error('Failed to load OpenRouter providers:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
})

const routing = computed(() => resolveRouting(aiConfig.getProvider(props.providerId)?.routing))

/**
 * Slugs already chosen but missing from the directory — a sub-provider variant
 * like `deepinfra/turbo`, or anything at all when the fetch failed. Without
 * these the MultiSelect would render a stored choice as unselected and quietly
 * drop it on the next edit.
 *
 * @type {import('vue').ComputedRef<Array<{slug: string, name: string}>>}
 */
const unlistedSlugs = computed(() => {
  const known = new Set(openRouterProviders.value.map(p => p.slug))
  return [...new Set([...routing.value.only, ...routing.value.ignore])]
    .filter(slug => !known.has(slug))
    .map(slug => ({ slug, name: slug }))
})

const providerOptions = computed(() => [...openRouterProviders.value, ...unlistedSlugs.value])

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
