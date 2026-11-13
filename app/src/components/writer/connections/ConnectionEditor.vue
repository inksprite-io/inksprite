<template>
  <div class="flex flex-col gap-4" data-connection-editor>
    <ConnectionForm
      :key="providerId || 'new'"
      :mode="providerId ? 'edit' : 'add'"
      :provider-id="providerId"
      :kind-id="kindId"
      :does="does"
      :show-state="!inCard"
      @shown="onShown"
    />

    <template v-if="current">
      <!-- How many requests it is asked at once (ai/gate.js); empty is the default for its kind. -->
      <div v-if="chats" class="flex flex-col gap-1">
        <label
          :for="`${id}-concurrency`"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Requests at once</label
        >
        <InputText
          :id="`${id}-concurrency`"
          v-model="concurrency"
          inputmode="numeric"
          :placeholder="concurrencyByDefault"
          class="w-full"
          size="small"
          data-field="concurrency"
          @blur="keepConcurrency"
          @keydown.enter="keepConcurrency"
        />
      </div>

      <!-- OpenRouter's privacy and quality floor, for every model on it. -->
      <ProviderRouting v-if="current.type === 'openrouter'" :provider-id="current.id" />
      <!-- NanoGPT's privacy floor, the one piece of its routing that is the connection's. -->
      <ZeroDataRetention
        v-else-if="current.type === 'nanogpt'"
        :model-value="zdr"
        :overridden="isRoutingOverridden(current.routing, 'zdr')"
        @update:model-value="keepZdr"
        @reset="keepZdr(ROUTING_DEFAULTS.zdr)"
      />

      <div>
        <Button
          label="Remove"
          severity="danger"
          text
          size="small"
          class="!px-0"
          data-action="remove-connection"
          @click="askToRemove"
        />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, useId, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useConfirm } from 'primevue/useconfirm'
import ConnectionForm from './ConnectionForm.vue'
import ProviderRouting from '../settings/ai/ProviderRouting.vue'
import ZeroDataRetention from '../settings/ai/ZeroDataRetention.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useConnections } from '@/composables/useConnections.js'
import { providerDoes } from '@/ai/providers.js'
import { defaultRoom } from '@/ai/gate.js'
import { ROUTING_DEFAULTS, isRoutingOverridden, resolveRouting } from '@/ai/routing.js'

/**
 * A connection's settings: its key or address and Connect, how many requests
 * it is asked at once, OpenRouter's privacy and quality floor or NanoGPT's
 * zero data retention, and Remove.
 * In its card in Settings › Connections, and in a dialog where a chat's
 * failed reply opens it; with nothing given, a new one's.
 *
 * @typedef {Object} Props
 * @property {string} [providerId] - The connection; none to add one
 * @property {string} [kindId] - The provider a new one starts on
 * @property {import('@/ai/providers.js').ProviderKind} [does] - What a new
 *   one must be able to do
 * @property {boolean} [inCard] - In its card, which says how it answered
 */
const props = defineProps({
  providerId: { type: String, default: null },
  kindId: { type: String, default: null },
  does: { type: String, default: null },
  inCard: { type: Boolean, default: false },
})

/**
 * `shown`: the connection it is on, which may be one it made. `removed`: it
 * was removed.
 */
const emit = defineEmits(['shown', 'removed'])

const id = `connection_editor_${useId()}`
const aiConfig = useAIConfig()
const connections = useConnections()
const confirm = useConfirm()

/** The connection the form is on: the one given, or the one it made. */
const shownId = ref(/** @type {string|null} */ (props.providerId))

/** @param {string|null} providerId */
const onShown = providerId => {
  shownId.value = providerId
  emit('shown', providerId)
}
const current = computed(() => (shownId.value ? aiConfig.getProvider(shownId.value) : null))

/** Whether it is asked for answers, and so how many at once matters. */
const chats = computed(() => Boolean(current.value) && providerDoes(current.value, 'chat'))

const concurrency = ref('')
watch(
  () => current.value?.concurrency,
  value => (concurrency.value = value ? String(value) : ''),
  { immediate: true }
)

/** What it is asked at once when the field is empty, as its placeholder says. */
const concurrencyByDefault = computed(() => {
  const provider = current.value
  if (!provider) return ''
  if (provider.type === 'llamacpp') return 'One per slot'
  const room = defaultRoom(provider)
  return Number.isFinite(room) ? String(room) : 'No limit'
})

/**
 * Keep how many requests it is asked at once: a whole number from one up,
 * or nothing for its default. Anything else puts back what was there.
 */
function keepConcurrency() {
  const provider = current.value
  if (!provider) return
  const typed = concurrency.value.trim()
  const count = Number(typed)
  if (typed && !(Number.isInteger(count) && count > 0)) {
    concurrency.value = provider.concurrency ? String(provider.concurrency) : ''
    return
  }
  const value = typed ? count : undefined
  if (value !== provider.concurrency) aiConfig.updateProvider(provider.id, { concurrency: value })
}

/** Whether NanoGPT is asked to serve only through providers that keep nothing. */
const zdr = computed(() => resolveRouting(current.value?.routing).zdr)

/**
 * Keep NanoGPT's zero data retention, beside anything else its routing holds.
 * @param {boolean} value
 */
function keepZdr(value) {
  const provider = current.value
  if (provider)
    aiConfig.updateProvider(provider.id, { routing: { ...provider.routing, zdr: value } })
}

/** Remove it, once asked: a key can't be brought back. */
function askToRemove() {
  const provider = current.value
  if (!provider) return
  confirm.require({
    header: 'Remove connection',
    message: provider.apiKey
      ? `Remove ${provider.name}? Its key can't be brought back.`
      : `Remove ${provider.name}?`,
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Remove', severity: 'danger' },
    accept: () => {
      connections.remove(provider.id)
      emit('removed')
    },
  })
}
</script>
