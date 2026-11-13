<template>
  <div class="flex flex-col gap-2 min-h-0 h-full" data-model-list>
    <!-- The search, with the filters and asking again at its end. -->
    <div
      class="flex items-center gap-1 pl-3 pr-1 rounded-md border border-surface-300 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 focus-within:border-primary-500"
      data-search-bar
    >
      <i class="pi pi-search text-surface-400" aria-hidden="true" />
      <InputText
        v-model="search"
        size="small"
        class="flex-1 min-w-0 !border-0 !shadow-none !bg-transparent"
        placeholder="Search"
        aria-label="Search models"
        data-field="model-search"
      />
      <Button
        v-tooltip.top="'Filter'"
        icon="pi pi-filter"
        severity="secondary"
        text
        rounded
        size="small"
        :class="{ '!text-primary-600 dark:!text-primary-400': filtering }"
        aria-label="Filter"
        aria-haspopup="true"
        data-action="filter-models"
        @click="filterPanel?.toggle($event)"
      />
      <Popover ref="filterPanel" data-model-filters>
        <div class="flex flex-col gap-3 w-64 text-sm">
          <div v-if="providers.length > 1" class="flex flex-col gap-1">
            <label
              :for="`${id}-connections`"
              class="text-xs font-medium text-surface-700 dark:text-surface-200"
              >Connections</label
            >
            <MultiSelect
              v-model="shownConnections"
              :input-id="`${id}-connections`"
              :options="providers"
              option-label="name"
              option-value="id"
              :show-toggle-all="false"
              placeholder="None"
              size="small"
              class="w-full dark:!bg-surface-900"
              data-filter="connections"
            />
          </div>
          <div class="flex items-center justify-between gap-2">
            <label
              :for="`${id}-free`"
              class="text-xs font-medium text-surface-700 dark:text-surface-200"
              >Only show free models</label
            >
            <ToggleSwitch v-model="onlyFree" :input-id="`${id}-free`" data-filter="free" />
          </div>
          <div class="flex flex-col gap-1">
            <label
              :for="`${id}-order`"
              class="text-xs font-medium text-surface-700 dark:text-surface-200"
              >Sort by</label
            >
            <Select
              v-model="order"
              :input-id="`${id}-order`"
              :options="ORDERS"
              option-label="label"
              option-value="value"
              size="small"
              class="w-full dark:!bg-surface-900"
              data-filter="order"
            />
          </div>
        </div>
      </Popover>
      <Button
        v-tooltip.top="'Refresh'"
        icon="pi pi-refresh"
        severity="secondary"
        text
        rounded
        size="small"
        :loading="loading"
        aria-label="Refresh models"
        data-action="refresh-models"
        @click="loadAll"
      />
    </div>

    <CardList ref="scroller" class="flex-1 min-h-0" scrolls aria-label="Models">
      <template v-for="group in groups" :key="group.key">
        <!-- A click on a heading shuts its group, and opens it again. -->
        <CardHeading
          v-if="headed"
          sticky
          class="cursor-pointer"
          role="button"
          tabindex="0"
          :aria-expanded="!isShut(group)"
          :data-group="group.key"
          @click="toggleGroup(group)"
          @keydown.enter.space.prevent="toggleGroup(group)"
          >{{ group.title }}</CardHeading
        >
        <!-- Every card alike, whatever its list says of it: a name and an id
             on the left, beside which connection serves it, and its price,
             context and tool support on the right, blank where unknown. A
             click chooses it; the button at its end opens it on whatever
             its holder has for it: its settings. Only those near the
             screen are drawn, the rest a blank of a card's height. -->
        <template v-if="!isShut(group)">
          <template v-for="model in group.models" :key="model.key">
            <CardItem
              v-if="isDrawn(group, model)"
              v-near="cardKey(group, model)"
              :title="model.name"
              :subtitle="model.id"
              :active="tint && isChosen(model)"
              :open="details && openKey === cardKey(group, model)"
              :expandable="false"
              :data-model="model.id"
              :data-connection="model.providerId"
              @toggle="emit('update:choice', { providerId: model.providerId, model: model.id })"
              @dblclick="emit('use', { providerId: model.providerId, model: model.id })"
            >
              <template #badges>
                <span
                  class="flex-none text-xs text-surface-500 dark:text-surface-400"
                  data-model-connection
                  >{{ model.connection }}</span
                >
              </template>
              <template #meta>
                <span class="min-h-4" data-price>{{ formatPrice(model.pricing) }}</span>
                <span class="flex gap-2 min-h-4">
                  <span v-if="formatContext(model.traits?.contextLength)">{{
                    formatContext(model.traits?.contextLength)
                  }}</span>
                  <span v-if="model.traits?.tools" data-tools>Tools</span>
                </span>
              </template>
              <template v-if="details" #trailing>
                <Button
                  v-tooltip.top="'Settings'"
                  severity="secondary"
                  text
                  rounded
                  size="small"
                  class="!p-2"
                  :aria-label="`${model.name} settings`"
                  :aria-expanded="openKey === cardKey(group, model)"
                  data-action="model-settings"
                  @click="toggleOpen(group, model)"
                >
                  <template #icon>
                    <SlidersIcon :size="14" class="shrink-0" />
                  </template>
                </Button>
              </template>
              <slot
                v-if="details && openKey === cardKey(group, model)"
                name="chosen"
                :model="model"
              />
            </CardItem>
            <div
              v-else
              v-near="cardKey(group, model)"
              class="min-h-14"
              :data-model="model.id"
              :data-connection="model.providerId"
              data-model-blank
            />
          </template>
        </template>
      </template>
    </CardList>
  </div>
