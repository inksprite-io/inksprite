<template>
  <Dialog
    v-model:visible="localVisible"
    header="Provider Configuration"
    :modal="true"
    :closable="true"
    :style="{ width: '40rem' }"
    :pt="{
      root: { class: 'shadow-xl !border-4 border-primary-500' },
      content: { class: 'bg-surface-50 dark:bg-surface-900' },
    }"
  >
    <!-- Provider Setup Content -->
    <div class="flex flex-col gap-4">
      <!-- Provider Selection -->
      <div class="flex gap-2">
        <Select
          id="provider"
          v-model="localSelectedProviderId"
          :options="providersWithFormattedNames"
          option-label="displayName"
          option-value="id"
          placeholder="Select a provider"
          class="flex-auto"
          size="small"
        >
          <template #option="{ option }">
            <div class="flex items-center">
              <div>{{ option.displayName }}</div>
            </div>
          </template>
        </Select>
        <Button
          v-tooltip.top="'New Provider'"
          icon="pi pi-plus"
          severity="secondary"
          text
          rounded
          size="small"
          @click="handleNewProvider"
        />
        <Button
          v-tooltip.top="'Test Connection'"
          icon="pi pi-link"
          severity="secondary"
          text
          rounded
          size="small"
          :disabled="!localSelectedProviderId"
          @click="handleTestConnection"
        />
        <Button
          v-if="selectedProvider?.isDefault === false"
          v-tooltip.top="'Delete Provider'"
          icon="pi pi-trash"
          severity="danger"
          text
          rounded
          size="small"
          :disabled="!localSelectedProviderId || selectedProvider?.isDefault"
          @click="handleDeleteProvider"
        />
      </div>

      <!-- Provider Edit Form -->
      <div class="flex flex-col gap-3">
        <!-- Name -->
        <div v-if="selectedProvider?.isDefault === false" class="flex flex-col gap-1">
          <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Name</label>
          <InputText
            v-model="localName"
            placeholder="Provider name"
            class="w-full"
            size="small"
            @input="handleNameChange"
            @blur="handleNameBlur"
          />
        </div>

        <!-- Type -->
        <div v-if="selectedProvider?.isDefault === false" class="flex flex-col gap-1">
          <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Type</label>
          <Select
            id="providerType"
            v-model="localType"
            :options="providerTypeItems"
            option-label="displayName"
            option-value="providerType"
            placeholder="Provider type"
            class="w-full"
            size="small"
            @change="handleTypeChange"
          >
            <template #option="{ option }">
              <div class="flex items-center">
                <div>{{ option.displayName }}</div>
              </div>
            </template>
          </Select>
        </div>

        <!-- Endpoint field (every type but OpenRouter is a server someone runs) -->
        <div v-if="needsEndpoint(localType)" class="flex flex-col gap-1">
          <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Endpoint</label>
          <InputText
            v-model="localEndpoint"
            placeholder="http://localhost:1234/v1"
            class="w-full"
            size="small"
            @input="handleEndpointChange"
          />
        </div>

        <!-- API Key field -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
            {{ needsEndpoint(localType) ? 'API Key (Optional)' : 'API Key' }}
          </label>
          <InputText
            v-model="localApiKey"
            type="password"
            placeholder="sk-..."
            class="w-full"
            size="small"
            @blur="handleApiKeyChange"
          />
        </div>

        <!-- OAuth Option for OpenRouter -->
        <div v-if="localType === 'openrouter'" class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <div class="flex-1 border-t border-surface-300 dark:border-surface-700"></div>
            <span class="text-xs text-surface-500 dark:text-surface-400">OR</span>
            <div class="flex-1 border-t border-surface-300 dark:border-surface-700"></div>
          </div>
          <Button
            label="Connect with OAuth"
            icon="pi pi-sign-in"
            severity="success"
            size="small"
            class="w-full"
            @click="handleOAuthConnect"
          />
          <p class="text-xs text-surface-500 dark:text-surface-400 text-center">
            Securely connect your OpenRouter account
          </p>
        </div>

        <!-- Routing preferences (OpenRouter only) -->
        <ProviderRouting
          v-if="localType === 'openrouter' && localSelectedProviderId"
          :provider-id="localSelectedProviderId"
        />
      </div>
    </div>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { useAIConfig } from '@/composables/useAIConfig'
