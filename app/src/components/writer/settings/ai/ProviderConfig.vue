<template>
  <!-- Escape is useTopmostEscape's, so the delete confirmation over this
       closes alone. -->
  <Dialog
    ref="dialog"
    v-model:visible="localVisible"
    header="Provider configuration"
    :modal="true"
    :closable="true"
    :close-on-escape="false"
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
          :options="providers"
          option-label="name"
          option-value="id"
          placeholder="Select a provider"
          aria-label="Provider"
          class="flex-auto"
          size="small"
        />
        <Button
          v-tooltip.top="'New provider'"
          icon="pi pi-plus"
          aria-label="New provider"
          severity="secondary"
          text
          rounded
          size="small"
          @click="handleNewProvider"
        />
        <Button
          v-if="selectedProvider?.isDefault === false"
          v-tooltip.top="'Delete provider'"
          icon="pi pi-trash"
          aria-label="Delete provider"
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
          <label
            for="provider-name"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Name</label
          >
          <InputText
            id="provider-name"
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
            aria-label="Type"
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

        <!-- Endpoint field (a type with no known address is a server someone runs) -->
        <div v-if="needsEndpoint(localType)" class="flex flex-col gap-1">
          <label
            for="provider-endpoint"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Endpoint</label
          >
          <InputText
            id="provider-endpoint"
            v-model="localEndpoint"
            placeholder="http://localhost:1234/v1"
            class="w-full"
            size="small"
            @input="handleEndpointChange"
          />
        </div>

        <!-- API Key field -->
        <div class="flex flex-col gap-1">
          <label
            for="provider-key"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >
            {{ needsKey(localType) ? 'API key' : 'API key (optional)' }}
          </label>
          <InputText
            id="provider-key"
            v-model="localApiKey"
            type="password"
            placeholder="sk-..."
            class="w-full"
            size="small"
            @blur="handleApiKeyChange"
          />
        </div>

        <!-- How many requests it is asked at once (ai/gate.js); empty is the default for its kind -->
        <div v-if="chats" class="flex flex-col gap-1">
          <label
            for="provider-concurrency"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Requests at once</label
          >
          <InputText
            id="provider-concurrency"
            v-model="localConcurrency"
            inputmode="numeric"
            :placeholder="concurrencyByDefault"
            class="w-full"
            size="small"
            data-field="concurrency"
            @blur="handleConcurrencyChange"
            @keydown.enter="handleConcurrencyChange"
          />
        </div>

        <Button
          label="Connect"
          icon="pi pi-link"
          size="small"
          class="w-full"
          :loading="testing"
          :disabled="!localSelectedProviderId"
          data-action="connect"
          @click="handleTestConnection"
        />

        <!-- OAuth Option for OpenRouter -->
        <div v-if="localType === 'openrouter'" class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <div class="flex-1 border-t border-surface-300 dark:border-surface-700"></div>
            <span class="text-xs text-surface-500 dark:text-surface-400">OR</span>
            <div class="flex-1 border-t border-surface-300 dark:border-surface-700"></div>
          </div>
          <Button
            label="Sign in with OpenRouter"
            icon="pi pi-sign-in"
            size="small"
            class="w-full"
            data-action="oauth"
            @click="handleOAuthConnect"
          />
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
import { useTopmostEscape } from '@/composables/useTopmostEscape.js'
import { useAIService } from '@/composables/useAIService'
import { useModelLists } from '@/composables/useModelLists'
import { useOpenRouterSignIn } from '@/composables/useOpenRouterSignIn'
import {
  PROVIDER_TYPES,
  needsEndpoint,
  needsKey,
  providerDoes,
  providerLabel,
} from '@/ai/providers.js'
import { defaultRoom } from '@/ai/gate.js'
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
  /** @param {string} detail */
  constructor(detail) {
    super(detail)
    this.name = 'ValidationError'
    this.detail = detail
  }
}

const toast = useToast()
const openRouter = useOpenRouterSignIn()
const confirm = useConfirm()
const aiConfig = useAIConfig()
const aiService = useAIService()
const modelLists = useModelLists()

// Dialog visibility
const localVisible = ref(props.visible)

/** @type {import('vue').Ref<{ mask?: HTMLElement }|null>} */
const dialog = ref(null)

useTopmostEscape(
  localVisible,
  () => dialog.value?.mask,
  () => (localVisible.value = false)
)

// Local copy of selected provider ID (initialized from prop)
const localSelectedProviderId = ref(props.initialProviderId)

// Local refs for form fields
const localName = ref('')
const localType = ref('')
const localEndpoint = ref('')
const localApiKey = ref('')
const localConcurrency = ref('')

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
      localConcurrency.value = provider.concurrency ? String(provider.concurrency) : ''
    } else {
      // Clear form when no provider selected
      localName.value = ''
      localType.value = ''
      localEndpoint.value = ''
      localApiKey.value = ''
      localConcurrency.value = ''
    }
  },
  { immediate: true }
)

// Provider type menu items, from the one list that defines them
const providerTypeItems = ref(
  PROVIDER_TYPES.filter(entry => !entry.hidden).map(entry => ({
    displayName: entry.menu,
    providerType: entry.id,
  }))
)

const providers = computed(() => aiConfig.providers.value)

/**
 * Handle new provider creation - creates the provider immediately
 */
function handleNewProvider() {
  const newProvider = aiConfig.createProvider({
    name: 'New provider',
    type: 'generic',
    endpoint: '',
    apiKey: '',
    rememberKey: true,
  })
  localSelectedProviderId.value = newProvider.id
}

