<template>
  <div class="flex flex-col gap-1">
    <MultiSelect
      :model-value="modelValue"
      :options="options"
      :loading="loading"
      option-label="name"
      option-value="slug"
      filter
      show-clear
      display="chip"
      :placeholder="placeholder"
      :aria-label="label || undefined"
      class="w-full"
      size="small"
      @update:model-value="emit('update:modelValue', $event || [])"
    />
    <Message v-if="notServing.length > 0" severity="warn" size="small" :closable="false">
      {{ notServingText }}
    </Message>
    <Message v-if="loadError" severity="warn" size="small" :closable="false">
      Couldn't load the provider list. The providers already chosen stay chosen.
    </Message>
    <Message v-else-if="servingError" severity="warn" size="small" :closable="false">
      Couldn't load which providers serve this model, so every provider is listed.
    </Message>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import MultiSelect from 'primevue/multiselect'
import Message from 'primevue/message'
import { useAIService } from '@/composables/useAIService'

/**
 * A list of OpenRouter's upstream providers, picked by name and stored by
 * slug. One for each list that names providers — the connection's ignored
 * ones, the allowed ones beside a model — so they offer the same names and
 * keep what they hold the same way.
 *
 * Given a model, it offers the providers that serve that model rather than
 * all of them, and says which of the chosen ones don't: the list was chosen
 * for a model, and the model can change under it. Without a model, or when
 * OpenRouter can't say who serves it, it offers the whole directory.
 *
 * @typedef {Object} Props
 * @property {string[]} modelValue - The chosen slugs
 * @property {string} [model] - Offer only the providers serving this model
 * @property {string} [placeholder] - Shown when none are chosen
 */
const props = defineProps({
  modelValue: {
    type: Array,
    required: true,
  },
  model: {
    type: String,
    default: '',
  },
  placeholder: {
    type: String,
    default: 'None',
  },
  /** What a screen reader calls the list: the setting it is for. */
  label: {
    type: String,
    default: '',
  },
})

/** A cleared list is emitted as `[]`, never PrimeVue's `null`. */
const emit = defineEmits(['update:modelValue'])

const aiService = useAIService()

/** @typedef {{slug: string, name: string}} ProviderOption */

/** @type {import('vue').Ref<ProviderOption[]>} */
const directory = ref([])
const loadingDirectory = ref(false)
const loadError = ref(false)

/**
 * The providers serving `model`, or null when that is not known: no model,
 * a model with no endpoints of its own, or a lookup that failed.
 *
 * @type {import('vue').Ref<ProviderOption[]|null>}
 */
const serving = ref(null)
const loadingServing = ref(false)
const servingError = ref(false)

const loading = computed(() => loadingDirectory.value || loadingServing.value)

onMounted(async () => {
  loadingDirectory.value = true
  try {
    directory.value = await aiService.listOpenRouterProviders()
  } catch (error) {
    console.error('Failed to load OpenRouter providers:', error)
    loadError.value = true
  } finally {
    loadingDirectory.value = false
  }
})

watch(
  () => props.model,
  async model => {
    serving.value = null
    servingError.value = false
    loadingServing.value = Boolean(model)
    if (!model) return
    try {
      const providers = await aiService.listModelProviders(model)
      // Asked for one model, answered after the picker moved to another.
      if (model !== props.model) return
      serving.value = providers.length > 0 ? providers : null
    } catch (error) {
      if (model !== props.model) return
      console.error(`Failed to load the providers serving ${model}:`, error)
      servingError.value = true
    } finally {
      if (model === props.model) loadingServing.value = false
    }
  },
  { immediate: true }
)

/** @param {string} slug @returns {string} The provider, less any variant */
const baseSlug = slug => slug.split('/')[0]

/** The slugs serving the model, or null when that is not known. */
const servingSlugs = computed(() =>
  serving.value ? new Set(serving.value.map(provider => provider.slug)) : null
)

/** @param {string} slug @returns {string} */
const nameOf = slug =>
  directory.value.find(provider => provider.slug === slug)?.name ||
  serving.value?.find(provider => provider.slug === slug)?.name ||
  slug

/**
 * The providers to offer, and any slug already chosen that they leave out — a
 * sub-provider variant like `deepinfra/turbo`, a provider that no longer
 * serves the model, or every one of them when the fetch failed. Without these
 * the MultiSelect would render a stored choice as unselected and quietly drop
 * it on the next edit.
 *
 * Named from the directory where it has them, so a provider reads the same
 * here as everywhere else.
 *
 * @type {import('vue').ComputedRef<ProviderOption[]>}
 */
const options = computed(() => {
  const pool = servingSlugs.value
    ? [...servingSlugs.value]
        .map(slug => ({ slug, name: nameOf(slug) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : directory.value
  const offered = new Set(pool.map(provider => provider.slug))
  const unlisted = /** @type {string[]} */ (props.modelValue)
    .filter(slug => !offered.has(slug))
    .map(slug => ({ slug, name: nameOf(slug) }))
  return [...pool, ...unlisted]
})

/**
 * Chosen slugs whose provider does not serve the model. A variant counts as
 * its provider: `deepinfra/turbo` serves what `deepinfra` serves, as far as
 * OpenRouter's endpoint list can say.
 *
 * @type {import('vue').ComputedRef<string[]>}
 */
const notServing = computed(() => {
  const slugs = servingSlugs.value
  if (!slugs) return []
  return /** @type {string[]} */ (props.modelValue).filter(slug => !slugs.has(baseSlug(slug)))
})

const notServingText = computed(() => {
  const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    notServing.value.map(slug => nameOf(baseSlug(slug)))
  )
  return `${names} ${notServing.value.length === 1 ? "doesn't" : "don't"} serve this model.`
})
</script>
