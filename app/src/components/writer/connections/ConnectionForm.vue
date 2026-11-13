<template>
  <div class="flex flex-col gap-3" data-connection-form>
    <div v-if="choosing" class="flex flex-col gap-1">
      <label :for="`${id}-kind`" :class="LABEL">Provider</label>
      <Select
        v-model="kindId"
        :input-id="`${id}-kind`"
        :options="kindOptions"
        option-label="name"
        option-value="id"
        class="w-full dark:!bg-surface-900"
        size="small"
        data-field="kind"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label :for="`${id}-name`" :class="LABEL">Name</label>
      <InputText
        :id="`${id}-name`"
        v-model="name"
        size="small"
        class="w-full"
        data-field="name"
        @blur="persist"
      />
    </div>

    <div v-if="asksAddress" class="flex flex-col gap-1">
      <label :for="`${id}-address`" :class="LABEL">Address</label>
      <InputText
        :id="`${id}-address`"
        v-model="address"
        size="small"
        class="w-full"
        :placeholder="kind.endpoint || 'http://localhost:8000/v1'"
        data-field="address"
        @blur="persist"
        @keydown.enter="connect"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label :for="`${id}-key`" :class="LABEL">{{
        needsKey(kind.type) ? 'API key' : 'API key (optional)'
      }}</label>
      <InputText
        :id="`${id}-key`"
        v-model="apiKey"
        type="password"
        size="small"
        class="w-full"
        data-field="key"
        @blur="persist"
        @keydown.enter="connect"
      />
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button
        label="Connect"
        size="small"
        :loading="checking"
        data-action="connect"
        @click="connect"
      />
      <Button
        v-if="signsIn"
        :label="`Sign in with ${providerLabel(kind.type)}`"
        size="small"
        severity="secondary"
        outlined
        data-action="sign-in"
        @click="signIn"
      />
      <!-- How it answered, where nothing else says so: a card says it on
           its own line. -->
      <span
        v-if="showState && state && !checking"
        class="flex items-center gap-1.5 text-xs text-surface-600 dark:text-surface-300"
        data-connection-state
        :data-state="state"
      >
        <span
          class="w-2 h-2 rounded-full"
          :class="state === 'connected' ? 'bg-green-500' : 'bg-red-500'"
          aria-hidden="true"
        />
        {{ STATE_LABELS[state] }}
      </span>
    </div>
    <p
      v-if="said && !checking"
      class="m-0 text-xs text-red-600 dark:text-red-400"
      data-connection-problem
    >
      {{ said }}
    </p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useAIConfig } from '@/composables/useAIConfig'
import { useConnections, STATE_LABELS } from '@/composables/useConnections.js'
import { useModelLists } from '@/composables/useModelLists'
import { useSignIn } from '@/composables/useSignIn.js'
import { useToast } from '@/composables/useToast.js'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import {
  CONNECTION_KINDS,
  connectionKind,
  kindOf,
  needsEndpoint,
  needsKey,
  providerLabel,
  signInOf,
} from '@/ai/providers.js'

/**
 * A connection's key or address, and Connect, which asks it something real
 * and says how it answered, in place and as a toast. Setup's first page, and
 * the top of a connection's settings.
 *
 * - `setup`: a provider to choose, showing the writer's connection of that
 *   kind where they have one, so its status is its own.
 * - `add`: a provider to choose, for a connection of their own, made on
 *   Connect.
 * - `edit`: the connection given, its kind fixed.
 *
 * A connection that exists keeps what is typed as the field is left; one not
 * made yet is made on Connect.
 *
 * @typedef {Object} Props
 * @property {'setup'|'add'|'edit'} mode
 * @property {string} [providerId] - The connection, in `edit`
 * @property {string} [kindId] - The provider to start on
 * @property {import('@/ai/providers.js').ProviderKind} [does] - What the
 *   providers offered must be able to do: a chat, or speech
 * @property {boolean} [showState] - Whether it says how the connection
 *   answered beside Connect
 */
const props = defineProps({
  mode: { type: String, default: 'setup' },
  providerId: { type: String, default: null },
  kindId: { type: String, default: null },
  does: { type: String, default: null },
  showState: { type: Boolean, default: true },
})

/**
 * `shown`: the connection the form is on, or null. `connected`: it answered,
 * with what OpenRouter said of the account.
 */
const emit = defineEmits(['shown', 'connected'])

const LABEL = 'text-xs font-medium text-surface-700 dark:text-surface-200'

const id = `connection_${useId()}`
const aiConfig = useAIConfig()
const connections = useConnections()
const modelLists = useModelLists()
const toast = useToast()
const providersStore = useAIProvidersStore()

const kindOptions = computed(() =>
  CONNECTION_KINDS.filter(
    kind => !props.does || kind.does.includes(/** @type {any} */ (props.does))
  )
)

/** The one made here, in `add`, once Connect has made it. */
const madeId = ref(/** @type {string|null} */ (null))

