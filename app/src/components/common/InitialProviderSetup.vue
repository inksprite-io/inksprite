<template>
  <Dialog
    v-model:visible="localVisible"
    class="w-screen md:w-[45rem]"
    header="AI Provider Setup"
    modal
    :closable="true"
    :draggable="false"
    :pt="{
      root: { class: 'shadow-xl !border-4 border-primary-500' },
      content: { class: 'h-full w-full bg-surface-50 dark:bg-surface-900' },
    }"
  >
    <div class="flex flex-col gap-4">
      <!-- Help Text -->
      <div class="text-surface-700 dark:text-surface-200">
        <p class="mb-3">
          To use inksprite's AI co-writing or chat features, you'll need to connect to a provider.
          The quickest way to get started is with
          <a
            href="https://openrouter.ai/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-600 dark:text-primary-400 hover:underline"
            >OpenRouter</a
          >.
        </p>
        <p class="mb-3">
          You can connect to OpenRouter below, or set up another provider in the AI settings.
        </p>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap gap-2 justify-between items-center w-full">
        <Button label="Don't show again" severity="secondary" text @click="handleDontShowAgain" />
        <div class="flex flex-wrap gap-2">
          <Button label="AI settings" severity="secondary" outlined @click="handleOpenSettings" />
          <Button
            label="Connect to OpenRouter"
            severity="primary"
            icon="pi pi-link"
            :loading="isConnecting"
            @click="handleOAuthConnect"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useOpenRouterSignIn } from '@/composables/useOpenRouterSignIn'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'

/**
 * @typedef {Object} Props
 * @property {boolean} visible - Whether the dialog is visible
 */
const props = defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
})

const emit = defineEmits(['update:visible', 'dont-show-again'])

const toast = useToast()
const openRouter = useOpenRouterSignIn()
const settings = useSettingsPanel()

const localVisible = ref(props.visible)
const isConnecting = ref(false)

// Sync visible prop with local state
watch(
  () => props.visible,
  newVal => {
    localVisible.value = newVal
    if (newVal) {
      // Reset state when dialog opens
      isConnecting.value = false
    }
  }
)

watch(localVisible, newVal => {
  emit('update:visible', newVal)
})

/**
 * Handle OAuth connection for OpenRouter
 */
async function handleOAuthConnect() {
  try {
    isConnecting.value = true
    await openRouter.start()
    console.log('OAuth initiated, waiting for callback...')
  } catch (error) {
    isConnecting.value = false
    console.error('Failed to initiate OAuth:', error)
    toast.add({
      severity: 'error',
      summary: 'Connection Failed',
      detail: error.message || 'Could not start the authentication process',
      life: 5000,
    })
  }
}

/** Over to the AI settings, for a provider that is not OpenRouter. */
function handleOpenSettings() {
  localVisible.value = false
  settings.open('ai')
}

/**
 * Handle Don't show again button click
 */
function handleDontShowAgain() {
  emit('dont-show-again')
  localVisible.value = false
}

function handleOAuthMessage(event) {
  // Verify origin for security
  if (event.origin !== window.location.origin) {
    return
  }

  if (event.data.type === 'oauth-success' && event.data.provider === 'openrouter') {
    isConnecting.value = false
    localVisible.value = false
  } else if (event.data.type === 'oauth-error' && event.data.provider === 'openrouter') {
    isConnecting.value = false
  }
}

// Initialize on mount
onMounted(async () => {
  window.addEventListener('message', handleOAuthMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', handleOAuthMessage)
})
</script>
