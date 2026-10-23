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
        :disabled="!selectedProviderId || !canList || loading"
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
import { useAIConfig } from '@/composables/useAIConfig'
import { useModelLists } from '@/composables/useModelLists'
import { canListModels } from '@/ai/providers.js'

/**
 * @typedef {Object} Props
 * @property {string} selectedModelId - Currently selected model ID
 * @property {string} selectedProviderId - Currently selected provider ID
 * @property {import('@/ai/providers.js').ProviderKind} [kind] - Which of the
 *   provider's lists: its chat models, or those it reads aloud with
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
  kind: {
    type: String,
    default: 'chat',
  },
})

const emit = defineEmits(['update:selectedModelId'])

const toast = useToast()
const aiConfig = useAIConfig()
const modelLists = useModelLists()
const kind = computed(() => /** @type {import('@/ai/providers.js').ProviderKind} */ (props.kind))

// Local state
const localSelectedModelId = ref(props.selectedModelId)

const provider = computed(() =>
  props.selectedProviderId ? aiConfig.getProvider(props.selectedProviderId) : null
)

// A server with no address, or a service with no key, has nothing to ask:
// asking only fails. OpenRouter's list is public.
const canList = computed(() => canListModels(provider.value))

// The provider's list, shared with every other picker and its Connect button.
const list = computed(() =>
  props.selectedProviderId && canList.value
    ? modelLists.listOf(props.selectedProviderId, kind.value)
    : undefined
)
const models = computed(() => list.value?.models ?? [])
const loading = computed(() => !!list.value?.loading)

// Computed placeholder
const selectPlaceholder = computed(() => {
  if (!props.selectedProviderId) {
    return 'Select a provider first'
  }
  if (!canList.value || !list.value) {
    return 'Provider not connected'
  }
  if (loading.value) {
    return 'Loading models…'
  }
  if (list.value.failed) {
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

// A provider shown for the first time is asked what it serves. Its address
// and key are not watched: they save as they are typed, and the list is
// asked for again on Connect or Refresh.
watch(
  () => props.selectedProviderId,
  (id, before) => {
    if (!id) {
      if (before) localSelectedModelId.value = null
      return
    }
    if (canList.value && !modelLists.listOf(id, kind.value)) {
      modelLists.load(id, kind.value).catch(error => {
        console.warn('Error loading models for selected provider:', error)
      })
    }
  },
  { immediate: true }
)

// A model the provider no longer serves is let go, once it has answered.
watch(
  () => list.value?.loading === false && !list.value.failed && list.value.models,
  served => {
    if (
      served &&
      localSelectedModelId.value &&
      !served.some(m => m.id === localSelectedModelId.value)
    ) {
      localSelectedModelId.value = null
    }
  },
  { immediate: true }
)

/**
 * Ask the provider for its models again. The list shows what came back.
 */
const handleRefreshModels = async () => {
  if (props.selectedProviderId) {
    try {
      await modelLists.load(props.selectedProviderId, kind.value)
    } catch (error) {
      toast.add({
        severity: 'error',
        detail: `The models couldn't be loaded. ${error.message || 'Check the provider settings.'}`,
        life: 5000,
      })
    }
  }
}
</script>
