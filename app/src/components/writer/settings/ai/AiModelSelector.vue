<template>
  <div class="flex flex-col gap-1">
    <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Model</label>
    <div class="flex gap-2">
      <Select
        id="model"
        v-model="localSelectedModelId"
        :options="models"
        option-label="name"
        option-value="id"
        :placeholder="selectPlaceholder"
        :disabled="!selectedProviderId || loading"
        :loading="loading"
        filter
        filter-placeholder="Search..."
        :show-clear="false"
        aria-label="Model"
        class="flex-auto !dark:bg-surface-900"
        size="small"
      >
        <template #option="{ option }">
          <div class="flex items-center">
            <div>{{ option.name }}</div>
          </div>
        </template>
      </Select>
      <Button
        v-tooltip.top="'Refresh models'"
        icon="pi pi-refresh"
        aria-label="Refresh models"
        class="round-button"
        severity="secondary"
        text
        rounded
        size="small"
        :disabled="!selectedProviderId || !hasAddress || loading"
        @click="handleRefreshModels"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useAIService } from '@/composables/useAIService'
import { useAIConfig } from '@/composables/useAIConfig'

/**
 * @typedef {Object} Props
 * @property {string} selectedModelId - Currently selected model ID
 * @property {string} selectedProviderId - Currently selected provider ID
 */
const props = defineProps({
  selectedModelId: {
    type: String,
    default: null,
  },
  selectedProviderId: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['update:selectedModelId'])

const toast = useToast()
const aiService = useAIService()
const aiConfig = useAIConfig()

// Local state
const localSelectedModelId = ref(props.selectedModelId)
const models = ref([])
const loading = ref(false)

// The provider as it is now, so that an address or key set after the provider
// was picked loads its models without a press of Refresh.
const provider = computed(() =>
  props.selectedProviderId ? aiConfig.getProvider(props.selectedProviderId) : null
)

// A connection other than OpenRouter has no address until the writer gives
// it one, and asking an empty address for models only fails.
const hasAddress = computed(
  () => provider.value?.type === 'openrouter' || !!provider.value?.endpoint?.trim()
)

const failed = ref(false)

// Computed placeholder
const selectPlaceholder = computed(() => {
  if (!props.selectedProviderId) {
    return 'Select a provider first'
  }
  if (!hasAddress.value) {
    return 'Set an address first'
  }
  if (loading.value) {
    return 'Loading models...'
  }
  if (failed.value) {
    return "Couldn't load models"
  }
  if (models.value.length === 0) {
    return 'No models available'
  }
  return 'Select a model'
})

// Watch for external changes to selectedModelId
watch(
  () => props.selectedModelId,
  newVal => {
    localSelectedModelId.value = newVal
  }
)

// Watch for local changes and emit
watch(localSelectedModelId, newVal => {
  emit('update:selectedModelId', newVal)
})

// Which load is the latest, so a slow answer for an address since changed
// does not overwrite the list for the new one.
let loadCount = 0

/**
 * Load models for the selected provider
 * @returns {Promise<void>}
 */
const loadModels = async () => {
  const load = ++loadCount
  if (!hasAddress.value) {
    models.value = []
    failed.value = false
    loading.value = false
    return
  }

  loading.value = true
  try {
    const modelList = await aiService.listModels(props.selectedProviderId)
    if (load !== loadCount) return
    models.value = modelList || []
    failed.value = false

    // If current model is not in the list, clear selection
    if (
      localSelectedModelId.value &&
      !models.value.find(m => m.id === localSelectedModelId.value)
    ) {
      localSelectedModelId.value = null
    }
  } catch (error) {
    if (load !== loadCount) return
    models.value = []
    failed.value = true
    throw error
  } finally {
    if (load === loadCount) loading.value = false
  }
}

// Load the list for the provider, and again whenever what it is asked with
// changes: its type, address or key.
watch(
  () => [
    props.selectedProviderId,
    provider.value?.type,
    provider.value?.endpoint,
    provider.value?.apiKey,
  ],
  async (now, before) => {
    if (!props.selectedProviderId) {
      models.value = []
      failed.value = false
      if (before?.[0]) localSelectedModelId.value = null
      return
    }
    try {
      await loadModels()
    } catch (error) {
      console.warn('Error loading models for selected provider:', error)
    }
  },
  { immediate: true }
)

/**
 * Handle refresh models button click
 */
const handleRefreshModels = async () => {
  if (props.selectedProviderId) {
    try {
      await loadModels()
      toast.add({
        severity: 'success',
        detail: 'Models refreshed',
        life: 2000,
      })
    } catch (error) {
      toast.add({
        severity: 'error',
        detail: `Failed to load models: ${error.message || 'check the provider settings'}`,
        life: 5000,
      })
    }
  }
}
</script>