import { useAIService } from '@/composables/useAIService'
import { initiateOpenRouterOAuth } from '@/utils/oauth'
import { PROVIDER_TYPES, providerLabel, needsEndpoint } from '@/ai/providers.js'
import ProviderRouting from './ProviderRouting.vue'

/**
 * @typedef {Object} Props
 * @property {boolean} visible - Dialog visibility
 * @property {string} initialProviderId - Provider to select initially
 */
const props = defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
  initialProviderId: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['update:visible', 'update:selected-provider-id'])

class ValidationError extends Error {
  /** @param {string} detail @param {string} [summary='Validation Error'] */
  constructor(detail, summary = 'Validation Error') {
    super(detail)
    this.name = 'ValidationError'
    this.summary = summary
    this.detail = detail
  }
}

const toast = useToast()
const confirm = useConfirm()
const aiConfig = useAIConfig()
const aiService = useAIService()

// Dialog visibility
const localVisible = ref(props.visible)

// Local copy of selected provider ID (initialized from prop)
const localSelectedProviderId = ref(props.initialProviderId)

// Local refs for form fields
const localName = ref('')
const localType = ref('')
const localEndpoint = ref('')
const localApiKey = ref('')

// Sync visible prop with local state
watch(
  () => props.visible,
  newVal => {
    localVisible.value = newVal
    if (newVal) {
      // Reset to initial provider when dialog opens
      localSelectedProviderId.value = props.initialProviderId
    }
  }
)

watch(localVisible, newVal => {
  emit('update:visible', newVal)
})

// Emit when selected provider changes
watch(localSelectedProviderId, newVal => {
  emit('update:selected-provider-id', newVal)
})

// Fast lookup by id
const providersById = computed(() => {
  const m = new Map()
  for (const p of aiConfig.providers.value) m.set(p.id, p)
  return m
})

// Get selected provider - this is reactive to both localSelectedProviderId and providers changes
const selectedProvider = computed(() => {
  if (!localSelectedProviderId.value) return null
  return providersById.value.get(localSelectedProviderId.value)
})

// Initialize local refs when selectedProvider changes
watch(
  selectedProvider,
  provider => {
    if (provider) {
      // Saving on a keystroke swaps the provider object, which lands back
      // here. The name reloads only when the store holds something the field
      // doesn't already say, or the trimmed copy would overwrite the space or
      // the blank the writer is in the middle of typing.
      if (provider.name !== localName.value.trim()) localName.value = provider.name || ''
      localType.value = provider.type || ''
      localEndpoint.value = provider.endpoint || ''
      localApiKey.value = provider.apiKey || ''
    } else {
      // Clear form when no provider selected
      localName.value = ''
      localType.value = ''
      localEndpoint.value = ''
      localApiKey.value = ''
    }
  },
  { immediate: true }
)

// Provider type menu items, from the one list that defines them
const providerTypeItems = ref(
  PROVIDER_TYPES.map(entry => ({ displayName: entry.menu, providerType: entry.id }))
)

/**
 * Computed property to format providers with type in name
 */
const providersWithFormattedNames = computed(() => {
  return aiConfig.providers.value.map(provider => ({
    ...provider,
    displayName: `${provider.name} (${providerLabel(provider.type)})`,
  }))
})

/**
 * Handle new provider creation - creates the provider immediately
 */
function handleNewProvider() {
  const newProvider = aiConfig.createProvider({
    name: 'New Provider',
    type: 'generic',
    endpoint: '',
    apiKey: '',
    rememberKey: true,
  })
  localSelectedProviderId.value = newProvider.id
}

/** What a provider is called when the writer leaves its name empty. */
const UNTITLED_PROVIDER = 'Untitled Provider'

/**
 * Update handlers - persist changes immediately (debouncing handled by store)
 */
function handleNameChange() {
  const name = localName.value.trim()
  // A blank field is a name being retyped, not a name: the store keeps the
  // old one until the writer leaves the field.
  if (!localSelectedProviderId.value || !name) return
  aiConfig.updateProvider(localSelectedProviderId.value, { name })
}

function handleNameBlur() {
  if (!localSelectedProviderId.value) return
  localName.value = localName.value.trim() || UNTITLED_PROVIDER
  aiConfig.updateProvider(localSelectedProviderId.value, { name: localName.value })
}

