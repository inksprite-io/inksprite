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
        v-tooltip.top="'Refresh Models'"
        icon="pi pi-refresh"
        class="round-button"
        severity="secondary"
        text
        rounded
        size="small"
        :disabled="!selectedProviderId || loading"
        @click="handleRefreshModels"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useAIService } from '@/composables/useAIService'

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

// Local state
const localSelectedModelId = ref(props.selectedModelId)
const models = ref([])
const loading = ref(false)

// Computed placeholder
const selectPlaceholder = computed(() => {
  if (!props.selectedProviderId) {
    return 'Select a provider first'
  }
  if (loading.value) {
    return 'Loading models...'
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

// Watch for provider changes
watch(
  () => props.selectedProviderId,
  async newProviderId => {
    if (newProviderId) {
      try {
        await loadModels(newProviderId)
      } catch (error) {
        console.warn('Error loading models for selected provider:', error)
      }
    } else {
      models.value = []
      localSelectedModelId.value = null
    }
  }
)

/**
 * Load models for the selected provider
 * @param {string} providerId - The provider ID
 */
const loadModels = async providerId => {
  if (!providerId) return

  loading.value = true
  try {
    const modelList = await aiService.listModels(providerId)
    models.value = modelList || []

    // If current model is not in the list, clear selection
    if (
      localSelectedModelId.value &&
      !models.value.find(m => m.id === localSelectedModelId.value)
    ) {
      localSelectedModelId.value = null
    }
  } catch (error) {
    console.log('Failed to load models:', error)
    models.value = []
    throw error
  } finally {
    loading.value = false
  }
}

/**
 * Handle refresh models button click
 */
const handleRefreshModels = async () => {
  if (props.selectedProviderId) {
    try {
      await loadModels(props.selectedProviderId)
      toast.add({
        severity: 'success',
        summary: 'Models refreshed',
        life: 2000,
      })
    } catch (error) {
      toast.add({
        severity: 'error',
        summary: 'Failed to load models',
        detail: error.message || 'Please check your provider settings',
        life: 5000,
      })
    }
  }
}

// Load models on mount if provider is selected
onMounted(async () => {
  if (props.selectedProviderId) {
    await loadModels(props.selectedProviderId)
  }
})
</script>