const kindId = ref(
  props.kindId ??
    (props.providerId ? kindOf(aiConfig.getProvider(props.providerId)).id : null) ??
    kindOptions.value[0]?.id ??
    'openrouter'
)

const kind = computed(
  () =>
    connectionKind(kindId.value) ??
    /** @type {import('@/ai/providers.js').ConnectionKind} */ (connectionKind('generic'))
)

/** Whether a provider is chosen here, rather than the connection given. */
const choosing = computed(() => props.mode !== 'edit' && !madeId.value)

/** The connection the form is on, or null for one not made yet. */
const shown = computed(() => {
  if (props.mode === 'edit') return aiConfig.getProvider(props.providerId ?? '')
  if (madeId.value) return aiConfig.getProvider(madeId.value)
  return props.mode === 'setup' ? connections.forKind(kindId.value) : null
})

const asksAddress = computed(() => needsEndpoint(kind.value.type))

/** The services the writer can sign in to instead of pasting a key, by type. */
const signIns = Object.fromEntries(
  CONNECTION_KINDS.filter(one => signInOf(one.type)).map(one => [one.type, useSignIn(one.type)])
)

const signsIn = computed(() => kind.value.type in signIns)

const name = ref('')
const address = ref('')
const apiKey = ref('')

/** What went wrong last, said in place, where the state says nothing. */
const said = ref('')
const checking = ref(false)

const state = computed(() => connections.stateOf(shown.value?.id))

// The fields as the connection has them, or as a new one of the kind starts.
watch(
  () => [shown.value?.id, kindId.value],
  () => {
    const provider = shown.value
    name.value = provider?.name ?? connections.nameFor(kind.value)
    address.value = provider?.endpoint ?? kind.value.endpoint ?? ''
    apiKey.value = provider?.apiKey ?? ''
    said.value = ''
  },
  { immediate: true }
)

watch(
  () => shown.value?.id ?? null,
  providerId => emit('shown', providerId),
  { immediate: true }
)

/** What the fields say, to keep. */
const fields = () => ({
  name: name.value.trim() || shown.value?.name || connections.nameFor(kind.value),
  ...(asksAddress.value ? { endpoint: address.value.trim() } : {}),
  apiKey: apiKey.value.trim(),
})

/**
 * Keep what is typed on a connection that exists. A changed key or address
 * lets its model list go: that was the old one's answer.
 */
function persist() {
  const provider = shown.value
  if (!provider) return
  const next = fields()
  const asked =
    (next.endpoint ?? provider.endpoint) !== provider.endpoint ||
    next.apiKey !== (provider.apiKey ?? '')
  if (next.name === provider.name && !asked) return
  aiConfig.updateProvider(provider.id, next)
  if (asked) {
    modelLists.forget(provider.id)
    connections.setState(provider.id, null)
  }
}

/**
 * Keep the connection, made where it isn't yet, and ask it something real.
 */
async function connect() {
  if (checking.value) return
  const draft = { ...shown.value, type: kind.value.type, ...fields() }
  const notYet = connections.missing(/** @type {any} */ (draft))
  if (notYet) {
    said.value = notYet
    return
  }
  let provider = shown.value
  if (provider) {
    persist()
    if (!provider.added) aiConfig.updateProvider(provider.id, { added: true })
  } else {
    provider = connections.addConnection(kind.value.id, fields())
    if (props.mode === 'add') madeId.value = provider.id
  }
  await check(provider.id)
}

/** @param {string} providerId */
async function check(providerId) {
  checking.value = true
  said.value = ''
  try {
    const result = await connections.check(providerId)
    if (result.state === 'connected') {
      toast.success(result.message)
      emit('connected', { providerId, freeTier: result.freeTier })
    } else {
      toast.error(result.message)
      if (!result.state) said.value = result.message
    }
  } finally {
    checking.value = false
  }
}

/**
 * Over to the service, which sends the key back to this page, for the
 * connection shown, or for a new one where none is yet.
 */
async function signIn() {
  try {
    await signIns[kind.value.type].start({ providerId: shown.value?.id })
  } catch (error) {
    console.error(`Failed to start the ${kind.value.type} sign-in:`, error)
    toast.error(`The sign-in couldn't start. ${error?.message || ''}`.trim())
  }
}

/**
 * The sign-in is done: the key is on the connection, which this page then
 * connects by itself.
 * @param {MessageEvent} event
 */
async function signedIn(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (data?.type !== 'oauth-success' || data.provider !== kind.value.type || !data.providerId) {
    return
  }
  await providersStore.reloadProvider(data.providerId)
  if (props.mode === 'add' && !shown.value) madeId.value = data.providerId
  if (shown.value?.id === data.providerId) await check(data.providerId)
}

onMounted(() => window.addEventListener('message', signedIn))
onBeforeUnmount(() => window.removeEventListener('message', signedIn))
</script>
