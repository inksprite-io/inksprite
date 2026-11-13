<template>
  <ChatChip
    v-bind="$attrs"
    ref="chip"
    :style="held ? { maxWidth: `${held}px` } : undefined"
    :aria-label="`Model: ${label}`"
    :aria-controls="popoverId"
    data-chat-model-chip
    @click="popover?.toggle($event)"
  >
    <!-- The model is what the chip is for, so the rest gives way to it: the
         connection is left out of a narrow chat, and the effort, in a chip
         too narrow for it beside the model, wraps to a line out of sight.
         Only then is the model cut, from its end, with the connection. See
         `fit`. -->
    <span
      v-if="preset"
      ref="line"
      class="flex flex-wrap items-center gap-x-1 h-4 min-w-0 overflow-hidden"
    >
      <span ref="nameLabel" class="min-w-0 truncate">
        <span class="hidden @md:inline mr-1 text-surface-400 dark:text-surface-500">{{
          connectionName
        }}</span>
        <span class="font-medium">{{ shortName }}</span>
      </span>
      <span
        v-if="effortName"
        ref="effortLabel"
        class="flex-none text-surface-400 dark:text-surface-500"
        >{{ effortName }}</span
      >
    </span>
    <span v-else class="truncate">Choose a model</span>
  </ChatChip>
  <Popover :id="popoverId" ref="popover" data-chat-model-popover @show="loadLists">
    <div class="w-64 flex flex-col gap-3 text-sm">
      <div class="flex flex-col gap-1">
        <label
          :for="`${id}-model`"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Model</label
        >
        <!-- The chat's model and the ones chosen lately; the rest are a click
             away, under the effort. -->
        <Select
          :input-id="`${id}-model`"
          :model-value="currentKey"
          :options="modelOptions"
          option-label="label"
          option-value="key"
          placeholder="Choose a model"
          aria-label="Model"
          class="w-full dark:!bg-surface-900"
          size="small"
          append-to="self"
          data-quick-model
          @update:model-value="pick"
        >
          <template #option="{ option }">
            <div class="flex flex-col min-w-0" :data-option="option.key">
              <span class="truncate">{{ option.label }}</span>
              <span
                v-if="option.detail"
                class="truncate text-xs text-surface-500 dark:text-surface-400"
                >{{ option.detail }}</span
              >
            </div>
          </template>
        </Select>
      </div>

      <div class="flex flex-col gap-1">
        <label
          :for="`${id}-effort`"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Reasoning effort</label
        >
        <!-- Greyed rather than gone for a model with no dial, so the popover
             keeps its size whichever model is picked. -->
        <Select
          :input-id="`${id}-effort`"
          :model-value="effort"
          :options="effortOptions"
          option-label="label"
          option-value="value"
          :disabled="effortOptions.length < 2"
          :placeholder="effortOptions.length ? undefined : 'None'"
          aria-label="Reasoning effort"
          class="w-full dark:!bg-surface-900"
          size="small"
          append-to="self"
          data-quick-effort
          @update:model-value="setReasoningEffort"
        />
      </div>

      <!-- Every model there is, in the settings, where a click picks one. -->
      <Button
        label="Other models…"
        severity="secondary"
        outlined
        size="small"
        class="w-full"
        data-action="other-models"
        @click="otherModels"
      />
    </div>
  </Popover>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import Select from 'primevue/select'
import ChatChip from './ChatChip.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'
import { useChatSettings } from '@/composables/useChatSettings'
import { useConnections } from '@/composables/useConnections.js'
import { useModelLists } from '@/composables/useModelLists'
import { useModelCapabilities } from '@/composables/useModelCapabilities'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { REASONING_EFFORT_OPTIONS } from '@/ai/defaults.js'
import { fitEffort } from '@/ai/capabilities.js'
import { kindOf } from '@/ai/providers.js'
import { recommendedFor } from '@/ai/recommended.js'

