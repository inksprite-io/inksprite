<template>
  <div class="flex flex-col gap-2">
    <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Provider</label>
    <div class="flex gap-1">
      <Select
        id="provider"
        v-model="localSelectedProviderId"
        :options="providers"
        option-label="name"
        option-value="id"
        placeholder="Select a provider"
        aria-label="Provider"
        class="flex-auto min-w-0 !dark:bg-surface-900"
        size="small"
      />
      <Button
        v-if="selectedProvider"
        v-tooltip.top="'Connection settings'"
        icon="pi pi-ellipsis-v"
        class="round-button"
        severity="secondary"
        text
        rounded
        size="small"
        aria-label="Connection settings"
        data-action="connection-settings"
        @click="editing = { providerId: selectedProvider.id }"
      />
      <Button
        v-tooltip.top="'Add connection'"
        icon="pi pi-plus"
        class="round-button"
        severity="secondary"
        text
        rounded
        size="small"
        aria-label="Add connection"
        data-action="add-connection"
        @click="editing = { providerId: null }"
      />
    </div>

    <!-- Whether the connection picked can be used: what it still needs, or
         how it answered last. -->
    <div
      v-if="selectedProvider && statusText"
      class="flex flex-wrap items-center gap-2 text-xs"
      data-connection-status
      :data-gap="gap || 'none'"
    >
      <span
        class="flex-none w-2 h-2 rounded-full"
        :class="gap || (state && state !== 'connected') ? 'bg-amber-500' : 'bg-green-500'"
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
        @click="editing = { providerId: selectedProvider.id }"
      />
    </div>

    <ConnectionDialog
      v-if="editing"
      visible
      :provider-id="editing.providerId"
      :does="kind"
      :kind-id="editing.providerId ? null : kind === 'speech' ? 'kokoro' : null"
      @close="closeDialog"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useAIConfig } from '@/composables/useAIConfig'
import { useConnections, STATE_LABELS } from '@/composables/useConnections.js'
import ConnectionDialog from '../../connections/ConnectionDialog.vue'
import 'primeicons/primeicons.css'
import { connectionGap } from '@/ai/providers.js'

/**
 * The connection a preset, or narration, goes through: one of the writer's
 * that can do the job, with its settings and Add connection beside it.
 *
 * @typedef {Object} Props
 * @property {string} selectedProviderId - Currently selected provider ID
 * @property {import('@/ai/providers.js').ProviderKind} [kind] - What the
 *   connection is picked for; only those that can do it are listed
 */
const props = defineProps({
  selectedProviderId: {
    type: String,
    default: null,
  },
  kind: {
    type: String,
    default: 'chat',
  },
})

const emit = defineEmits(['update:selectedProviderId'])

const aiConfig = useAIConfig()
const connections = useConnections()

/** The connection whose settings are open, or a new one's: null for none. */
const editing = ref(/** @type {{providerId: string|null}|null} */ (null))

// Local state for the selected provider
const localSelectedProviderId = ref(props.selectedProviderId)

const kind = computed(() => /** @type {import('@/ai/providers.js').ProviderKind} */ (props.kind))

const selectedProvider = computed(() =>
  localSelectedProviderId.value ? aiConfig.getProvider(localSelectedProviderId.value) : null
)

// The writer's connections that can do the job, and the one picked, even
// where it is a built-in left from before.
const providers = computed(() => {
  const theirs = connections.connectionsFor(kind.value)
  const picked = selectedProvider.value
  return picked && !theirs.some(one => one.id === picked.id) ? [picked, ...theirs] : theirs
})

/** What the connection picked still needs, if anything. */
const gap = computed(() => connectionGap(selectedProvider.value))

/** How it answered last, if it has been asked. */
const state = computed(() => connections.stateOf(selectedProvider.value?.id))

const statusText = computed(() => {
  if (gap.value === 'key') return 'Not connected'
  if (gap.value === 'endpoint') return 'No server address'
  return state.value ? STATE_LABELS[state.value] : ''
})

/**
 * Close the connection's settings, picking the one just added.
 * @param {string|null} providerId - The connection it was on
 */
function closeDialog(providerId) {
  const adding = editing.value?.providerId === null
  editing.value = null
  if (adding && providerId && aiConfig.getProvider(providerId)) {
    localSelectedProviderId.value = providerId
  }
}

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