/** What a provider is called when the writer leaves its name empty. */
const UNTITLED_PROVIDER = 'Untitled provider'

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

/**
 * Save what the provider is asked with: its type, address or key. A change
 * lets its model list go, since that was the old server's answer; Connect
 * asks again.
 * @param {Partial<import('@/types/models.js').AIProvider>} changes
 */
function updateConnection(changes) {
  const id = localSelectedProviderId.value
  if (!id) return
  const provider = providersById.value.get(id)
  if (!provider) return
  const changed = Object.entries(changes).some(
    ([field, value]) => provider[/** @type {keyof typeof provider} */ (field)] !== value
  )
  if (!changed) return
  aiConfig.updateProvider(id, changes)
  modelLists.forget(id)
}

function handleTypeChange() {
  updateConnection({ type: localType.value })
}

function handleEndpointChange() {
  updateConnection({ endpoint: localEndpoint.value.trim() })
}

function handleApiKeyChange() {
  updateConnection({ apiKey: localApiKey.value.trim() || undefined })
}

/**
 * Keep how many requests the connection is asked at once: a whole number
 * from one up, or nothing for its default. Anything else puts back what was
 * there.
 */
function handleConcurrencyChange() {
  const id = localSelectedProviderId.value
  const provider = id ? providersById.value.get(id) : null
  if (!provider) return
  const typed = localConcurrency.value.trim()
  const count = Number(typed)
  if (typed && !(Number.isInteger(count) && count > 0)) {
    localConcurrency.value = provider.concurrency ? String(provider.concurrency) : ''
    return
  }
  const concurrency = typed ? count : undefined
  if (concurrency !== provider.concurrency) aiConfig.updateProvider(id, { concurrency })
}

/** Whether the connection chats, and so is asked for answers at all. */
const chats = computed(
  () => Boolean(selectedProvider.value) && providerDoes(selectedProvider.value, 'chat')
)

/** What the connection is asked at once when the field is empty, as its placeholder says. */
const concurrencyByDefault = computed(() => {
  const provider = selectedProvider.value
  if (!provider) return ''
  if (provider.type === 'llamacpp') return 'One per slot'
  const room = defaultRoom({
    ...provider,
    type: localType.value || provider.type,
    endpoint: localEndpoint.value.trim(),
  })
  return Number.isFinite(room) ? String(room) : 'No limit'
})

/**
 * Validate current provider fields (used by test connection)
 */
function validateProvider() {
  if (!localName.value?.trim()) {
    throw new ValidationError('Give the provider a name.')
  }

  if (needsEndpoint(localType.value) && !localEndpoint.value?.trim()) {
    throw new ValidationError("Enter the server's address.")
  }

  if (needsKey(localType.value) && !localApiKey.value?.trim()) {
    throw new ValidationError(`Enter an API key for ${providerLabel(localType.value)}.`)
  }
}

/** Whether a connection is being tested. */
const testing = ref(false)

/**
 * Handle test connection - validates before testing
 */
async function handleTestConnection() {
  testing.value = true
  try {
    validateProvider()

    // For OpenRouter, use the dedicated validation function
    if (localType.value === 'openrouter' && localApiKey.value?.trim()) {
      const isValid = await aiService.validateOpenRouterKey(localApiKey.value.trim())

      if (isValid) {
        toast.add({
          severity: 'success',
          detail: 'Connected',
          life: 3000,
        })
      } else {
        toast.add({
          severity: 'error',
          detail: "OpenRouter didn't accept the key. Check it and try again.",
          life: 3000,
        })
      }
      return
    }

    // Anything else is asked what it serves, for the model pickers too: a
    // connection that only speaks, what it reads aloud with
    const kind = providerDoes(selectedProvider.value, 'chat') ? 'chat' : 'speech'
    const models = await modelLists.load(localSelectedProviderId.value, kind)

    if (models && models.length > 0) {
      toast.add({
        severity: 'success',
        detail:
          models.length === 1
            ? 'Connected. 1 model is available.'
            : `Connected. ${models.length} models are available.`,
        life: 3000,
      })
    } else {
      toast.add({
        severity: 'warn',
        detail: 'Connected, but no models were found.',
        life: 3000,
      })
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      toast.add({
        severity: 'error',
        detail: error.detail,
        life: 3000,
      })
      return
    }

    console.error('Connection test failed:', error)
    toast.add({
      severity: 'error',
      detail: `The provider couldn't be reached. ${error.message || ''}`.trim(),
      life: 5000,
    })
  } finally {
    testing.value = false
  }
}

/**
 * Handle OAuth connection for OpenRouter
 */
async function handleOAuthConnect() {
  try {
    await openRouter.start()
    console.log('OAuth initiated, waiting for callback...')
  } catch (error) {
    console.error('Failed to initiate OAuth:', error)
    toast.add({
      severity: 'error',
      detail: `The sign-in couldn't start. ${error.message || ''}`.trim(),
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

  // A default provider has no delete button, and is never deleted.
  if (provider.isDefault) return

  confirm.require({
    message: `Delete "${provider.name}"?`,
    header: 'Delete provider',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: () => {
      try {
        aiConfig.deleteProvider(localSelectedProviderId.value)
        localSelectedProviderId.value = providersById.value.keys().next().value || null
      } catch (error) {
        console.error('Failed to delete provider:', error)
        toast.add({
          severity: 'error',
          detail: "The provider couldn't be deleted.",
          life: 3000,
        })
      }
    },
  })
}
</script>