/**
 * The chat's model and how hard it thinks, as a chip under its box: the
 * connection, the model and the effort, and a popover that changes the two,
 * with Other models… under them for the whole list, in Settings › Models.
 * Each is the chat's, and the next chat started on its profile starts with it
 * too (useChatSettings).
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId - The chat, which can be the story's unstarted one
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

// Where the row places it goes on the chip, not on the popover beside it.
defineOptions({ inheritAttrs: false })

const id = `quick_${useId()}`
const popoverId = `${id}-popover`
const app = useApplicationState()
const aiConfig = useAIConfig()
const connections = useConnections()
const modelLists = useModelLists()
const { preset, setModel, reasoningEffort, setReasoningEffort } = useChatSettings(
  props.storyId,
  () => props.chatId
)

// The efforts the chat's model takes, showing the one it is sent.
const capabilities = useModelCapabilities(
  () => preset.value?.providerId,
  () => preset.value?.model
)
const effortOptions = computed(() =>
  REASONING_EFFORT_OPTIONS.filter(option => capabilities.value.efforts.includes(option.value))
)
const effort = computed(() => fitEffort(reasoningEffort.value, capabilities.value))

/** The model by its name in its connection's list, or its id. */
const modelName = computed(() => {
  if (!preset.value) return ''
  const { providerId, model } = preset.value
  return modelLists.listOf(providerId)?.models.find(one => one.id === model)?.name ?? model
})

/** The chat's connection, by the name the writer knows it by. */
const connectionName = computed(
  () => (preset.value && aiConfig.getProvider(preset.value.providerId)?.name) || ''
)

/**
 * The model's name, short enough for the chip: without the maker OpenRouter
 * puts before it ("Anthropic: "), or the path before an id.
 */
const shortName = computed(() =>
  modelName.value.includes(': ')
    ? modelName.value.slice(modelName.value.indexOf(': ') + 2)
    : modelName.value.slice(modelName.value.lastIndexOf('/') + 1)
)

/** The effort, where the model has one to choose. */
const effortName = computed(() => {
  if (effortOptions.value.length < 2) return ''
  if (effort.value === 'disabled') return 'Thinking off'
  if (effort.value === 'enabled') return 'Thinking'
  return effortOptions.value.find(option => option.value === effort.value)?.label ?? ''
})

/** What the chip says, read as one. */
const label = computed(() =>
  preset.value
    ? [connectionName.value, modelName.value, effortName.value].filter(Boolean).join(', ')
    : 'Choose a model'
)

// The chat's connection's list, for the model's name and the efforts it takes.
watch(
  () => preset.value?.providerId,
  providerId => {
    if (providerId && !modelLists.listOf(providerId)) {
      modelLists.load(providerId).catch(() => {})
    }
  },
  { immediate: true }
)

/** @type {import('vue').Ref<any>} */
const chip = ref(null)
/** @type {import('vue').Ref<any>} */
const popover = ref(null)

/** @type {import('vue').Ref<HTMLElement|null>} */
const line = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const nameLabel = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const effortLabel = ref(null)

/**
 * The width the chip is held to while its effort is out of sight: the
 * model's whole name and no more, so the room the effort would take is left
 * to the row rather than as a gap before the chevron. Null while the effort
 * shows.
 */
const held = ref(/** @type {number|null} */ (null))

/**
 * The room the chip's row has left over once every chip has all it needs.
 * @param {HTMLElement} el - The chip
 */
function roomLeft(el) {
  const row = el.parentElement
  if (!row) return 0
  const style = window.getComputedStyle(row)
  const chips = [...row.children]
  const gaps = (parseFloat(style.columnGap) || 0) * Math.max(chips.length - 1, 0)
  const used = chips.reduce((sum, one) => sum + one.getBoundingClientRect().width, 0)
  const inner =
    row.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
  return inner - used - gaps
}

/**
 * Drop the effort before the model is cut. Too narrow for both, the effort
 * has wrapped out of sight on its own (the CSS does that); the chip is then
 * held to the model's whole name, and let go once the row has room for the
 * effort beside it again.
 */