</template>

<script setup>
/* global CSS */
import { computed, nextTick, onMounted, ref, useId, useSlots, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import Popover from 'primevue/popover'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import CardList from '@/components/common/CardList.vue'
import CardHeading from '@/components/common/CardHeading.vue'
import CardItem from '@/components/common/CardItem.vue'
import SlidersIcon from '@/components/icons/SlidersIcon.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'
import { useModelLists } from '@/composables/useModelLists'
import { useNearScreen } from '@/composables/useNearScreen.js'
import { kindOf } from '@/ai/providers.js'
import { recommendedFor } from '@/ai/recommended.js'
import { formatContext, formatPrice } from '@/utils/modelFacts.js'
import { localStorage } from '@/utils/localStorage'

/**
 * The models of the writer's connections to choose from, each saying which
 * connection serves it: Sonnet on OpenRouter and Sonnet on Anthropic are
 * two. First the few that answered lately, the most written first, then the
 * recommended ones, then each connection's own, sorted by name or by cost.
 * Searched, and filtered to some connections or to the free ones. Each says
 * what it costs, how much it reads at once, and whether it calls tools,
 * where its list says, and is laid out alike either way. A click chooses
 * one; the button at its end opens it on what is given for it (`#chosen`),
 * its settings, one at a time and whether or not it is the chosen one. A
 * click on a group's heading shuts it to the heading alone. The box stays
 * while there is nothing in it; the search's refresh asks every connection
 * again. Of a long list only the cards near the screen are drawn
 * (`useNearScreen`).
 *
 * @typedef {Object} Props
 * @property {string[]} providerIds - The connections whose models are listed
 * @property {{providerId: string|null, model: string|null}|null} [choice] -
 *   The model chosen, on its connection
 * @property {boolean} [tint] - Whether the chosen one is tinted as the one in
 *   use; not where choosing one only opens it
 */
const props = defineProps({
  providerIds: { type: Array, required: true },
  choice: { type: Object, default: null },
  tint: { type: Boolean, default: true },
})

/**
 * `update:choice`: `{providerId, model}`, a model clicked. `use`: one
 * double-clicked, chosen and taken at once.
 */
const emit = defineEmits(['update:choice', 'use'])

const id = useId()
const slots = useSlots()
const aiConfig = useAIConfig()
const app = useApplicationState()
const modelLists = useModelLists()

/** How many of the models used lately are listed first. */
const RECENT = 5

/** How each connection's models can be put in order; the name settles ties. */
const ORDERS = [
  { value: 'name', label: 'Name' },
  { value: 'cost', label: 'Cost' },
]
const ORDER_KEY = 'ui.models.order'
const SHUT_KEY = 'ui.models.shut'

/** @typedef {{key: string, providerId: string, connection: string, id: string, name: string, pricing?: any, traits?: any, free?: boolean}} Row */
/** @typedef {{key: string, title: string, models: Row[]}} Group */

/** The connections listed, as they are now. */
const providers = computed(
  () =>
    /** @type {import('@/types/models.js').AIProvider[]} */ (
      /** @type {string[]} */ (props.providerIds)
        .map(providerId => aiConfig.getProvider(providerId))
        .filter(Boolean)
    )
)

/** Whether any of them is still being asked. */
const loading = computed(() =>
  /** @type {string[]} */ (props.providerIds).some(
    providerId => modelLists.listOf(providerId)?.loading
  )
)

const search = ref('')
const onlyFree = ref(false)
/** The connections left out, so one added since is in. */
const hidden = ref(/** @type {string[]} */ ([]))
const order = ref(
  ORDERS.some(one => one.value === localStorage.get(ORDER_KEY))
    ? localStorage.get(ORDER_KEY)
    : 'name'
)
watch(order, value => localStorage.set(ORDER_KEY, value))

/** The connections ticked in the filter. */
const shownConnections = computed({
  get: () =>
    providers.value.map(provider => provider.id).filter(one => !hidden.value.includes(one)),
  set: ticked => {
    hidden.value = providers.value.map(provider => provider.id).filter(one => !ticked.includes(one))
  },
})

/** Whether any filter is on, for its button to say so. */
const filtering = computed(
  () => onlyFree.value || providers.value.some(provider => hidden.value.includes(provider.id))
)

/** @type {import('vue').Ref<any>} */
const filterPanel = ref(null)

/** Every connection's models, as rows, each with the connection it is on. */
const rows = computed(() =>
  providers.value.flatMap(provider =>
    (modelLists.listOf(provider.id)?.models ?? []).map(
      model =>
        /** @type {Row} */ ({
          ...model,
          key: `${provider.id}\n${model.id}`,
          providerId: provider.id,
          connection: provider.name,
        })
    )
  )
)

/** The models the search and filters leave. */
const shown = computed(() => {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return rows.value.filter(
    model =>
      words.every(word =>
        `${model.name} ${model.id} ${model.connection}`.toLowerCase().includes(word)
      ) &&
      !hidden.value.includes(model.providerId) &&
      (!onlyFree.value || model.free)
  )
})

/**
 * What a model costs, read and written, for putting them in order; one whose
 * list doesn't say goes last.
 * @param {Row} model
 */
const costOf = model =>
  model.pricing ? (model.pricing.prompt || 0) + (model.pricing.completion || 0) : Infinity

/** @param {Row} a @param {Row} b */
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/** @param {Row[]} models */
const sorted = models =>
  [...models].sort(
    order.value === 'cost' ? (a, b) => costOf(a) - costOf(b) || byName(a, b) : byName
  )

/**
 * The few that answered lately, of those listed, the most written first:
 * the latest five, so one used once long ago drops out.
 */
const recent = computed(() =>
  app.modelUses.value
    .map(use => ({
      use,
      row: shown.value.find(model => model.providerId === use.providerId && model.id === use.model),
    }))
    .filter(found => found.row)
    .slice(0, RECENT)
    .sort((a, b) => b.use.outputTokens - a.use.outputTokens)
    .map(found => /** @type {Row} */ (found.row))
)

/** Each connection's recommended ones, in its order. */
const recommended = computed(() =>
  providers.value.flatMap(provider =>
    recommendedFor(kindOf(provider).id)
      .map(entry =>
        shown.value.find(model => model.providerId === provider.id && model.id === entry.model)
      )
      .filter(row => /** @type {Row|undefined} */ (row) !== undefined)
  )
)

/**
 * Recent models, Recommended, then each connection's, all of them: one
 * recommended is under its connection too, where its cost puts it.
 * @type {import('vue').ComputedRef<Group[]>}
 */
const groups = computed(() =>
  [
    { key: 'recent', title: 'Recent models', models: recent.value },
    { key: 'recommended', title: 'Recommended', models: /** @type {Row[]} */ (recommended.value) },
    ...providers.value.map(provider => ({
      key: `connection:${provider.id}`,
      title: provider.name,
      models: sorted(shown.value.filter(model => model.providerId === provider.id)),
    })),
  ].filter(group => group.models.length > 0)
)

/** Whether the groups have headings: not for one alone. */
const headed = computed(() => groups.value.length > 1)

/**
 * The groups shut by a click on their headings, kept on the device.
 * @type {import('vue').Ref<string[]>}
 */
const shut = ref(Array.isArray(localStorage.get(SHUT_KEY)) ? localStorage.get(SHUT_KEY) : [])
watch(shut, value => localStorage.set(SHUT_KEY, value))

/**
 * Whether a group shows its heading alone; never where it has none.
 * @param {Group} group
 */
const isShut = group => headed.value && shut.value.includes(group.key)

/** @param {Group} group */
function toggleGroup(group) {
  shut.value = shut.value.includes(group.key)
    ? shut.value.filter(key => key !== group.key)
    : [...shut.value, group.key]
}

/** @param {Row} model */
const isChosen = model =>
  model.providerId === props.choice?.providerId && model.id === props.choice?.model

/** Whether a card opens on anything: its holder gave something for it. */
const details = computed(() => Boolean(slots.chosen))

/**
 * The card open on its settings: a model where it is listed, since one can
 * be under Recent models and its connection both.
 */
const openKey = ref(/** @type {string|null} */ (null))

/** @param {Group} group @param {Row} model */
const cardKey = (group, model) => `${group.key}\n${model.key}`

const { isNear, vNear } = useNearScreen({ root: row => row.closest('[data-card-list]') })

/**
 * Whether a card is drawn in full: one near the screen, and the one open,
 * which is taller than the blank that would stand for it.
 * @param {Group} group
 * @param {Row} model
 */
const isDrawn = (group, model) => {
  const key = cardKey(group, model)
  return isNear(key) || openKey.value === key
}

/**
 * Open a model's settings where its button was clicked, or shut them.
 * @param {Group} group
 * @param {Row} model
 */
function toggleOpen(group, model) {
  const key = cardKey(group, model)
  openKey.value = openKey.value === key ? null : key
}

/**
 * Ask a connection what it serves.
 * @param {string} providerId
 */
async function load(providerId) {
  await modelLists.load(providerId).catch(error => {
    console.error(`Listing ${aiConfig.getProvider(providerId)?.name}'s models failed:`, error)
  })
}

/** Ask every connection again. */
const loadAll = () => Promise.all(/** @type {string[]} */ (props.providerIds).map(load))

/** @type {import('vue').Ref<any>} */
const scroller = ref(null)

/** Bring the chosen model into view, the list being long. */
async function showChosen() {
  await nextTick()
  const choice = props.choice
  if (!choice?.providerId || !choice.model) return
  const list = /** @type {HTMLElement|undefined} */ (scroller.value?.$el)
  list
    ?.querySelector(
      `[data-connection="${CSS.escape(choice.providerId)}"][data-model="${CSS.escape(choice.model)}"]`
    )
    ?.scrollIntoView({ block: 'nearest' })
}

watch(
  () => props.providerIds,
  ids => {
    for (const providerId of /** @type {string[]} */ (ids)) {
      const list = modelLists.listOf(providerId)
      if (!list || (list.models.length === 0 && !list.loading)) load(providerId)
    }
  },
  { immediate: true }
)
watch(() => rows.value.length, showChosen)
onMounted(showChosen)
</script>