function handleTypeChange() {
  if (!localSelectedProviderId.value) return
  aiConfig.updateProvider(localSelectedProviderId.value, {
    type: localType.value,
  })
}

function handleEndpointChange() {
  if (!localSelectedProviderId.value) return
  aiConfig.updateProvider(localSelectedProviderId.value, {
    endpoint: localEndpoint.value.trim(),
  })
}

function handleApiKeyChange() {
  if (!localSelectedProviderId.value) return
  aiConfig.updateProvider(localSelectedProviderId.value, {
    apiKey: localApiKey.value.trim() || undefined,
  })
}

/**
 * Validate current provider fields (used by test connection)
 */
function validateProvider() {
  if (!localSelectedProviderId.value) {
    throw new ValidationError('No provider selected')
  }

  if (!localName.value?.trim()) {
    throw new ValidationError('Provider name is required')
  }

  if (!PROVIDER_TYPES.some(entry => entry.id === localType.value)) {
    throw new ValidationError('Invalid provider type')
  }

  if (needsEndpoint(localType.value) && !localEndpoint.value?.trim()) {
    throw new ValidationError('Endpoint is required for this provider type')
  }

  if (localType.value === 'openrouter' && !localApiKey.value?.trim()) {
    throw new ValidationError('API key is required for OpenRouter')
  }
}

/**
 * Handle test connection - validates before testing
 */
async function handleTestConnection() {
  try {
    validateProvider()

    // For OpenRouter, use the dedicated validation function
    if (localType.value === 'openrouter' && localApiKey.value?.trim()) {
      const isValid = await aiService.validateOpenRouterKey(localApiKey.value.trim())

      if (isValid) {
        toast.add({
          severity: 'success',
          summary: 'Connection Successful',
          life: 3000,
        })
      } else {
        toast.add({
          severity: 'error',
          summary: 'Connection Failed',
          detail: 'Check your API key and try again',
          life: 3000,
        })
      }
      return
    }

    // Anything else is a server someone is running: ask it what it serves
    const models = await aiService.listModels(localSelectedProviderId.value)

    if (models && models.length > 0) {
      toast.add({
        severity: 'success',
        summary: 'Connection Successful',
        detail: `Found ${models.length} available models`,
        life: 3000,
      })
    } else {
      toast.add({
        severity: 'warn',
        summary: 'Connection Successful',
        detail: 'Connected but no models found',
        life: 3000,
      })
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      toast.add({
        severity: 'error',
        summary: error.summary,
        detail: error.detail,
        life: 3000,
      })
      return
    }

    console.error('Connection test failed:', error)
    toast.add({
      severity: 'error',
      summary: 'Connection Failed',
      detail: error.message || 'Could not connect to the provider',
      life: 5000,
    })
  }
}

/**
 * Handle OAuth connection for OpenRouter
 */
async function handleOAuthConnect() {
  try {
    const callbackUrl = `${window.location.origin}/connect/openrouter`
    await initiateOpenRouterOAuth(callbackUrl)
    console.log('OAuth initiated, waiting for callback...')
  } catch (error) {
    console.error('Failed to initiate OAuth:', error)
    toast.add({
      severity: 'error',
      summary: 'Connection Failed',
      detail: error.message || 'Could not start the authentication process',
      life: 5000,
    })
  }
}

/**
 * Handle delete provider
 */
async function handleDeleteProvider() {
  if (!localSelectedProviderId.value) return

  const provider = providersById.value.get(localSelectedProviderId.value)
  if (!provider) return

  // Check if this is a default provider
  if (provider.isDefault) {
    toast.add({
      severity: 'error',
      summary: 'Cannot Delete',
      detail: 'Default providers cannot be deleted',
      life: 3000,
    })
    return
  }

  confirm.require({
    message: `Are you sure you want to delete the provider "${provider.name}"?`,
    header: 'Delete Provider',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: () => {
      try {
        aiConfig.deleteProvider(localSelectedProviderId.value)
        localSelectedProviderId.value = providersById.value.keys().next().value || null
      } catch (error) {
        console.error('Failed to delete provider:', error)
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to delete provider',
          life: 3000,
        })
      }
    },
  })
}
</script>
