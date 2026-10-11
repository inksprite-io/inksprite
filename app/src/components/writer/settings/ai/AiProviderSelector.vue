<template>
  <div class="flex flex-col gap-2">
    <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Provider</label>
    <div class="flex gap-2">
      <Select
        id="provider"
        v-model="localSelectedProviderId"
        :options="providers"
        option-label="name"
        option-value="id"
        placeholder="Select a provider"
        aria-label="Provider"
        class="flex-auto !dark:bg-surface-900"
        size="small"
      />
      <Button
        v-tooltip.top="'Configure provider'"
        icon="pi pi-ellipsis-v"
        class="round-button"
        severity="secondary"
        text
        rounded
        size="small"
        aria-label="Configure provider"
        @click="showProviderConfig = true"
      />
    </div>

    <!-- Whether the connection picked can be used. A profile with a provider
         and a model looks ready; without a key or an address it is not, and
         nothing else on this pane would say so. -->
    <div
      v-if="selectedProvider"
      class="flex flex-wrap items-center gap-2 text-xs"
      data-connection-status
      :data-gap="gap || 'none'"
    >
      <span
        class="flex-none w-2 h-2 rounded-full"
        :class="gap ? 'bg-amber-500' : 'bg-green-500'"
        aria-hidden="true"
      />
      <span class="flex-1 min-w-0 text-surface-600 dark:text-surface-300">{{ statusText }}</span>
      <Button
        v-if="gap"
        label="Connect"
        size="small"
        severity="secondary"
        outlined
        data-action="connect-provider"
        @click="showProviderConfig = true"
      />
    </div>

    <!-- Provider Config Dialog -->
    <ProviderConfig
      v-model:visible="showProviderConfig"
      :initial-provider-id="localSelectedProviderId"
      @update:selected-provider-id="localSelectedProviderId = $event"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useAIConfig } from '@/composables/useAIConfig'
import ProviderConfig from './ProviderConfig.vue'
import 'primeicons/primeicons.css'
import { connectionGap } from '@/ai/providers.js'

/**
 * @typedef {Object} Props
 * @property {string} selectedProviderId - Currently selected provider ID
 */
const props = defineProps({
  selectedProviderId: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['update:selectedProviderId'])

const aiConfig = useAIConfig()

// Dialog ref
const showProviderConfig = ref(false)

// Local state for the selected provider
const localSelectedProviderId = ref(props.selectedProviderId)

// Get all providers
const providers = computed(() => aiConfig.providers.value)

const selectedProvider = computed(() =>
  localSelectedProviderId.value ? aiConfig.getProvider(localSelectedProviderId.value) : null
)

/** What the connection picked still needs, if anything. */
const gap = computed(() => connectionGap(selectedProvider.value))

const statusText = computed(() => {
  switch (gap.value) {
    case 'key':
      return 'Not connected. Add an API key or connect your OpenRouter account.'
    case 'endpoint':
      return 'Not connected. Enter the address of the server.'
    default:
      return 'Ready to use.'
  }
})

// Watch for external changes to selectedProviderId
watch(
  () => props.selectedProviderId,
  newVal => {
    localSelectedProviderId.value = newVal
  }
)

// Watch for local changes and emit
watch(localSelectedProviderId, newVal => {
  emit('update:selectedProviderId', newVal)
})
</script>