function fit() {
  const el = chip.value?.$el
  const lineEl = line.value
  const nameEl = nameLabel.value
  const effortEl = effortLabel.value
  if (!el || !lineEl || !nameEl || !effortEl) {
    held.value = null
    return
  }
  const gap = parseFloat(window.getComputedStyle(lineEl).columnGap) || 0
  if (held.value !== null && roomLeft(el) >= effortEl.getBoundingClientRect().width + gap + 1) {
    held.value = null
    return
  }
  const wrapped = effortEl.getBoundingClientRect().top > nameEl.getBoundingClientRect().top + 1
  if (held.value !== null || wrapped) {
    // The chip as it is, but with the whole name on its line and no effort.
    const around = el.getBoundingClientRect().width - lineEl.getBoundingClientRect().width
    held.value = Math.ceil(around) + nameEl.scrollWidth + 1
  }
}

// Fitted again as the row or any chip in it changes size, and from the start
// when what the chip says changes.
/** @type {ResizeObserver|null} */
let observer = null
onMounted(() => {
  const el = chip.value?.$el
  if (!el || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(fit)
  observer.observe(el)
  if (el.parentElement) {
    observer.observe(el.parentElement)
    for (const one of el.parentElement.children) observer.observe(one)
  }
})
onBeforeUnmount(() => observer?.disconnect())
watch(label, () => {
  held.value = null
  nextTick(fit)
})

/** @param {string} providerId @param {string} model */
const keyOf = (providerId, model) => `${providerId}\n${model}`

const currentKey = computed(() =>
  preset.value ? keyOf(preset.value.providerId, preset.value.model) : null
)

/** How many models the menu offers. */
const MENU_MODELS = 8

/**
 * The chat's model, then those used lately on the writer's connections, then
 * the recommended ones on them, as many as there's room for.
 * Each by its name in its connection's list, and with the connection's name
 * where the writer has more than one.
 */
const modelOptions = computed(() => {
  const theirs = connections.connectionsFor('chat')
  const choices = [
    ...(preset.value ? [{ providerId: preset.value.providerId, model: preset.value.model }] : []),
    ...app.recentModels.value.filter(one =>
      theirs.some(provider => provider.id === one.providerId)
    ),
    ...theirs.flatMap(provider =>
      recommendedFor(kindOf(provider).id).map(entry => ({
        providerId: provider.id,
        model: entry.model,
      }))
    ),
  ]
  const seen = new Set()
  const options = []
  for (const { providerId, model } of choices) {
    const key = keyOf(providerId, model)
    if (seen.has(key)) continue
    if (options.length >= MENU_MODELS) break
    seen.add(key)
    const name = modelLists.listOf(providerId)?.models.find(one => one.id === model)?.name
    options.push({
      key,
      providerId,
      model,
      label: name ?? model,
      detail: theirs.length > 1 ? (aiConfig.getProvider(providerId)?.name ?? '') : '',
    })
  }
  return options
})

/** Ask the menu's connections what they serve, for their models' names. */
function loadLists() {
  const providerIds = new Set(modelOptions.value.map(option => option.providerId))
  for (const providerId of providerIds) {
    if (!modelLists.listOf(providerId)) modelLists.load(providerId).catch(() => {})
  }
}

/**
 * Run the chat on the model chosen in the menu.
 * @param {string} key
 */
function pick(key) {
  const option = modelOptions.value.find(one => one.key === key)
  if (option) setModel(option.providerId, option.model)
}

const settingsPanel = useSettingsPanel()

/** Open the settings on every model there is, where a click picks one. */
function otherModels() {
  popover.value?.hide()
  settingsPanel.open('models')
}

defineExpose({
  /**
   * Open the popover beside the chip.
   * @param {Event} [event] - The click that asked, which the popover must not
   *   take for a click outside it and close on
   */
  show: event => {
    const target = chip.value?.$el
    if (!target) return
    const asked = event?.currentTarget ? event : /** @type {any} */ ({ currentTarget: target })
    popover.value?.show(asked, target)
  },
})
</script>
